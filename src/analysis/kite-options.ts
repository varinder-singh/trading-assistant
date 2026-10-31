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
  yesterdayOi?: number | undefined
  intervalOi?: number | undefined
  buildup?: 'Long Buildup' | 'Short Buildup' | 'Short Covering' | 'Long Unwinding' | 'Neutral' | undefined
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
    const entries = Object.entries(quotes).flatMap(([key, q]): [string, { oi: number; ltp: number }][] =>
      q.oi === undefined ? [] : [[key, { oi: q.oi, ltp: q.last_price || 0 }]]
    )
    const data = new Map(entries)

    const cutoff = Date.now() - this.maxWindowMs
    this.snapshots = [...this.snapshots, { timestamp: Date.now(), data }].filter((s) => s.timestamp > cutoff)
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

function getBuildupState(coi: number, priceChange: number): KiteOptionOiRow['buildup'] {
  if (coi > 0) return priceChange >= 0 ? 'Long Buildup' : 'Short Buildup'
  if (coi < 0) return priceChange >= 0 ? 'Short Covering' : 'Long Unwinding'
  return 'Neutral'
}

function getMarketFlow(totalCoi: number, netDirectionalBias: number): KiteOptionsAnalysis['marketFlow'] {
  if (totalCoi > 0 && netDirectionalBias !== 0) {
    return netDirectionalBias > 0 ? 'LONG_BUILDUP' : 'SHORT_BUILDUP'
  }
  if (totalCoi < 0 && netDirectionalBias !== 0) {
    return netDirectionalBias > 0 ? 'SHORT_COVERING' : 'LONG_UNWINDING'
  }
  return 'NEUTRAL'
}

function getUnderlyingFlowSign(row: KiteOptionOiRow): number {
  if (!row.buildup || row.buildup === 'Neutral') return 0
  const isContractBullish = row.buildup === 'Long Buildup' || row.buildup === 'Short Covering'
  if (row.type === 'CE') {
    return isContractBullish ? 1 : -1
  }
  // For PE: Short Buildup (put writers adding support) or Long Unwinding (put buyers exiting) is bullish on underlying
  return isContractBullish ? -1 : 1
}

function getDeltaBounds(daysToExpiry: number): { minDelta: number; maxDelta: number } {
  if (daysToExpiry < 1) return { minDelta: 0.4, maxDelta: 0.65 }
  if (daysToExpiry < 2) return { minDelta: 0.3, maxDelta: 0.55 }
  return { minDelta: 0.2, maxDelta: 0.5 }
}

function resolveAtmStrike(instruments: KiteOptionInstrumentForAnalysis[], underlyingPrice?: number): number {
  if (!underlyingPrice || instruments.length === 0) return 0
  const uniqueStrikes = [...new Set(instruments.map((i) => i.strike))]
  if (uniqueStrikes.length === 0) return 0
  return uniqueStrikes.reduce((closest, strike) =>
    Math.abs(strike - underlyingPrice) < Math.abs(closest - underlyingPrice) ? strike : closest
  )
}

