export type KiteOptionQuote = {
  last_price?: number
  oi?: number
  volume?: number
  greeks?: { iv: number; delta: number; gamma: number; theta: number; vega: number } | undefined
}

export type KiteOptionInstrumentForAnalysis = {
  instrument_type: 'CE' | 'PE'
  strike: number
  tradingsymbol: string
  instrument_token?: number
  expiry?: string
}

export type KiteOptionOiRow = {
  strike: number
  type: 'CE' | 'PE'
  symbol: string
  oi: number
  ltp: number
  volume: number
  yesterdayOi?: number
  intervalOi?: number
  buildup?: 'Long Buildup' | 'Short Buildup' | 'Short Covering' | 'Long Unwinding' | 'Neutral'
  greeks?:
    | {
        iv: number
        delta: number
        gamma: number
        theta: number
        vega: number
      }
    | undefined
}

export type KiteOptionsAnalysis = {
  pcr: number
  pcrAtm: number
  atmStrike: number
  callOI: number
  putOI: number
  atmCallOI: number
  atmPutOI: number
  maxCallOI: number
  maxPutOI: number
  sentiment: 'bullish' | 'bearish' | 'neutral'
  atmSentiment: 'bullish' | 'bearish' | 'neutral'
  support: number
  resistance: number
  marketFlow: 'SHORT_COVERING' | 'LONG_BUILDUP' | 'SHORT_BUILDUP' | 'LONG_UNWINDING' | 'NEUTRAL'
  ivRank?: number
  ivPercentile?: number
  rows: KiteOptionOiRow[]
  greeksContext?: {
    daysToExpiry: number
    atmGreeks: { delta: number; gamma: number; theta: number; iv: number; vega: number }
    recommendedBuyStrikeCE: { strike: number; rationale: string; expectedGamma: number; gammaPremiumRatio: number }
    recommendedBuyStrikePE: { strike: number; rationale: string; expectedGamma: number; gammaPremiumRatio: number }
  }
  windowStats?: {
    topShortCovering: KiteOptionOiRow[]
    topLongBuildup: KiteOptionOiRow[]
    intervalMins: number
  }
}

// Singleton for tracking OI snapshots
class OITracker {
  private snapshots: { timestamp: number; data: Map<string, { oi: number; ltp: number }> }[] = []
  private readonly maxWindowMs = 60 * 60 * 1000 // Keep 1 hour of snapshots

  addSnapshot(quotes: Record<string, KiteOptionQuote>) {
    const data = new Map<string, { oi: number; ltp: number }>()
    for (const [key, q] of Object.entries(quotes)) {
      if (q.oi !== undefined) {
        data.set(key, { oi: q.oi, ltp: q.last_price || 0 })
      }
    }
    this.snapshots.push({ timestamp: Date.now(), data })

    // Cleanup old snapshots
    const cutoff = Date.now() - this.maxWindowMs
    this.snapshots = this.snapshots.filter((s) => s.timestamp > cutoff)
  }

  getSnapshot(minutesAgo: number) {
    if (this.snapshots.length === 0) return null
    const targetTime = Date.now() - minutesAgo * 60 * 1000

    // If the oldest snapshot we have is newer than our target, we don't have enough history
    const first = this.snapshots[0]
    if (first && first.timestamp > targetTime + 30000) return null // 30s grace

    return this.snapshots.reduce((prev, curr) =>
      Math.abs(curr.timestamp - targetTime) < Math.abs(prev.timestamp - targetTime) ? curr : prev
    )
  }
}

export const oiTracker = new OITracker()

import { getGreeksFromPrice } from './greeks.js'

