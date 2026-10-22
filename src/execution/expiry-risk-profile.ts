/**
 * Expiry-aware risk profiles for long option positions (Deep Fix 5).
 *
 * Gamma and theta behave very differently on expiry day than earlier in the week,
 * so profit-protection and max-loss rules must tighten as expiry approaches.
 */

export type ExpiryBucket = 'ZERO_DTE' | 'NEAR_DTE' | 'FAR_DTE'

export type ExpiryRiskProfile = {
  bucket: ExpiryBucket
  /** Peak gain (fraction of entry) required before the retract guard arms */
  retractActivationPct: number
  /** Exit when price falls this fraction below the peak */
  maxDropFromPeakPct: number
  /** Exit when this fraction of the peak gain has been given back */
  maxLostGainRatio: number
  /** Maximum premium loss (fraction of entry) tolerated before a hard stop */
  maxPremiumRiskPct: number
}

const PROFILES: Record<ExpiryBucket, ExpiryRiskProfile> = {
  ZERO_DTE: {
    bucket: 'ZERO_DTE',
    retractActivationPct: 0.1,
    maxDropFromPeakPct: 0.08,
    maxLostGainRatio: 0.25,
    maxPremiumRiskPct: 0.2,
  },
  NEAR_DTE: {
    bucket: 'NEAR_DTE',
    retractActivationPct: 0.12,
    maxDropFromPeakPct: 0.12,
    maxLostGainRatio: 0.35,
    maxPremiumRiskPct: 0.3,
  },
  FAR_DTE: {
    bucket: 'FAR_DTE',
    retractActivationPct: 0.2,
    maxDropFromPeakPct: 0.15,
    maxLostGainRatio: 0.4,
    maxPremiumRiskPct: 0.5,
  },
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toIstDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date)
}

/**
 * Calendar trading days to expiry measured in IST (0 on expiry day, 1 the day before, ...).
 * Wall-clock hours are deliberately ignored: an expiry stamped at midnight would otherwise
 * classify the day before expiry as 0DTE.
 */
export function getCalendarDaysToExpiry(expiry: Date | string | undefined, now: Date = new Date()): number | undefined {
  if (!expiry) return undefined

  const expiryDate = new Date(expiry)
  if (Number.isNaN(expiryDate.getTime())) return undefined

  const diffMs = Date.parse(toIstDateKey(expiryDate)) - Date.parse(toIstDateKey(now))
  return Math.max(0, Math.round(diffMs / MS_PER_DAY))
}

/** Unknown expiry falls back to the NEAR_DTE profile (the historical default behaviour). */
export function getExpiryRiskProfile(daysToExpiry: number | undefined): ExpiryRiskProfile {
  if (daysToExpiry === undefined) return PROFILES.NEAR_DTE
  if (daysToExpiry < 1) return PROFILES.ZERO_DTE
  return daysToExpiry <= 2 ? PROFILES.NEAR_DTE : PROFILES.FAR_DTE
}

export function isRetractGuardTriggered(
  entryPrice: number,
  peakPrice: number,
  price: number,
  profile: ExpiryRiskProfile
): boolean {
  const peakGain = peakPrice - entryPrice
  if (entryPrice <= 0 || peakGain / entryPrice < profile.retractActivationPct || price >= peakPrice) return false

  const dropFromPeakPct = (peakPrice - price) / peakPrice
  const lostGainRatio = (peakPrice - price) / peakGain
  return dropFromPeakPct >= profile.maxDropFromPeakPct || lostGainRatio >= profile.maxLostGainRatio
}

/** Lowest premium stop allowed for a long option, bounding worst-case loss per trade. */
export function getPremiumStopFloor(entryPrice: number, profile: ExpiryRiskProfile): number {
  return entryPrice * (1 - profile.maxPremiumRiskPct)
}

export type PeakRatchetTier = {
  /** Minimum peak gain (fraction of entry, e.g. 0.08 = +8%) required to activate this tier */
  minPeakGainPct: number
  /** Fraction of peak gain points locked above entry (e.g. 0.55 = entry + 55% of peak gain) */
  lockPeakGainRatio: number
}

/**
 * Declarative Peak Profit Ratchet tiers (ordered highest-to-lowest peak gain).
 * Easy to read and tune in one place alongside the Retract Guard profiles.
 */
export const PEAK_PROFIT_RATCHET_TIERS: readonly PeakRatchetTier[] = [
  { minPeakGainPct: 0.35, lockPeakGainRatio: 0.75 }, // +35%+ peak gain -> lock 75% of peak gain
  { minPeakGainPct: 0.2, lockPeakGainRatio: 0.65 }, // +20%+ peak gain -> lock 65% of peak gain
  { minPeakGainPct: 0.12, lockPeakGainRatio: 0.55 }, // +12%+ peak gain -> lock 55% of peak gain
  { minPeakGainPct: 0.08, lockPeakGainRatio: 0.35 }, // +8%+  peak gain -> lock 35% of peak gain
]

/**
 * Computes the ratcheted stop-loss price from the matching PeakRatchetTier,
 * or undefined when the peak gain has not yet reached the lowest tier.
 */
export function getRatchetedStopLoss(
  entryPrice: number,
  peakPrice: number,
  tiers: readonly PeakRatchetTier[] = PEAK_PROFIT_RATCHET_TIERS
): { targetSl: number; peakGainPct: number; tier: PeakRatchetTier } | undefined {
  if (entryPrice <= 0 || peakPrice <= entryPrice) return undefined

  const peakGainPoints = peakPrice - entryPrice
  const peakGainPct = peakGainPoints / entryPrice
  const matchedTier = tiers.find((t) => peakGainPct >= t.minPeakGainPct)
  if (!matchedTier) return undefined

  const targetSl = entryPrice + matchedTier.lockPeakGainRatio * peakGainPoints
  return { targetSl, peakGainPct, tier: matchedTier }
}

export type OptionType = 'CE' | 'PE'

export function getOptionType(symbol: string): OptionType | undefined {
  if (symbol.endsWith('CE')) return 'CE'
  return symbol.endsWith('PE') ? 'PE' : undefined
}

/** A long CE is invalidated when the index falls to its stop; a long PE when it rises to its stop. */
export function isIndexInvalidated(optionType: OptionType, indexPrice: number, invalidationLevel: number): boolean {
  return optionType === 'CE' ? indexPrice <= invalidationLevel : indexPrice >= invalidationLevel
}

/**
 * Accepts the index stop only when it sits on the protective side of the entry index price,
 * so a malformed AI level can never trigger an instant exit.
 */
export function resolveIndexInvalidation(
  optionType: OptionType | undefined,
  indexStop: number | undefined,
  entryIndexPrice: number | undefined
): number | undefined {
  if (!optionType || !indexStop || !entryIndexPrice) return undefined
  return isIndexInvalidated(optionType, entryIndexPrice, indexStop) ? undefined : indexStop
}
