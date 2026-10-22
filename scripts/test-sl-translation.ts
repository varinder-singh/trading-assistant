// scripts/test-sl-translation.ts
export interface StopLossTranslationParams {
  candidateSl: number
  underlyingSpot: number
  optionPrice: number
  delta: number
  agentType?: string
}

export function translateStopLossToPremium(params: StopLossTranslationParams): {
  premiumSl: number
  optionRiskPoints: number
  detectedType: 'SPOT_LEVEL' | 'PREMIUM_LEVEL'
} {
  const { candidateSl, underlyingSpot, optionPrice, delta, agentType } = params

  // Calculate relative distance from candidate SL to spot and premium
  const distFromSpot = Math.abs(candidateSl - underlyingSpot) / underlyingSpot
  const distFromPremium = Math.abs(candidateSl - optionPrice) / Math.max(optionPrice, 0.05)

  // If candidate SL is within 25% of underlying spot, it is undeniably an underlying level
  // If it is closer to option premium (and vastly distant from spot), it is a premium level
  const isSpotLevel = distFromSpot < 0.25 || distFromSpot < distFromPremium

  if (!isSpotLevel) {
    // Already in premium space
    const premiumSl = Math.max(candidateSl, 0.05)
    return {
      premiumSl,
      optionRiskPoints: Math.abs(optionPrice - premiumSl),
      detectedType: 'PREMIUM_LEVEL',
    }
  }

  // Translate underlying spot risk into option premium risk using Black-Scholes Delta
  const underlyingRiskPoints = Math.abs(underlyingSpot - candidateSl)
  const absDelta = Math.abs(delta)
  const effectiveDelta = agentType === 'TREND' ? Math.max(0.1, absDelta * 0.9) : Math.max(0.1, absDelta)

  const optionRiskPoints = underlyingRiskPoints * effectiveDelta
  const premiumSl = Math.max(optionPrice - optionRiskPoints, 0.05)

  return {
    premiumSl,
    optionRiskPoints,
    detectedType: 'SPOT_LEVEL',
  }
}

// Old flawed logic from paper-trader.ts:309
function oldTranslate(
  newIndexStopLoss: number,
  currentPrice: number,
  currentIndexPrice: number,
  delta: number,
  agentType: string
) {
  let newPremiumSl: number
  let optionRiskPoints: number
  let detectedType: string

  if (newIndexStopLoss < 1000) {
    detectedType = 'PREMIUM_LEVEL'
    newPremiumSl = newIndexStopLoss
    optionRiskPoints = Math.abs(currentPrice - newPremiumSl)
  } else {
    detectedType = 'SPOT_LEVEL'
    const indexRiskPoints = Math.abs(currentIndexPrice - newIndexStopLoss)
    const dynamicDelta = delta ? Math.abs(delta) : agentType === 'TREND' ? 0.45 : 0.6
    const effectiveDelta = agentType === 'TREND' ? Math.max(0.1, dynamicDelta * 0.9) : Math.max(0.1, dynamicDelta)
    optionRiskPoints = indexRiskPoints * effectiveDelta
    newPremiumSl = currentPrice - optionRiskPoints
  }
  return { newPremiumSl, optionRiskPoints, detectedType }
}

const testCases = [
  // Low-priced stocks (< 1000) with SPOT SL
  { stock: 'TATASTEEL', spot: 150, option: 4.2, delta: 0.55, sl: 146, type: 'SPOT', agent: 'SCALPER' },
  { stock: 'ITC', spot: 430, option: 6.5, delta: 0.52, sl: 424, type: 'SPOT', agent: 'SCALPER' },
  { stock: 'SBIN', spot: 800, option: 18.0, delta: 0.5, sl: 785, type: 'SPOT', agent: 'SCALPER' },
  { stock: 'COALINDIA', spot: 480, option: 12.0, delta: 0.48, sl: 472, type: 'SPOT', agent: 'TREND' },
  { stock: 'TATAMOTORS', spot: 920, option: 22.0, delta: 0.53, sl: 905, type: 'SPOT', agent: 'TREND' },

  // Low-priced stocks (< 1000) with direct PREMIUM SL
  { stock: 'TATASTEEL', spot: 150, option: 4.2, delta: 0.55, sl: 2.5, type: 'PREMIUM', agent: 'SCALPER' },
  { stock: 'ITC', spot: 430, option: 6.5, delta: 0.52, sl: 4.0, type: 'PREMIUM', agent: 'SCALPER' },
  { stock: 'SBIN', spot: 800, option: 18.0, delta: 0.5, sl: 11.5, type: 'PREMIUM', agent: 'SCALPER' },

  // Mid & High priced stocks (> 1000)
  { stock: 'RELIANCE', spot: 2500, option: 45.0, delta: 0.5, sl: 2470, type: 'SPOT', agent: 'SCALPER' },
  { stock: 'RELIANCE', spot: 2500, option: 45.0, delta: 0.5, sl: 30.0, type: 'PREMIUM', agent: 'SCALPER' },
  { stock: 'MARUTI', spot: 12000, option: 250.0, delta: 0.5, sl: 11850, type: 'SPOT', agent: 'SCALPER' },
  { stock: 'MARUTI', spot: 12000, option: 250.0, delta: 0.5, sl: 175.0, type: 'PREMIUM', agent: 'SCALPER' },

  // Index (NIFTY)
  { stock: 'NIFTY', spot: 25000, option: 120.0, delta: 0.5, sl: 24900, type: 'SPOT', agent: 'SCALPER' },
  { stock: 'NIFTY', spot: 25000, option: 120.0, delta: 0.5, sl: 70.0, type: 'PREMIUM', agent: 'SCALPER' },
]

console.log('='.repeat(90))
console.log('EMPIRICAL EVALUATION: OLD (< 1000) vs NEW SPOT-RELATIVE SL TRANSLATION')
console.log('='.repeat(90))

for (const tc of testCases) {
  const oldRes = oldTranslate(tc.sl, tc.option, tc.spot, tc.delta, tc.agent)
  const newRes = translateStopLossToPremium({
    candidateSl: tc.sl,
    underlyingSpot: tc.spot,
    optionPrice: tc.option,
    delta: tc.delta,
    agentType: tc.agent,
  })

  const oldBugged =
    (tc.type === 'SPOT' && oldRes.detectedType === 'PREMIUM_LEVEL') ||
    (tc.type === 'PREMIUM' && oldRes.detectedType === 'SPOT_LEVEL')

  const newCorrect =
    (tc.type === 'SPOT' && newRes.detectedType === 'SPOT_LEVEL') ||
    (tc.type === 'PREMIUM' && newRes.detectedType === 'PREMIUM_LEVEL')

  console.log(`\nStock: ${tc.stock} (Spot: ₹${tc.spot}, Opt: ₹${tc.option}, Expected: ${tc.type} SL = ${tc.sl})`)
  console.log(
    `  OLD: Detected=${oldRes.detectedType} | SL=₹${oldRes.newPremiumSl.toFixed(2)} | Risk=₹${oldRes.optionRiskPoints.toFixed(2)} | Status: ${oldBugged ? '❌ BUGGED (Fatal SL mismatch!)' : '✅ OK'}`
  )
  console.log(
    `  NEW: Detected=${newRes.detectedType} | SL=₹${newRes.premiumSl.toFixed(2)} | Risk=₹${newRes.optionRiskPoints.toFixed(2)} | Status: ${newCorrect ? '✅ CORRECT' : '❌ FAILED'}`
  )
}
