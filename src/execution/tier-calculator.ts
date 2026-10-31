/**
 * Tiered Profit Target Calculator
 *
 * Computes T1, T2, T3 exit levels for an options position using one of two strategies:
 *
 * Strategy A — AI Wave Targets (PREFERRED):
 *   Uses the AI's `decision.targets` array (index-level Fibonacci/wave extension prices)
 *   and translates them to option premium targets using the option's delta.
 *   This is the most accurate method as it's grounded in actual market structure.
 *
 * Strategy B — DTE Risk Multiples (FALLBACK):
 *   When no AI targets are available, derives targets from the premium risk gap
 *   (entry - stopLoss) scaled by DTE-aware multipliers.
 *   Tighter multipliers on 0DTE to beat theta, wider on multi-day positions.
 *
 * Lot Split Rules (whole lots only — NIFTY/BANKNIFTY lots are fixed):
 *   - 1 lot : T1 = no sell (just move SL to Fibonacci breakeven), T2 = full exit
 *   - 2 lots: T1 = 1 lot exit, T3 = 1 lot runner (no T2 sell)
 *   - 3+ lots: T1 = 1 lot, T2 = floor split, T3 = remainder
 */

export interface TieredTargetInput {
  /** Option premium price at which the BUY order was filled */
  entryPrice: number
  /** Translated option premium stop-loss level */
  aiStopLoss: number
  /** Option delta (absolute value, e.g. 0.45 for ATM) */
  optionDelta: number
  /** Days to expiry (fractional, e.g. 0.25 for 0DTE at 3PM) */
  daysToExpiry: number
  /** Total quantity of the position in lots x lotSize */
  quantity: number
  /** Instrument lot size (e.g. 75 for NIFTY, 30 for BANKNIFTY) */
  lotSize: number
  /**
   * AI-computed index-level targets from decision.targets[]
   * These are Fibonacci/wave extension levels in NIFTY/BANKNIFTY points.
   * e.g. [24050, 24150] when NIFTY is at 23900
   */
  aiIndexTargets?: number[] | undefined
  /** Current live index price (NIFTY/BANKNIFTY) needed to translate index targets to premium */
  currentIndexPrice?: number | undefined
}

export interface TieredTargetResult {
  t1Target: number
  t2Target: number
  t3Target: number
  /** Qty (whole lots x lotSize) to sell at T1. 0 = 1-lot special: no sell, just trail SL */
  t1Qty: number
  /** Qty to sell at T2. 0 = 2-lot special: no sell, just trail SL to T1 */
  t2Qty: number
  t1Hit: boolean
  t2Hit: boolean
  /** Which strategy was used — useful for logging */
  strategy: 'AI_WAVE_TARGETS' | 'DTE_RISK_MULTIPLES'
}

/**
 * Compute tiered profit targets for an options position.
 * Returns null if there is insufficient data to compute valid targets
 * (e.g. entry is at or below SL).
 */
export function computeTieredTargets(input: TieredTargetInput): TieredTargetResult | null {
  const { entryPrice, aiStopLoss, optionDelta, daysToExpiry, quantity, lotSize } = input

  // Guard: SL must be below entry for a BUY position
  if (!aiStopLoss || aiStopLoss >= entryPrice) return null

  const premiumRisk = entryPrice - aiStopLoss
  const aiTargets = translateAiTargets(input)

  if (!aiTargets || !areAiTargetsRealistic(aiTargets, entryPrice, daysToExpiry)) {
    return computeFallbackTargets(entryPrice, premiumRisk, daysToExpiry, quantity, lotSize)
  }

  const { t1Qty, t2Qty } = computeLotSplit(quantity, lotSize)
  const { t1Target, t2Target, t3Target } = aiTargets

  console.log(
    `[TierCalc] Strategy=AI_WAVE_TARGETS | Delta=${Math.abs(optionDelta).toFixed(2)} | ` +
      `T1=INR${t1Target} (${t1Qty}qty) | T2=INR${t2Target} (${t2Qty}qty) | T3=INR${t3Target} (runner)`
  )

  return { t1Target, t2Target, t3Target, t1Qty, t2Qty, t1Hit: false, t2Hit: false, strategy: 'AI_WAVE_TARGETS' }
}

interface PremiumTargets {
  t1Target: number
  t2Target: number
  t3Target: number
}

const roundToPaise = (value: number): number => parseFloat(value.toFixed(2))

