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
  aiIndexTargets?: number[]
  /** Current live index price (NIFTY/BANKNIFTY) needed to translate index targets to premium */
  currentIndexPrice?: number
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
  const absDelta = Math.abs(optionDelta)

  // Strategy A requires a real delta to translate index points to premium.
  // If delta is missing or near-zero, fall through to Strategy B immediately.
  const canTranslate = absDelta > 0.01

  let t1Target: number
  let t2Target: number
  let t3Target: number
  let strategy: TieredTargetResult['strategy']

  // Strategy A: AI Wave/Fibonacci Index Targets
  const hasAiTargets =
    canTranslate &&
    input.aiIndexTargets &&
    input.aiIndexTargets.length >= 1 &&
    input.currentIndexPrice !== undefined &&
    input.currentIndexPrice > 0

  if (hasAiTargets) {
    const indexPrice = input.currentIndexPrice!
    const indexTargets = input.aiIndexTargets!

    // Translate each index target level to option premium gain to option price
    const premiumTargets = indexTargets.map((indexTarget) => {
      const indexGain = Math.abs(indexTarget - indexPrice)
      const premiumGain = indexGain * absDelta
      return parseFloat((entryPrice + premiumGain).toFixed(2))
    })

    t1Target = premiumTargets[0] ?? entryPrice
    t2Target =
      premiumTargets.length >= 2
        ? (premiumTargets[1] ?? t1Target)
        : parseFloat((t1Target + (t1Target - entryPrice) * 0.618).toFixed(2))

    // T3: Fibonacci 1.618 extension of the T1->T2 gap
    const t1t2Gap = t2Target - t1Target
    t3Target = parseFloat((t2Target + t1t2Gap * 1.618).toFixed(2))

    strategy = 'AI_WAVE_TARGETS'

    // Sanity check: if AI targets are below entry (bad data), fall back
    if (t1Target <= entryPrice || t2Target <= t1Target) {
      console.warn(
        `[TierCalc] AI targets invalid (T1=${t1Target}, entry=${entryPrice}). Falling back to DTE multiples.`
      )
      return computeFallbackTargets(entryPrice, premiumRisk, daysToExpiry, quantity, lotSize)
    }
  } else {
    return computeFallbackTargets(entryPrice, premiumRisk, daysToExpiry, quantity, lotSize)
  }

  const { t1Qty, t2Qty } = computeLotSplit(quantity, lotSize)

  console.log(
    `[TierCalc] Strategy=${strategy} | Delta=${absDelta.toFixed(2)} | ` +
      `T1=INR${t1Target} (${t1Qty}qty) | T2=INR${t2Target} (${t2Qty}qty) | T3=INR${t3Target} (runner)`
  )

  return { t1Target, t2Target, t3Target, t1Qty, t2Qty, t1Hit: false, t2Hit: false, strategy }
}

function computeFallbackTargets(
  entryPrice: number,
  premiumRisk: number,
  daysToExpiry: number,
  quantity: number,
  lotSize: number
): TieredTargetResult | null {
  let m1: number, m2: number, m3: number

  if (daysToExpiry < 1) {
    m1 = 0.5
    m2 = 1.0
    m3 = 1.75
  } else if (daysToExpiry < 2) {
    m1 = 0.6
    m2 = 1.25
    m3 = 2.0
  } else if (daysToExpiry < 5) {
    m1 = 0.75
    m2 = 1.5
    m3 = 2.5
  } else {
    m1 = 1.0
    m2 = 2.0
    m3 = 3.0
  }

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
