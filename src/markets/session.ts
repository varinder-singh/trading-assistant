import type { IMarketSession, MarketId, MarketScheduleConfig, SpecialSessionConfig, VolatilityBenchmarkConfig } from './types.js'

export class MarketSession implements IMarketSession {
  public readonly id: MarketId
  public readonly name: string
  public readonly timezone: string
  public readonly currency: string
  public readonly is24x7: boolean
  public readonly config: MarketScheduleConfig

  constructor(config: MarketScheduleConfig) {
    this.config = Object.freeze({ ...config })
    this.id = config.id
    this.name = config.name
    this.timezone = config.timezone
    this.currency = config.currency
    this.is24x7 = Boolean(config.is24x7)
  }

  public getVolatilityBenchmark(): VolatilityBenchmarkConfig {
    return this.config.volatilityBenchmark
  }

  private getLocalTimeComponents(date: Date): {
    year: string
    month: string
    day: string
    currentDate: string
    timeInMinutes: number
    weekdayName: string
    weekdayNumber: number // 1=Mon, ..., 7=Sun
  } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'long',
    })

    const parts = formatter.formatToParts(date)
    const getValue = (type: string) => parts.find((p) => p.type === type)?.value ?? ''

    const year = getValue('year')
    const month = getValue('month')
    const day = getValue('day')
    const hour = parseInt(getValue('hour') || '0', 10)
    const minute = parseInt(getValue('minute') || '0', 10)
    const weekdayName = getValue('weekday')

    const dayMap: Record<string, number> = {
      Monday: 1,
      Tuesday: 2,
      Wednesday: 3,
      Thursday: 4,
      Friday: 5,
      Saturday: 6,
      Sunday: 7,
    }

    return {
      year,
      month,
      day,
      currentDate: `${year}-${month}-${day}`,
      timeInMinutes: hour * 60 + minute,
      weekdayName,
      weekdayNumber: dayMap[weekdayName] ?? 1,
    }
  }

  private parseTimeToMinutes(timeStr: string): number {
    const parts = timeStr.split(':').map((v) => parseInt(v, 10))
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
  }

  private getCustomSpecialSessions(): SpecialSessionConfig[] {
    if (typeof process === 'undefined' || !process.env?.SPECIAL_TRADING_SESSIONS) return []
    try {
      return JSON.parse(process.env.SPECIAL_TRADING_SESSIONS)
    } catch {
      return []
    }
  }

  private getActiveSpecialSession(date: Date): SpecialSessionConfig | null {
    const { currentDate, timeInMinutes } = this.getLocalTimeComponents(date)
    const sessions = [...(this.config.specialSessions || []), ...this.getCustomSpecialSessions()]
    for (const session of sessions) {
      if (session.date === currentDate) {
        const openMins = this.parseTimeToMinutes(session.openTime)
        const closeMins = this.parseTimeToMinutes(session.closeTime)
        if (timeInMinutes >= openMins && timeInMinutes <= closeMins) {
          return session
        }
      }
    }
    return null
  }

  public isMarketOpen(date: Date = new Date()): boolean {
    if (typeof process !== 'undefined' && (process.env?.FORCE_MARKET_OPEN === 'true' || process.env?.MARKET_FORCE_OPEN === 'true')) {
      return true
    }

    // 24x7 markets (like Crypto) are always open
    if (this.is24x7) {
      return true
    }

    // 1. Check special trading sessions
    const specialSession = this.getActiveSpecialSession(date)
    if (specialSession) {
      return true
    }

    // 2. Standard schedule
    const { timeInMinutes, weekdayNumber } = this.getLocalTimeComponents(date)
    const activeTradingDays = this.config.tradingDays || [1, 2, 3, 4, 5] // Mon-Fri default
    if (!activeTradingDays.includes(weekdayNumber)) {
      return false
    }

    const openMins = this.parseTimeToMinutes(this.config.openTime)
    const closeMins = this.parseTimeToMinutes(this.config.closeTime)

    return timeInMinutes >= openMins && timeInMinutes <= closeMins
  }

  public isOpeningBellFilterActive(date: Date = new Date()): boolean {
    if (this.is24x7) return false
    if (typeof process !== 'undefined' && process.env?.DISABLE_OPENING_BELL_FILTER === 'true') {
      return false
    }

    const filterMinutes = Number(
      process.env?.OPENING_BELL_FILTER_MINS ?? this.config.openingBellFilterMinutes ?? 15
    )
    if (filterMinutes <= 0) return false

    const { timeInMinutes, weekdayNumber } = this.getLocalTimeComponents(date)
    const activeTradingDays = this.config.tradingDays || [1, 2, 3, 4, 5]
    if (!activeTradingDays.includes(weekdayNumber)) return false

    const marketOpen = this.parseTimeToMinutes(this.config.openTime)
    const openingBellEnd = marketOpen + filterMinutes

    return timeInMinutes >= marketOpen && timeInMinutes < openingBellEnd
  }

  public isClosingBellFilterActive(date: Date = new Date()): boolean {
    if (this.is24x7) return false
    if (typeof process !== 'undefined' && process.env?.DISABLE_CLOSING_BELL_FILTER === 'true') {
      return false
    }

    const cutoffMinutes = Number(
      process.env?.CLOSING_BELL_FILTER_MINS ?? this.config.closingBellFilterMinutes ?? 15
    )
    if (cutoffMinutes <= 0) return false

    const { timeInMinutes, weekdayNumber } = this.getLocalTimeComponents(date)
    const activeTradingDays = this.config.tradingDays || [1, 2, 3, 4, 5]
    if (!activeTradingDays.includes(weekdayNumber)) return false

    const marketClose = this.parseTimeToMinutes(this.config.closeTime)
    const closingCutoffStart = marketClose - cutoffMinutes

    return timeInMinutes >= closingCutoffStart && timeInMinutes <= marketClose
  }

  public getTimeToCloseMinutes(date: Date = new Date()): number {
    if (this.is24x7) {
      return Number.POSITIVE_INFINITY
    }

    if (!this.isMarketOpen(date)) {
      return 0
    }

    const { timeInMinutes } = this.getLocalTimeComponents(date)
    const squareOffMinutesBeforeClose = this.config.squareOffMinutesBeforeClose ?? 15
    const marketClose = this.parseTimeToMinutes(this.config.closeTime)
    const squareOffTime = marketClose - squareOffMinutesBeforeClose

    return Math.max(0, squareOffTime - timeInMinutes)
  }

  public isRunwayConstrained(requiredMinutes: number, date: Date = new Date()): boolean {
    if (this.is24x7) return false
    const remaining = this.getTimeToCloseMinutes(date)
    return remaining < requiredMinutes
  }

  public getMarketStatusMessage(date: Date = new Date()): string {
    if (typeof process !== 'undefined' && (process.env?.FORCE_MARKET_OPEN === 'true' || process.env?.MARKET_FORCE_OPEN === 'true')) {
      return 'Market is Open (Forced)'
    }

    const specialSession = this.getActiveSpecialSession(date)
    if (specialSession) {
      return `Market is Open (${specialSession.name})`
    }

    if (this.id === 'NSE') {
      return this.isMarketOpen(date) ? 'Market is Open' : 'Market is Closed'
    }

    return this.isMarketOpen(date) ? `Market is Open (${this.name})` : `Market is Closed (${this.name})`
  }

  public formatLocalTime(date: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date)
  }
}
