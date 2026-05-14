import axios from "axios"

export interface VixData {
  current: number
  change: number
  sentiment: "low" | "normal" | "high" | "extreme"
}

export async function getIndiaVix(): Promise<VixData> {
  const symbol = "^INDIAVIX"
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`

  try {
    const res = await axios.get(url)
    const result = res.data.chart.result[0]
    const meta = result.meta
    
    const current = meta.regularMarketPrice
    const previousClose = meta.previousClose
    const change = ((current - previousClose) / previousClose) * 100

    let sentiment: VixData["sentiment"] = "normal"
    if (current < 12) sentiment = "low"
    else if (current > 20 && current <= 25) sentiment = "high"
    else if (current > 25) sentiment = "extreme"

    return {
      current: Number(current.toFixed(2)),
      change: Number(change.toFixed(2)),
      sentiment
    }
  } catch (error) {
    console.error("⚠️ Failed to fetch India VIX:", error)
    return { current: 15, change: 0, sentiment: "normal" } // Default fallback
  }
}
