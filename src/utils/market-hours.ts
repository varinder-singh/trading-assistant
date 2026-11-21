import { MarketRegistry, NSE_SPECIAL_SESSIONS } from '../markets/registry.js'
import type { SpecialSessionConfig } from '../markets/types.js'

export type SpecialSession = SpecialSessionConfig

// Known special trading sessions (e.g. Diwali Muhurat Trading, NSE special weekend disaster recovery sessions)
export const SPECIAL_SESSIONS: SpecialSession[] = NSE_SPECIAL_SESSIONS

export function getActiveSpecialSession(date: Date = new Date()): SpecialSession | null {
  const activeMarket = MarketRegistry.getActiveMarket()
  const sessions = [...(activeMarket.config.specialSessions || [])]
  if (typeof process !== 'undefined' && process.env?.SPECIAL_TRADING_SESSIONS) {
    try {
      sessions.push(...JSON.parse(process.env.SPECIAL_TRADING_SESSIONS))
    } catch {
      // ignore
    }
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: activeMarket.timezone,
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

  for (const session of sessions) {
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

export function isOpeningBellFilterActive(date: Date = new Date()): boolean {
  return MarketRegistry.getActiveMarket().isOpeningBellFilterActive(date)
}

export function isClosingBellFilterActive(date: Date = new Date()): boolean {
  return MarketRegistry.getActiveMarket().isClosingBellFilterActive(date)
}

export function isMarketOpen(date: Date = new Date()): boolean {
  return MarketRegistry.getActiveMarket().isMarketOpen(date)
}

export function getMarketStatusMessage(date: Date = new Date()): string {
  return MarketRegistry.getActiveMarket().getMarketStatusMessage(date)
}
