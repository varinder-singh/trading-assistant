import type { KiteOptionsAnalysis } from "./kite-options.js"

export function generateOIHeatmap(analysis: KiteOptionsAnalysis): string {
  if (!analysis || !analysis.rows) return "No options data available."

  const atmStrike = analysis.atmStrike
  // Sort rows by strike, get 5 below and 5 above ATM
  const sortedRows = [...analysis.rows].sort((a, b) => a.strike - b.strike)
  
  // Find ATM index
  const atmIndex = sortedRows.findIndex(r => r.strike === atmStrike && r.type === "CE")
  let startIndex = 0
  let endIndex = sortedRows.length

  if (atmIndex !== -1) {
    const ceRows = sortedRows.filter(r => r.type === "CE")
    const ceAtmIdx = ceRows.findIndex(r => r.strike === atmStrike)
    const startCEIdx = Math.max(0, ceAtmIdx - 5)
    const endCEIdx = Math.min(ceRows.length - 1, ceAtmIdx + 5)
    
    const relevantStrikes = ceRows.slice(startCEIdx, endCEIdx + 1).map(r => r.strike)
    
    // Filter the main rows by relevant strikes
    const heatmapRows = sortedRows.filter(r => relevantStrikes.includes(r.strike))
    
    return formatHeatmapTable(heatmapRows, atmStrike)
  }

  return "Could not generate heatmap."
}

function formatHeatmapTable(rows: any[], atmStrike: number): string {
  // We need to pair CE and PE for the same strike side-by-side
  const strikes = [...new Set(rows.map(r => r.strike))].sort((a, b) => a.strike - b.strike)
  
  let output = "\n" + "=".repeat(110) + "\n"
  output += "🔥 LIVE OPTIONS OI HEATMAP\n"
  output += "=".repeat(110) + "\n"
  output += "CALLS (CE)                                         | STRIKE  | PUTS (PE)\n"
  output += "Buildup         | COI         | LTP      | Delta   |         | Delta   | LTP      | COI         | Buildup\n"
  output += "-".repeat(110) + "\n"

  for (const strike of strikes) {
    const ce = rows.find(r => r.strike === strike && r.type === "CE")
    const pe = rows.find(r => r.strike === strike && r.type === "PE")

    const strikeStr = strike === atmStrike ? `[${strike}]`.padEnd(7) : strike.toString().padEnd(7)

    const formatRowSide = (r: any, isCE: boolean) => {
      if (!r) return isCE ? "".padEnd(46) : "".padEnd(46)
      const buildup = (r.buildup || "-").padEnd(15)
      const coiStr = (r.intervalOi > 0 ? `+${r.intervalOi}` : `${r.intervalOi || 0}`).padEnd(11)
      const ltp = r.ltp.toFixed(2).padEnd(8)
      const delta = r.greeks?.delta ? Math.abs(r.greeks.delta).toFixed(2).padEnd(7) : "-      "

      if (isCE) {
        return `${buildup} | ${coiStr} | ${ltp} | ${delta}`
      } else {
        return `${delta} | ${ltp} | ${coiStr} | ${buildup}`
      }
    }

    const ceStr = formatRowSide(ce, true)
    const peStr = formatRowSide(pe, false)

    output += `${ceStr} | ${strikeStr} | ${peStr}\n`
  }
  
  output += "=".repeat(110) + "\n"
  return output
}
