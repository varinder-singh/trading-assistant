export interface SpecialSession {
  date: string // 'YYYY-MM-DD' in Asia/Kolkata
  openTime: string // 'HH:MM' (24-hour)
  closeTime: string // 'HH:MM'
  name: string
}

// Known special trading sessions (e.g. Diwali Muhurat Trading, NSE special weekend disaster recovery sessions)
export const SPECIAL_SESSIONS: SpecialSession[] = [
  {
    date: '2026-11-08',
    openTime: '14:20',
    closeTime: '18:00',
    name: 'Diwali Muhurat Trading',
  },
]

function getCustomSpecialSessions(): SpecialSession[] {
  if (typeof process === 'undefined' || !process.env?.SPECIAL_TRADING_SESSIONS) return []
  try {
    return JSON.parse(process.env.SPECIAL_TRADING_SESSIONS)
  } catch {
    return []
  }
}

export function getActiveSpecialSession(date: Date = new Date()): SpecialSession | null {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const getValue = (type: string) => parts.find((p) => p.type === type)?.value ?? ''

  const year = getValue('year')
  const month = getValue('month')
  const day = getValue('day')
  const currentDate = `${year}-${month}-${day}`

  const hour = parseInt(getValue('hour') || '0', 10)
  const minute = parseInt(getValue('minute') || '0', 10)
  const timeInMinutes = hour * 60 + minute

  const allSessions = [...SPECIAL_SESSIONS, ...getCustomSpecialSessions()]
  for (const session of allSessions) {
    if (session.date === currentDate) {
      const openParts = session.openTime.split(':').map((v) => parseInt(v, 10))
      const closeParts = session.closeTime.split(':').map((v) => parseInt(v, 10))
      const openMinutes = (openParts[0] ?? 0) * 60 + (openParts[1] ?? 0)
      const closeMinutes = (closeParts[0] ?? 0) * 60 + (closeParts[1] ?? 0)
      if (timeInMinutes >= openMinutes && timeInMinutes <= closeMinutes) {
        return session
      }
    }
  }
  return null
}

export function isMarketOpen(date: Date = new Date()): boolean {
  if (typeof process !== 'undefined' && (process.env?.FORCE_MARKET_OPEN === 'true' || process.env?.MARKET_FORCE_OPEN === 'true')) {
    return true
  }

  // 1. Check for active special trading sessions (e.g. Diwali Muhurat trading)
  const specialSession = getActiveSpecialSession(date)
  if (specialSession) {
    return true
  }

  // 2. Standard NSE trading hours check (Mon - Fri 09:15 - 15:30 IST)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    weekday: 'long',
    hour: 'numeric',
    minute: 'numeric',
  })
  const parts = formatter.formatToParts(date)

  const getValue = (type: string) => parts.find((p) => p.type === type)?.value ?? ''

  const weekday = getValue('weekday')
  if (weekday === 'Saturday' || weekday === 'Sunday') {
    return false
  }

  const hour = parseInt(getValue('hour') || '0', 10)
  const minute = parseInt(getValue('minute') || '0', 10)

  // Market hours: 09:15 AM to 03:30 PM (15:30)
  const timeInMinutes = hour * 60 + minute
  const marketOpen = 9 * 60 + 15 // 555
  const marketClose = 15 * 60 + 30 // 930

  return timeInMinutes >= marketOpen && timeInMinutes <= marketClose
}

export function getMarketStatusMessage(date: Date = new Date()): string {
  if (typeof process !== 'undefined' && (process.env?.FORCE_MARKET_OPEN === 'true' || process.env?.MARKET_FORCE_OPEN === 'true')) {
    return 'Market is Open (Forced)'
  }

  const specialSession = getActiveSpecialSession(date)
  if (specialSession) {
    return `Market is Open (${specialSession.name})`
  }

  return isMarketOpen(date) ? 'Market is Open' : 'Market is Closed'
}