export function analyzeOptions(
  quotes: Record<string, KiteOptionQuote>,
  instruments: KiteOptionInstrumentForAnalysis[],
  underlyingPrice?: number,
  yesterdayOiMap?: Map<number, number>,
  intervalMins: number = 5
): KiteOptionsAnalysis {
  // Store snapshot for future window comparisons
  oiTracker.addSnapshot(quotes)
  const windowSnapshot = oiTracker.getSnapshot(intervalMins)

  let callOI = 0
  let putOI = 0
  let maxCallOI = 0
  let maxPutOI = 0
  let resistance = 0
  let support = 0
  const rows: KiteOptionOiRow[] = []

  let atmStrike = 0
  let atmCallOI = 0
  let atmPutOI = 0

  if (underlyingPrice && instruments.length > 0) {
    const uniqueStrikes = [...new Set(instruments.map((i) => i.strike))]
    if (uniqueStrikes.length > 0) {
      atmStrike = uniqueStrikes.reduce((closest, strike) =>
        Math.abs(strike - underlyingPrice) < Math.abs(closest - underlyingPrice) ? strike : closest
      )
    }
  }

  // Calculate global days to expiry
  let globalDaysToExpiry = 0
  const firstInstrument = instruments.find((i) => i.expiry)
  if (firstInstrument && firstInstrument.expiry) {
    const today = new Date()
    const expiryDate = new Date(firstInstrument.expiry)
    expiryDate.setHours(15, 30, 0, 0)
    globalDaysToExpiry = Math.max(0.001, (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  }

  for (const inst of instruments) {
    const key = `NFO:${inst.tradingsymbol}`
    const q = quotes[key]
    if (!q) continue

    const currentOi = q.oi ?? 0
    const ltp = q.last_price ?? 0

    // 1. Calculate Shift since intervalMins ago
    const snapshot = windowSnapshot?.data.get(key)
    const coi = snapshot ? currentOi - snapshot.oi : 0
    const priceChange = snapshot ? ltp - snapshot.ltp : 0

    // 2. Determine Buildup State
    let buildup: KiteOptionOiRow['buildup'] = 'Neutral'
    if (coi > 0) {
      buildup = priceChange >= 0 ? 'Long Buildup' : 'Short Buildup'
    } else if (coi < 0) {
      buildup = priceChange >= 0 ? 'Short Covering' : 'Long Unwinding'
    }

    // 3. Yesterday's Comparison
    const yOi = inst.instrument_token ? yesterdayOiMap?.get(inst.instrument_token) : undefined

    let greeks = q.greeks || undefined
    if (!greeks && underlyingPrice && inst.expiry) {
      greeks = getGreeksFromPrice(
        ltp,
        underlyingPrice,
        inst.strike,
        globalDaysToExpiry || 0.001,
        0.07,
        inst.instrument_type
      )
    }

    const row: KiteOptionOiRow = {
      strike: inst.strike,
      type: inst.instrument_type,
      symbol: inst.tradingsymbol,
      oi: currentOi,
      ltp: ltp,
      volume: q.volume ?? 0,
      intervalOi: coi,
      buildup,
      greeks,
    }
    if (yOi !== undefined) row.yesterdayOi = yOi
    rows.push(row)

    if (inst.instrument_type === 'CE') {
      callOI += currentOi
      if (inst.strike === atmStrike) atmCallOI = currentOi
      if (currentOi > maxCallOI) {
        maxCallOI = currentOi
        resistance = inst.strike
      }
    } else {
      putOI += currentOi
      if (inst.strike === atmStrike) atmPutOI = currentOi
      if (currentOi > maxPutOI) {
        maxPutOI = currentOi
        support = inst.strike
      }
    }
  }

  const pcr = callOI > 0 ? putOI / callOI : 0
  const pcrAtm = atmCallOI > 0 ? atmPutOI / atmCallOI : 0

  // Aggregate Market Flow Calculation
  let totalCoi = 0
  let weightedPriceChange = 0
  for (const row of rows) {
    if (row.intervalOi) {
      totalCoi += row.intervalOi
      weightedPriceChange +=
        row.intervalOi * (row.buildup === 'Short Covering' || row.buildup === 'Long Buildup' ? 1 : -1)
    }
  }

  let marketFlow: KiteOptionsAnalysis['marketFlow'] = 'NEUTRAL'
  if (totalCoi > 0) {
    marketFlow = weightedPriceChange > 0 ? 'LONG_BUILDUP' : 'SHORT_BUILDUP'
  } else if (totalCoi < 0) {
    marketFlow = weightedPriceChange > 0 ? 'SHORT_COVERING' : 'LONG_UNWINDING'
  }

  // CONTRARIAN PCR LOGIC (Matches AI Rules)
  const sentiment = pcr > 1.2 ? 'bullish' : pcr < 0.8 ? 'bearish' : 'neutral'
  const atmSentiment = pcrAtm > 1.2 ? 'bullish' : pcrAtm < 0.8 ? 'bearish' : 'neutral'

  // Greeks Context and Strike Selection
  let atmGreeks = { delta: 0, gamma: 0, theta: 0, iv: 0, vega: 0 }
  const ceRows = rows.filter((r) => r.type === 'CE' && r.ltp > 0 && r.greeks)
  const peRows = rows.filter((r) => r.type === 'PE' && r.ltp > 0 && r.greeks)

  const atmCe = ceRows.find((r) => r.strike === atmStrike)
  if (atmCe && atmCe.greeks) {
    atmGreeks = { ...atmCe.greeks }
  } else {
    const atmPe = peRows.find((r) => r.strike === atmStrike)
    if (atmPe && atmPe.greeks) {
      atmGreeks = { ...atmPe.greeks }
    }
  }

  const getBestGammaStrike = (optionRows: KiteOptionOiRow[], daysToExpiry: number) => {
    // DTE-aware delta bands:
    // 0DTE (< 1 day):   0.40 – 0.65 → Allow slightly ITM (up to 0.65) for theta protection during consolidations, targeting ATM gamma.
    // 1-2 DTE:          0.30 – 0.55 → Slightly wider to allow near-ATM strikes with better leverage
    // 2+ DTE:           0.20 – 0.50 → Allow slightly OTM for superior percentage returns and gamma leverage
    let minDelta: number, maxDelta: number
    if (daysToExpiry < 1) {
      minDelta = 0.4
      maxDelta = 0.65
    } else if (daysToExpiry < 2) {
      minDelta = 0.3
      maxDelta = 0.55
    } else {
      minDelta = 0.2
      maxDelta = 0.5
    }

    const validRows = optionRows.filter((r) => {
      if (!r.greeks) return false
      const absDelta = Math.abs(r.greeks.delta)
      return absDelta >= minDelta && absDelta <= maxDelta
    })

    if (validRows.length === 0) {
      const atmOption = optionRows.find((r) => r.strike === atmStrike)
      if (atmOption) return atmOption
      if (optionRows.length === 0) return null
      return optionRows.reduce((closest, current) =>
        Math.abs(current.strike - atmStrike) < Math.abs(closest.strike - atmStrike) ? current : closest
      )
    }

    return validRows.reduce((best, current) => {
      const bestRatio = best.greeks!.gamma / best.ltp
      const currentRatio = current.greeks!.gamma / current.ltp
      return currentRatio > bestRatio ? current : best
    })
  }

  const dteLabel =
    globalDaysToExpiry < 1 ? '0DTE' : globalDaysToExpiry < 2 ? '1DTE' : `${globalDaysToExpiry.toFixed(1)}DTE`
  const bestCe = getBestGammaStrike(ceRows, globalDaysToExpiry)
  const bestPe = getBestGammaStrike(peRows, globalDaysToExpiry)

  const greeksContext = {
    daysToExpiry: globalDaysToExpiry,
    atmGreeks,
    recommendedBuyStrikeCE: bestCe
      ? {
          strike: bestCe.strike,
          rationale: `[${dteLabel}] Optimal Gamma/Premium ratio (${(bestCe.greeks!.gamma / bestCe.ltp).toFixed(5)}, delta ${Math.abs(bestCe.greeks!.delta).toFixed(2)}) targeting ATM gamma sweet spot.`,
          expectedGamma: bestCe.greeks!.gamma,
          gammaPremiumRatio: bestCe.greeks!.gamma / bestCe.ltp,
        }
      : { strike: atmStrike, rationale: 'Default ATM', expectedGamma: 0, gammaPremiumRatio: 0 },
    recommendedBuyStrikePE: bestPe
      ? {
          strike: bestPe.strike,
          rationale: `[${dteLabel}] Optimal Gamma/Premium ratio (${(bestPe.greeks!.gamma / bestPe.ltp).toFixed(5)}, delta ${Math.abs(bestPe.greeks!.delta).toFixed(2)}) targeting ATM gamma sweet spot.`,
          expectedGamma: bestPe.greeks!.gamma,
          gammaPremiumRatio: bestPe.greeks!.gamma / bestPe.ltp,
        }
      : { strike: atmStrike, rationale: 'Default ATM', expectedGamma: 0, gammaPremiumRatio: 0 },
  }

  return {
    pcr: Number(pcr.toFixed(2)),
    pcrAtm: Number(pcrAtm.toFixed(2)),
    atmStrike,
    callOI,
    putOI,
    atmCallOI,
    atmPutOI,
    maxCallOI,
    maxPutOI,
    sentiment,
    atmSentiment,
    support,
    resistance,
    marketFlow,
    greeksContext,
    rows: rows.sort((a, b) => a.strike - b.strike || a.type.localeCompare(b.type)),
    windowStats: {
      topShortCovering: [...rows]
        .filter((r) => r.buildup === 'Short Covering')
        .sort((a, b) => (a.intervalOi || 0) - (b.intervalOi || 0))
        .slice(0, 3),
      topLongBuildup: [...rows]
        .filter((r) => r.buildup === 'Long Buildup')
        .sort((a, b) => (b.intervalOi || 0) - (a.intervalOi || 0))
        .slice(0, 3),
      intervalMins,
    },
  }
}

export type KiteOptionsLogRow = {
  strike: number
  ceSymbol: string
  ceOi: number
  ceLtp: number
  ceVolume: number
  peSymbol: string
  peOi: number
  peLtp: number
  peVolume: number
}

export function formatOptionsAnalysisForLog(analysis: KiteOptionsAnalysis): string[] {
  const formatNumber = (value: number) => value.toLocaleString('en-IN')
  const formatPrice = (value: number) => value.toFixed(2)
  const formatLevel = (value: number) => (value > 0 ? formatNumber(value) : 'N/A')

  const rowsByStrike = new Map<number, KiteOptionsLogRow>()

  for (const row of analysis.rows) {
    const strikeRow = rowsByStrike.get(row.strike) ?? {
      strike: row.strike,
      ceSymbol: 'N/A',
      ceOi: 0,
      ceLtp: 0,
      ceVolume: 0,
      peSymbol: 'N/A',
      peOi: 0,
      peLtp: 0,
      peVolume: 0,
    }

    if (row.type === 'CE') {
      strikeRow.ceSymbol = row.symbol
      strikeRow.ceOi = row.oi
      strikeRow.ceLtp = row.ltp
      strikeRow.ceVolume = row.volume
    } else {
      strikeRow.peSymbol = row.symbol
      strikeRow.peOi = row.oi
      strikeRow.peLtp = row.ltp
      strikeRow.peVolume = row.volume
    }

    rowsByStrike.set(row.strike, strikeRow)
  }

  const strikeRows = Array.from(rowsByStrike.values()).sort((first, second) => first.strike - second.strike)

  const log = [
    `PCR (Aggregate): ${analysis.pcr.toFixed(2)} (${analysis.sentiment.toUpperCase()}) | PCR (ATM ${analysis.atmStrike}): ${analysis.pcrAtm.toFixed(2)} (${analysis.atmSentiment.toUpperCase()})`,
    `Total Call OI: ${formatNumber(analysis.callOI)} | Total Put OI: ${formatNumber(analysis.putOI)}`,
    `ATM Call OI: ${formatNumber(analysis.atmCallOI)} | ATM Put OI: ${formatNumber(analysis.atmPutOI)}`,
    `Max Call OI: ${formatNumber(analysis.maxCallOI)} | Max Put OI: ${formatNumber(analysis.maxPutOI)}`,
    `OI Support: ${formatLevel(analysis.support)} (${formatNumber(analysis.maxPutOI)} PE OI)`,
    `OI Resistance: ${formatLevel(analysis.resistance)} (${formatNumber(analysis.maxCallOI)} CE OI)`,
    `Contracts Analyzed: ${formatNumber(analysis.rows.length)}`,
  ]

  if (analysis.windowStats) {
    log.push(`Window Stats (${analysis.windowStats.intervalMins}m):`)
    log.push(
      `  Top Short Covering: ${analysis.windowStats.topShortCovering.map((r) => `${r.strike} ${r.type} (${r.intervalOi})`).join(', ')}`
    )
    log.push(
      `  Top Long Buildup: ${analysis.windowStats.topLongBuildup.map((r) => `${r.strike} ${r.type} (+${r.intervalOi})`).join(', ')}`
    )
  }

  log.push('Strike OI Snapshot:')
  log.push(
    ...strikeRows.map((row) =>
      [
        `  ${formatNumber(row.strike)}`,
        `CE ${row.ceSymbol}`,
        `CE OI ${formatNumber(row.ceOi)}`,
        `CE LTP ${formatPrice(row.ceLtp)}`,
        `PE ${row.peSymbol}`,
        `PE OI ${formatNumber(row.peOi)}`,
        `PE LTP ${formatPrice(row.peLtp)}`,
      ].join(' | ')
    )
  )

  return log
}
