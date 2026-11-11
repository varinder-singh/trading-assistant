import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isMarketOpen, getMarketStatusMessage } from '../src/utils/market-hours.js'

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
})
