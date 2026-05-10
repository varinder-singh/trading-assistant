export type KiteOptionQuote = {
  last_price?: number
  oi?: number
  volume?: number
}

export type KiteOptionInstrumentForAnalysis = {
  instrument_type: "CE" | "PE"
  strike: number
  tradingsymbol: string
}

export type KiteOptionOiRow = {
  strike: number
  type: "CE" | "PE"
  symbol: string
  oi: number
  ltp: number
  volume: number
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
  const formatLevel = (value: number) => value > 0 ? formatNumber(value) : "N/A"

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
  const topCallRows = analysis.rows
    .filter((row) => row.type === "CE")
    .sort((first, second) => second.oi - first.oi)
    .slice(0, 3)
  const topPutRows = analysis.rows
    .filter((row) => row.type === "PE")
    .sort((first, second) => second.oi - first.oi)
    .slice(0, 3)

  const formatTopRows = (rows: KiteOptionOiRow[]) => rows.length > 0
    ? rows
      .map((row) => [
        `${formatNumber(row.strike)} ${row.type}`,
        row.symbol,
        `OI ${formatNumber(row.oi)}`,
        `LTP ${formatPrice(row.ltp)}`,
        `Vol ${formatNumber(row.volume)}`,
      ].join(" | "))
      .join("; ")
    : "N/A"

  return [
    `PCR (Aggregate): ${analysis.pcr.toFixed(2)} (${analysis.sentiment.toUpperCase()}) | PCR (ATM ${analysis.atmStrike}): ${analysis.pcrAtm.toFixed(2)} (${analysis.atmSentiment.toUpperCase()})`,
    `Total Call OI: ${formatNumber(analysis.callOI)} | Total Put OI: ${formatNumber(analysis.putOI)}`,
    `ATM Call OI: ${formatNumber(analysis.atmCallOI)} | ATM Put OI: ${formatNumber(analysis.atmPutOI)}`,
    `Max Call OI: ${formatNumber(analysis.maxCallOI)} | Max Put OI: ${formatNumber(analysis.maxPutOI)}`,
    `OI Support: ${formatLevel(analysis.support)} (${formatNumber(analysis.maxPutOI)} PE OI)`,
    `OI Resistance: ${formatLevel(analysis.resistance)} (${formatNumber(analysis.maxCallOI)} CE OI)`,
    `Contracts Analyzed: ${formatNumber(analysis.rows.length)}`,
    `Top Call OI: ${formatTopRows(topCallRows)}`,
    `Top Put OI: ${formatTopRows(topPutRows)}`,
    "Strike OI Snapshot:",
    ...strikeRows.map((row) => [
      `  ${formatNumber(row.strike)}`,
      `CE ${row.ceSymbol}`,
      `CE OI ${formatNumber(row.ceOi)}`,
      `CE LTP ${formatPrice(row.ceLtp)}`,
      `CE Vol ${formatNumber(row.ceVolume)}`,
      `PE ${row.peSymbol}`,
      `PE OI ${formatNumber(row.peOi)}`,
      `PE LTP ${formatPrice(row.peLtp)}`,
      `PE Vol ${formatNumber(row.peVolume)}`,
    ].join(" | ")),
  ]
}

export function analyzeOptions(
  quotes: Record<string, KiteOptionQuote>,
  instruments: KiteOptionInstrumentForAnalysis[],
  currentPrice?: number
): KiteOptionsAnalysis {
  let callOI = 0
  let putOI = 0

  let maxCallOI = 0
  let maxPutOI = 0

  let resistance = 0
  let support = 0
  const rows: KiteOptionOiRow[] = []

  // Find ATM strike (closest to current price)
  let atmStrike = 0
  let atmCallOI = 0
  let atmPutOI = 0

  if (currentPrice) {
    const uniqueStrikes = [...new Set(instruments.map(i => i.strike))]
    atmStrike = uniqueStrikes.reduce((closest, strike) =>
      Math.abs(strike - currentPrice) < Math.abs(closest - currentPrice) ? strike : closest
    )
  }

  for (const inst of instruments) {
    const key = `NFO:${inst.tradingsymbol}`
    const q = quotes[key]

    if (!q) continue

    const openInterest = q.oi ?? 0

    rows.push({
      strike: inst.strike,
      type: inst.instrument_type,
      symbol: inst.tradingsymbol,
      oi: openInterest,
      ltp: q.last_price ?? 0,
      volume: q.volume ?? 0,
    })

    if (inst.instrument_type === "CE") {
      callOI += openInterest

      if (inst.strike === atmStrike) {
        atmCallOI = openInterest
      }

      if (openInterest > maxCallOI) {
        maxCallOI = openInterest
        resistance = inst.strike
      }
    }

    if (inst.instrument_type === "PE") {
      putOI += openInterest

      if (inst.strike === atmStrike) {
        atmPutOI = openInterest
      }

      if (openInterest > maxPutOI) {
        maxPutOI = openInterest
        support = inst.strike
      }
    }
  }

  const pcr = callOI > 0 ? putOI / callOI : 0
  const pcrAtm = atmCallOI > 0 ? atmPutOI / atmCallOI : 0

  const sentiment =
    pcr > 1.2 ? "bearish" :
      pcr < 0.8 ? "bullish" :
        "neutral"

  const atmSentiment =
    pcrAtm > 1.2 ? "bearish" :
      pcrAtm < 0.8 ? "bullish" :
        "neutral"

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
    rows: rows.sort((first, second) => first.strike - second.strike || first.type.localeCompare(second.type)),
  }
}

