import { describe, it, expect } from 'vitest'
import {
  getCalendarDaysToExpiry,
  getExpiryRiskProfile,
  isRetractGuardTriggered,
  getPremiumStopFloor,
  getRatchetedStopLoss,
  isIndexInvalidated,
  resolveIndexInvalidation,
} from '../src/execution/expiry-risk-profile.js'

describe('Expiry Risk Profile (Deep Fix 5)', () => {
  describe('getCalendarDaysToExpiry', () => {
    it('returns 0 for the same IST calendar date', () => {
      const now = new Date('2026-10-13T04:00:00Z') // ~09:30 IST
      const expiry = new Date('2026-10-13T10:00:00Z') // ~15:30 IST
      expect(getCalendarDaysToExpiry(expiry, now)).toBe(0)
    })

    it('returns positive calendar days when expiry is in future', () => {
      const now = new Date('2026-10-13T04:00:00Z')
      const expiry = new Date('2026-10-15T10:00:00Z')
      expect(getCalendarDaysToExpiry(expiry, now)).toBe(2)
    })

    it('returns undefined for missing or invalid expiry', () => {
      expect(getCalendarDaysToExpiry(undefined)).toBeUndefined()
      expect(getCalendarDaysToExpiry('invalid-date')).toBeUndefined()
    })
  })

  describe('getExpiryRiskProfile', () => {
    it('maps 0 DTE to ZERO_DTE profile', () => {
      const profile = getExpiryRiskProfile(0)
      expect(profile.bucket).toBe('ZERO_DTE')
      expect(profile.retractActivationPct).toBe(0.1)
      expect(profile.maxDropFromPeakPct).toBe(0.08)
      expect(profile.maxLostGainRatio).toBe(0.25)
      expect(profile.maxPremiumRiskPct).toBe(0.2)
    })

    it('maps 1-2 DTE to NEAR_DTE profile', () => {
      const profile = getExpiryRiskProfile(2)
      expect(profile.bucket).toBe('NEAR_DTE')
      expect(profile.retractActivationPct).toBe(0.12)
      expect(profile.maxDropFromPeakPct).toBe(0.12)
      expect(profile.maxLostGainRatio).toBe(0.35)
      expect(profile.maxPremiumRiskPct).toBe(0.3)
    })

    it('maps > 2 DTE to FAR_DTE profile', () => {
      const profile = getExpiryRiskProfile(5)
      expect(profile.bucket).toBe('FAR_DTE')
      expect(profile.maxDropFromPeakPct).toBe(0.15)
      expect(profile.maxLostGainRatio).toBe(0.4)
      expect(profile.maxPremiumRiskPct).toBe(0.5)
    })

    it('falls back to NEAR_DTE when DTE is undefined', () => {
      const profile = getExpiryRiskProfile(undefined)
      expect(profile.bucket).toBe('NEAR_DTE')
    })
  })

  describe('isRetractGuardTriggered', () => {
    const zeroDte = getExpiryRiskProfile(0)

    it('triggers on 0DTE when drop from peak >= 8% after +20% peak gain', () => {
      const entry = 100
      const peak = 125 // +25%
      const price = 114 // (125 - 114) / 125 = 8.8% drop
      expect(isRetractGuardTriggered(entry, peak, price, zeroDte)).toBe(true)
    })

    it('does not trigger if peak gain is below 10%', () => {
      const entry = 100
      const peak = 108 // +8% (< 10% activation)
      const price = 98 // drop > 8%, but guard not armed
      expect(isRetractGuardTriggered(entry, peak, price, zeroDte)).toBe(false)
    })

    it('triggers on 0DTE on 8.7% drop when peak gain is >= 10%', () => {
      const entry = 100
      const peak = 115 // +15% (>= 10% activation)
      const price = 105 // (115 - 105) / 115 = 8.7% drop from peak
      expect(isRetractGuardTriggered(entry, peak, price, zeroDte)).toBe(true)
    })

    it('triggers on 0DTE when lost gain ratio >= 25%', () => {
      const entry = 100
      const peak = 120 // +20 points gain
      const price = 114 // lost 6 points / 20 = 30% lost gain
      expect(isRetractGuardTriggered(entry, peak, price, zeroDte)).toBe(true)
    })
  })

  describe('getPremiumStopFloor', () => {
    it('enforces 20% max loss floor for 0DTE', () => {
      const zeroDte = getExpiryRiskProfile(0)
      expect(getPremiumStopFloor(100, zeroDte)).toBe(80)
      expect(getPremiumStopFloor(50.9, zeroDte)).toBeCloseTo(40.72, 2)
    })

    it('enforces 30% max loss floor for NEAR_DTE', () => {
      const nearDte = getExpiryRiskProfile(2)
      expect(getPremiumStopFloor(100, nearDte)).toBe(70)
    })
  })

  describe('getRatchetedStopLoss (PEAK_PROFIT_RATCHET_TIERS)', () => {
    it('returns undefined when peak gain is below the lowest tier (+8%)', () => {
      expect(getRatchetedStopLoss(100, 107.9)).toBeUndefined()
    })

    it('locks 35% of peak gain at +8% to +11.9% tier', () => {
      const res = getRatchetedStopLoss(100, 110) // +10% gain (10 pts)
      expect(res?.tier.minPeakGainPct).toBe(0.08)
      expect(res?.targetSl).toBeCloseTo(103.5, 2)
    })

    it('locks 55% of peak gain at +12% to +19.9% tier (e.g. Oct 19 22900 PE 46.7 -> 52.85)', () => {
      const res = getRatchetedStopLoss(46.7, 52.85) // +13.17% gain (6.15 pts)
      expect(res?.tier.minPeakGainPct).toBe(0.12)
      expect(res?.targetSl).toBeCloseTo(50.0825, 2)
    })

    it('locks 65% of peak gain at +20% to +34.9% tier', () => {
      const res = getRatchetedStopLoss(100, 125) // +25% gain (25 pts)
      expect(res?.tier.minPeakGainPct).toBe(0.2)
      expect(res?.targetSl).toBeCloseTo(116.25, 2)
    })

    it('locks 75% of peak gain at +35%+ tier', () => {
      const res = getRatchetedStopLoss(100, 140) // +40% gain (40 pts)
      expect(res?.tier.minPeakGainPct).toBe(0.35)
      expect(res?.targetSl).toBeCloseTo(130, 2)
    })
  })

  describe('isIndexInvalidated', () => {
    it('invalidates CE when index price drops at or below invalidation level', () => {
      expect(isIndexInvalidated('CE', 22640, 22650)).toBe(true)
      expect(isIndexInvalidated('CE', 22650, 22650)).toBe(true)
      expect(isIndexInvalidated('CE', 22660, 22650)).toBe(false)
    })

    it('invalidates PE when index price rises at or above invalidation level', () => {
      expect(isIndexInvalidated('PE', 22710, 22700)).toBe(true)
      expect(isIndexInvalidated('PE', 22700, 22700)).toBe(true)
      expect(isIndexInvalidated('PE', 22690, 22700)).toBe(false)
    })
  })

  describe('resolveIndexInvalidation', () => {
    it('returns invalidation level when protective side of entry', () => {
      // For BUY_CE entered at index 22700, stop is below at 22650
      expect(resolveIndexInvalidation('CE', 22650, 22700)).toBe(22650)
      // For BUY_PE entered at index 22700, stop is above at 22750
      expect(resolveIndexInvalidation('PE', 22750, 22700)).toBe(22750)
    })

    it('rejects invalidation level if already breached at entry', () => {
      // CE with stop above current index price is invalid
      expect(resolveIndexInvalidation('CE', 22750, 22700)).toBeUndefined()
      // PE with stop below current index price is invalid
      expect(resolveIndexInvalidation('PE', 22650, 22700)).toBeUndefined()
    })
  })
})