function resolveGlobalDaysToExpiry(instruments: KiteOptionInstrumentForAnalysis[]): number {
  const firstInstrument = instruments.find((i) => i.expiry)
  if (!firstInstrument?.expiry) return 0
  const today = new Date()
  const expiryDate = new Date(firstInstrument.expiry)
  expiryDate.setHours(15, 30, 0, 0)
  return Math.max(0.001, (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function buildOptionRow(
  inst: KiteOptionInstrumentForAnalysis,
  quotes: Record<string, KiteOptionQuote>,
  windowSnapshot: { timestamp: number; data: Map<string, { oi: number; ltp: number }> } | null,
  yesterdayOiMap: Map<number, number> | undefined,
  underlyingPrice: number | undefined,
  globalDaysToExpiry: number
): KiteOptionOiRow | null {
  const key = `NFO:${inst.tradingsymbol}`
  const q = quotes[key]
  if (!q) return null

  const currentOi = q.oi ?? 0
  const ltp = q.last_price ?? 0
  const snapshot = windowSnapshot?.data.get(key)
  const yOi = inst.instrument_token ? yesterdayOiMap?.get(inst.instrument_token) : undefined
  const coi = snapshot ? currentOi - snapshot.oi : yOi !== undefined ? currentOi - yOi : 0
  const priceChange = snapshot ? ltp - snapshot.ltp : 0
  const buildup = getBuildupState(coi, priceChange)

  const greeks =
    q.greeks ||
    (underlyingPrice && inst.expiry
      ? getGreeksFromPrice(ltp, underlyingPrice, inst.strike, globalDaysToExpiry || 0.001, 0.07, inst.instrument_type)
      : undefined)

  return {
    strike: inst.strike,
    type: inst.instrument_type,
    symbol: inst.tradingsymbol,
    oi: currentOi,
    ltp,
    volume: q.volume ?? 0,
    intervalOi: coi,
    buildup,
    greeks,
    ...(yOi !== undefined ? { yesterdayOi: yOi } : {}),
  }
}

function aggregateOptionMetrics(rows: KiteOptionOiRow[], atmStrike: number) {
  return rows.reduce(
    (acc, row) => {
      if (row.type === 'CE') {
        const isNewMax = row.oi > acc.maxCallOI
        return {
          ...acc,
          callOI: acc.callOI + row.oi,
          atmCallOI: row.strike === atmStrike ? row.oi : acc.atmCallOI,
          maxCallOI: isNewMax ? row.oi : acc.maxCallOI,
          resistance: isNewMax ? row.strike : acc.resistance,
        }
      }
      const isNewMax = row.oi > acc.maxPutOI
      return {
        ...acc,
        putOI: acc.putOI + row.oi,
        atmPutOI: row.strike === atmStrike ? row.oi : acc.atmPutOI,
        maxPutOI: isNewMax ? row.oi : acc.maxPutOI,
        support: isNewMax ? row.strike : acc.support,
      }
    },
    { callOI: 0, putOI: 0, atmCallOI: 0, atmPutOI: 0, maxCallOI: 0, maxPutOI: 0, resistance: 0, support: 0 }
  )
}

function getBestGammaStrike(optionRows: KiteOptionOiRow[], daysToExpiry: number, atmStrike: number) {
  const { minDelta, maxDelta } = getDeltaBounds(daysToExpiry)
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

  return validRows.reduce((best, current) =>
    current.greeks!.gamma / current.ltp > best.greeks!.gamma / best.ltp ? current : best
  )
}

function toStrikeRecommendation(bestRow: KiteOptionOiRow | null, atmStrike: number, dteLabel: string) {
  if (!bestRow?.greeks) {
    return { strike: atmStrike, rationale: 'Default ATM', expectedGamma: 0, gammaPremiumRatio: 0 }
  }
  const ratio = bestRow.greeks.gamma / bestRow.ltp
  return {
    strike: bestRow.strike,
    rationale: `[${dteLabel}] Optimal Gamma/Premium ratio (${ratio.toFixed(5)}, delta ${Math.abs(bestRow.greeks.delta).toFixed(2)}) targeting ATM gamma sweet spot.`,
    expectedGamma: bestRow.greeks.gamma,
    gammaPremiumRatio: ratio,
  }
}

function buildGreeksContext(rows: KiteOptionOiRow[], atmStrike: number, globalDaysToExpiry: number) {
  const ceRows = rows.filter((r) => r.type === 'CE' && r.ltp > 0 && r.greeks)
  const peRows = rows.filter((r) => r.type === 'PE' && r.ltp > 0 && r.greeks)
  const atmCe = ceRows.find((r) => r.strike === atmStrike)
  const atmPe = peRows.find((r) => r.strike === atmStrike)
  const atmGreeks = atmCe?.greeks
    ? { ...atmCe.greeks }
    : atmPe?.greeks
      ? { ...atmPe.greeks }
      : { delta: 0, gamma: 0, theta: 0, iv: 0, vega: 0 }

  const dteLabel =
    globalDaysToExpiry < 1 ? '0DTE' : globalDaysToExpiry < 2 ? '1DTE' : `${globalDaysToExpiry.toFixed(1)}DTE`

  return {
    daysToExpiry: globalDaysToExpiry,
    atmGreeks,
    recommendedBuyStrikeCE: toStrikeRecommendation(
      getBestGammaStrike(ceRows, globalDaysToExpiry, atmStrike),
      atmStrike,
      dteLabel
    ),
    recommendedBuyStrikePE: toStrikeRecommendation(
      getBestGammaStrike(peRows, globalDaysToExpiry, atmStrike),
      atmStrike,
      dteLabel
    ),
  }
}

export function analyzeOptions(
  quotes: Record<string, KiteOptionQuote>,
  instruments: KiteOptionInstrumentForAnalysis[],
  underlyingPrice?: number,
  yesterdayOiMap?: Map<number, number>,
  intervalMins: number = 5
): KiteOptionsAnalysis {
  oiTracker.addSnapshot(quotes)
  const windowSnapshot = oiTracker.getSnapshot(intervalMins)
  const atmStrike = resolveAtmStrike(instruments, underlyingPrice)
  const globalDaysToExpiry = resolveGlobalDaysToExpiry(instruments)

  const rows = instruments.flatMap((inst) => {
    const row = buildOptionRow(inst, quotes, windowSnapshot, yesterdayOiMap, underlyingPrice, globalDaysToExpiry)
    return row ? [row] : []
  })

  const { callOI, putOI, atmCallOI, atmPutOI, maxCallOI, maxPutOI, resistance, support } = aggregateOptionMetrics(
    rows,
    atmStrike
  )

  const pcr = callOI > 0 ? putOI / callOI : 0
  const pcrAtm = atmCallOI > 0 ? atmPutOI / atmCallOI : 0

  const { totalCoi, netDirectionalBias } = rows.reduce(
    (acc, row) => {
      if (!row.intervalOi) return acc
      const sign = getUnderlyingFlowSign(row)
      return {
        totalCoi: acc.totalCoi + row.intervalOi,
        netDirectionalBias: acc.netDirectionalBias + Math.abs(row.intervalOi) * sign,
      }
    },
    { totalCoi: 0, netDirectionalBias: 0 }
  )

  const marketFlow = getMarketFlow(totalCoi, netDirectionalBias)
  const sentiment = pcr > 1.2 ? 'bullish' : pcr < 0.8 ? 'bearish' : 'neutral'
  const atmSentiment = pcrAtm > 1.2 ? 'bullish' : pcrAtm < 0.8 ? 'bearish' : 'neutral'
  const greeksContext = buildGreeksContext(rows, atmStrike, globalDaysToExpiry)

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
    rows: [...rows].sort((a, b) => a.strike - b.strike || a.type.localeCompare(b.type)),
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

function toLogRow(strike: number, rows: KiteOptionOiRow[]): KiteOptionsLogRow {
  const ce = rows.find((row) => row.strike === strike && row.type === 'CE')
  const pe = rows.find((row) => row.strike === strike && row.type === 'PE')

  return {
    strike,
    ceSymbol: ce?.symbol ?? 'N/A',
    ceOi: ce?.oi ?? 0,
    ceLtp: ce?.ltp ?? 0,
    ceVolume: ce?.volume ?? 0,
    peSymbol: pe?.symbol ?? 'N/A',
    peOi: pe?.oi ?? 0,
    peLtp: pe?.ltp ?? 0,
    peVolume: pe?.volume ?? 0,
  }
}

export function formatOptionsAnalysisForLog(analysis: KiteOptionsAnalysis): string[] {
  const formatNumber = (value: number) => value.toLocaleString('en-IN')
  const formatPrice = (value: number) => value.toFixed(2)
  const formatLevel = (value: number) => (value > 0 ? formatNumber(value) : 'N/A')

  const strikes = [...new Set(analysis.rows.map((row) => row.strike))].sort((first, second) => first - second)
  const strikeRows = strikes.map((strike) => toLogRow(strike, analysis.rows))
  const summaryLines = [
    `PCR (Aggregate): ${analysis.pcr.toFixed(2)} (${analysis.sentiment.toUpperCase()}) | PCR (ATM ${analysis.atmStrike}): ${analysis.pcrAtm.toFixed(2)} (${analysis.atmSentiment.toUpperCase()})`,
    `Total Call OI: ${formatNumber(analysis.callOI)} | Total Put OI: ${formatNumber(analysis.putOI)}`,
    `ATM Call OI: ${formatNumber(analysis.atmCallOI)} | ATM Put OI: ${formatNumber(analysis.atmPutOI)}`,
    `Max Call OI: ${formatNumber(analysis.maxCallOI)} | Max Put OI: ${formatNumber(analysis.maxPutOI)}`,
    `OI Support: ${formatLevel(analysis.support)} (${formatNumber(analysis.maxPutOI)} PE OI)`,
    `OI Resistance: ${formatLevel(analysis.resistance)} (${formatNumber(analysis.maxCallOI)} CE OI)`,
    `Contracts Analyzed: ${formatNumber(analysis.rows.length)}`,
  ]

  const windowStatsLines = analysis.windowStats
    ? [
        `Window Stats (${analysis.windowStats.intervalMins}m):`,
        `  Top Short Covering: ${analysis.windowStats.topShortCovering.map((r) => `${r.strike} ${r.type} (${r.intervalOi})`).join(', ')}`,
        `  Top Long Buildup: ${analysis.windowStats.topLongBuildup.map((r) => `${r.strike} ${r.type} (+${r.intervalOi})`).join(', ')}`,
      ]
    : []

  const snapshotLines = strikeRows.map((row) =>
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

  return [...summaryLines, ...windowStatsLines, 'Strike OI Snapshot:', ...snapshotLines]
}