/**
 * Strategy A: translate the AI's index-level targets into option premium targets via delta.
 * Returns null when a real delta or usable index targets are missing, so the caller falls back to Strategy B.
 */
function translateAiTargets(input: TieredTargetInput): PremiumTargets | null {
  const { entryPrice, optionDelta, aiIndexTargets, currentIndexPrice } = input
  const absDelta = Math.abs(optionDelta)

  if (absDelta <= 0.01 || !aiIndexTargets?.length || !currentIndexPrice || currentIndexPrice <= 0) return null

  const premiumTargets = aiIndexTargets.map((indexTarget) =>
    roundToPaise(entryPrice + Math.abs(indexTarget - currentIndexPrice) * absDelta)
  )

  const t1Target = premiumTargets[0] ?? entryPrice
  const t2Target = premiumTargets[1] ?? roundToPaise(t1Target + (t1Target - entryPrice) * 0.618)

  // T3: Fibonacci 1.618 extension of the T1->T2 gap
  const t3Target = roundToPaise(t2Target + (t2Target - t1Target) * 1.618)

  return { t1Target, t2Target, t3Target }
}

/** AI targets must sit above entry, be ordered, and keep T1 within realistic intraday bounds for the DTE. */
function areAiTargetsRealistic(targets: PremiumTargets, entryPrice: number, daysToExpiry: number): boolean {
  const { t1Target, t2Target } = targets
  const maxReasonableT1 = daysToExpiry < 1 ? entryPrice * 1.25 : entryPrice * 1.35
  const isRealistic = t1Target > entryPrice && t2Target > t1Target && t1Target <= maxReasonableT1

  if (!isRealistic) {
    console.warn(
      `[TierCalc] AI targets invalid or out-of-range for DTE=${daysToExpiry.toFixed(1)} (T1=${t1Target}, max=${maxReasonableT1.toFixed(2)}). Falling back to DTE multiples.`
    )
  }

  return isRealistic
}

function getDteMultipliers(daysToExpiry: number): { m1: number; m2: number; m3: number } {
  if (daysToExpiry < 1) return { m1: 0.5, m2: 1.0, m3: 1.75 }
  if (daysToExpiry < 2) return { m1: 0.6, m2: 1.25, m3: 2.0 }
  if (daysToExpiry < 5) return { m1: 0.75, m2: 1.5, m3: 2.5 }
  return { m1: 1.0, m2: 2.0, m3: 3.0 }
}

function computeFallbackTargets(
  entryPrice: number,
  premiumRisk: number,
  daysToExpiry: number,
  quantity: number,
  lotSize: number
): TieredTargetResult | null {
  const { m1, m2, m3 } = getDteMultipliers(daysToExpiry)

  const t1Target = parseFloat((entryPrice + m1 * premiumRisk).toFixed(2))
  const t2Target = parseFloat((entryPrice + m2 * premiumRisk).toFixed(2))
  const t3Target = parseFloat((entryPrice + m3 * premiumRisk).toFixed(2))

  const { t1Qty, t2Qty } = computeLotSplit(quantity, lotSize)

  console.log(
    `[TierCalc] Strategy=DTE_RISK_MULTIPLES | DTE=${daysToExpiry.toFixed(2)} | ` +
      `T1=INR${t1Target} (${t1Qty}qty) | T2=INR${t2Target} (${t2Qty}qty) | T3=INR${t3Target} (runner)`
  )

  return { t1Target, t2Target, t3Target, t1Qty, t2Qty, t1Hit: false, t2Hit: false, strategy: 'DTE_RISK_MULTIPLES' }
}

/**
 * Compute whole-lot partial exit quantities for T1 and T2.
 * All exits must be in whole lots - fractional exits are not possible for NIFTY/BANKNIFTY.
 */
function computeLotSplit(quantity: number, lotSize: number): { t1Qty: number; t2Qty: number } {
  const totalLots = Math.max(1, Math.round(quantity / lotSize))

  if (totalLots <= 1) {
    return { t1Qty: 0, t2Qty: quantity }
  }

  if (totalLots === 2) {
    return { t1Qty: lotSize, t2Qty: 0 }
  }

  const t1Lots = Math.min(2, Math.floor(totalLots * 0.34))
  const t2Lots = Math.floor((totalLots - t1Lots) / 2)
  return { t1Qty: t1Lots * lotSize, t2Qty: t2Lots * lotSize }
}
