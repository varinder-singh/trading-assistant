export type KiteOptionQuote = {
  last_price?: number
  oi?: number
  volume?: number
}

export type KiteOptionInstrumentForAnalysis = {
  instrument_type: "CE" | "PE"
  strike: number
  tradingsymbol: string
  instrument_token?: number
}

export type KiteOptionOiRow = {
  strike: number
  type: "CE" | "PE"
  symbol: string
  oi: number
  ltp: number
  volume: number
  yesterdayOi?: number
  intervalOi?: number
  buildup?: "Long Buildup" | "Short Buildup" | "Short Covering" | "Long Unwinding" | "Neutral"
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
  sentiment: "bullish" | "bearish" | "neutral"
  atmSentiment: "bullish" | "bearish" | "neutral"
  support: number
  resistance: number
  rows: KiteOptionOiRow[]
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
    let buildup: KiteOptionOiRow["buildup"] = "Neutral"
    if (coi > 0) {
      buildup = priceChange >= 0 ? "Long Buildup" : "Short Buildup"
    } else if (coi < 0) {
      buildup = priceChange >= 0 ? "Short Covering" : "Long Unwinding"
    }

    // 3. Yesterday's Comparison
    const yOi = inst.instrument_token ? yesterdayOiMap?.get(inst.instrument_token) : undefined

    const row: KiteOptionOiRow = {
      strike: inst.strike,
      type: inst.instrument_type,
      symbol: inst.tradingsymbol,
      oi: currentOi,
      ltp: ltp,
      volume: q.volume ?? 0,
      intervalOi: coi,
      buildup,
    }
    if (yOi !== undefined) row.yesterdayOi = yOi
    rows.push(row)

    if (inst.instrument_type === "CE") {
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

  // CONTRARIAN PCR LOGIC (Matches AI Rules)
  // High PCR (>1.2) = Bullish (Bottoming/Over-hedged)
  // Low PCR (<0.8) = Bearish (Overbought/Frothy)
  const sentiment = pcr > 1.2 ? "bullish" : pcr < 0.8 ? "bearish" : "neutral"
  const atmSentiment = pcrAtm > 1.2 ? "bullish" : pcrAtm < 0.8 ? "bearish" : "neutral"

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
    rows: rows.sort((a, b) => a.strike - b.strike || a.type.localeCompare(b.type)),
    windowStats: {
      topShortCovering: [...rows]
        .filter((r) => r.buildup === "Short Covering")
        .sort((a, b) => (a.intervalOi || 0) - (b.intervalOi || 0))
        .slice(0, 3),
      topLongBuildup: [...rows]
        .filter((r) => r.buildup === "Long Buildup")
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
  const formatNumber = (value: number) => value.toLocaleString("en-IN")
  const formatPrice = (value: number) => value.toFixed(2)
  const formatLevel = (value: number) => (value > 0 ? formatNumber(value) : "N/A")

  const rowsByStrike = new Map<number, KiteOptionsLogRow>()

  for (const row of analysis.rows) {
    const strikeRow = rowsByStrike.get(row.strike) ?? {
      strike: row.strike,
      ceSymbol: "N/A",
      ceOi: 0,
      ceLtp: 0,
      ceVolume: 0,
      peSymbol: "N/A",
      peOi: 0,
      peLtp: 0,
      peVolume: 0,
    }

    if (row.type === "CE") {
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
      `  Top Short Covering: ${analysis.windowStats.topShortCovering.map((r) => `${r.strike} ${r.type} (${r.intervalOi})`).join(", ")}`
    )
    log.push(
      `  Top Long Buildup: ${analysis.windowStats.topLongBuildup.map((r) => `${r.strike} ${r.type} (+${r.intervalOi})`).join(", ")}`
    )
  }

  log.push("Strike OI Snapshot:")
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
      ].join(" | ")
    )
  )

  return log
}
