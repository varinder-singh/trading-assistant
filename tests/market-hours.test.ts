import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isMarketOpen, getMarketStatusMessage, isOpeningBellFilterActive } from '../src/utils/market-hours.js'

describe('Market Hours & Special Sessions (Muhurat Trading)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('detects standard weekday trading hours as open', () => {
    // 2026-11-04 is a Wednesday at 10:30 AM IST (05:00 UTC)
    const date = new Date('2026-11-04T05:00:00Z')
    expect(isMarketOpen(date)).toBe(true)
    expect(getMarketStatusMessage(date)).toBe('Market is Open')
  })

  it('detects standard weekday pre-market and post-market as closed', () => {
    // 2026-11-04 Wednesday at 08:30 AM IST (03:00 UTC)
    const preMarket = new Date('2026-11-04T03:00:00Z')
    expect(isMarketOpen(preMarket)).toBe(false)
    expect(getMarketStatusMessage(preMarket)).toBe('Market is Closed')

    // 2026-11-04 Wednesday at 04:00 PM IST (10:30 UTC)
    const postMarket = new Date('2026-11-04T10:30:00Z')
    expect(isMarketOpen(postMarket)).toBe(false)
  })

  it('detects standard Sunday outside special sessions as closed', () => {
    // 2026-11-01 Sunday at 11:00 AM IST
    const regularSunday = new Date('2026-11-01T05:30:00Z')
    expect(isMarketOpen(regularSunday)).toBe(false)
  })

  it('recognizes Diwali Muhurat Trading on Sunday 2026-11-08 at 14:30 IST as OPEN', () => {
    // 2026-11-08 Sunday at 14:30 IST (09:00 UTC)
    const muhuratTrading = new Date('2026-11-08T09:00:00Z')
    expect(isMarketOpen(muhuratTrading)).toBe(true)
    expect(getMarketStatusMessage(muhuratTrading)).toBe('Market is Open (Diwali Muhurat Trading)')
  })

  it('recognizes Diwali Muhurat Trading on Sunday 2026-11-08 at 15:45 IST as OPEN', () => {
    // 2026-11-08 Sunday at 15:45 IST (10:15 UTC)
    const muhuratTrading = new Date('2026-11-08T10:15:00Z')
    expect(isMarketOpen(muhuratTrading)).toBe(true)
  })

  it('returns closed before Muhurat Trading begins on Sunday 2026-11-08 at 10:00 AM IST', () => {
    // 2026-11-08 Sunday at 10:00 AM IST (04:30 UTC)
    const sundayMorning = new Date('2026-11-08T04:30:00Z')
    expect(isMarketOpen(sundayMorning)).toBe(false)
    expect(getMarketStatusMessage(sundayMorning)).toBe('Market is Closed')
  })

  it('honors FORCE_MARKET_OPEN=true override', () => {
    process.env.FORCE_MARKET_OPEN = 'true'
    const midnight = new Date('2026-11-01T00:00:00Z')
    expect(isMarketOpen(midnight)).toBe(true)
    expect(getMarketStatusMessage(midnight)).toBe('Market is Open (Forced)')
  })

  it('activates 15-minute opening bell filter between 09:15 and 09:30 IST on weekdays', () => {
    // 2026-11-04 is a Wednesday
    // 09:15 IST = 03:45 UTC
    const atMarketOpen = new Date('2026-11-04T03:45:00Z')
    expect(isOpeningBellFilterActive(atMarketOpen)).toBe(true)

    // 09:25 IST = 03:55 UTC (within 15m window)
    const midOpening = new Date('2026-11-04T03:55:00Z')
    expect(isOpeningBellFilterActive(midOpening)).toBe(true)

    // 09:30 IST = 04:00 UTC (15m window ends, trade triggers permitted)
    const at15mMark = new Date('2026-11-04T04:00:00Z')
    expect(isOpeningBellFilterActive(at15mMark)).toBe(false)

    // 10:30 IST = 05:00 UTC
    const laterInDay = new Date('2026-11-04T05:00:00Z')
    expect(isOpeningBellFilterActive(laterInDay)).toBe(false)

    // Weekend check: Sunday at 09:20 IST -> inactive
    const sundayMorning = new Date('2026-11-01T03:50:00Z')
    expect(isOpeningBellFilterActive(sundayMorning)).toBe(false)
  })

  it('honors DISABLE_OPENING_BELL_FILTER=true override', () => {
    process.env.DISABLE_OPENING_BELL_FILTER = 'true'
    const midOpening = new Date('2026-11-04T03:55:00Z') // 09:25 IST
    expect(isOpeningBellFilterActive(midOpening)).toBe(false)
  })
})
