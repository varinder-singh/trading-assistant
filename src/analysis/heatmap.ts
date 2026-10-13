import type { KiteOptionsAnalysis } from './kite-options.js'

export function generateOIHeatmap(analysis: KiteOptionsAnalysis): string {
  if (!analysis || !analysis.rows) return 'No options data available.'

  const atmStrike = analysis.atmStrike
  const sortedRows = [...analysis.rows].sort((a, b) => a.strike - b.strike)

  const atmIndex = sortedRows.findIndex((r) => r.strike === atmStrike && r.type === 'CE')
  if (atmIndex === -1) {
    return 'Could not generate heatmap.'
  }

  const ceRows = sortedRows.filter((r) => r.type === 'CE')
  const ceAtmIdx = ceRows.findIndex((r) => r.strike === atmStrike)
  const startCEIdx = Math.max(0, ceAtmIdx - 5)
  const endCEIdx = Math.min(ceRows.length - 1, ceAtmIdx + 5)

  const relevantStrikes = ceRows.slice(startCEIdx, endCEIdx + 1).map((r) => r.strike)
  const heatmapRows = sortedRows.filter((r) => relevantStrikes.includes(r.strike))

  return formatHeatmapTable(heatmapRows, atmStrike)
}

function formatHeatmapTable(rows: any[], atmStrike: number): string {
  const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a.strike - b.strike)

  const header = [
    '\n' + '='.repeat(110),
    '🔥 LIVE OPTIONS OI HEATMAP',
    '='.repeat(110),
    'CALLS (CE)                                         | STRIKE  | PUTS (PE)',
    'Buildup         | COI         | LTP      | Delta   |         | Delta   | LTP      | COI         | Buildup',
    '-'.repeat(110),
  ].join('\n')

  const formatRowSide = (r: any, isCE: boolean) => {
    if (!r) return ''.padEnd(46)
    const buildup = (r.buildup || '-').padEnd(15)
    const coiStr = (r.intervalOi > 0 ? `+${r.intervalOi}` : `${r.intervalOi || 0}`).padEnd(11)
    const ltp = r.ltp.toFixed(2).padEnd(8)
    const delta = r.greeks?.delta ? Math.abs(r.greeks.delta).toFixed(2).padEnd(7) : '-      '

    return isCE ? `${buildup} | ${coiStr} | ${ltp} | ${delta}` : `${delta} | ${ltp} | ${coiStr} | ${buildup}`
  }

  const tableBody = strikes
    .map((strike) => {
      const ce = rows.find((r) => r.strike === strike && r.type === 'CE')
      const pe = rows.find((r) => r.strike === strike && r.type === 'PE')
      const strikeStr = strike === atmStrike ? `[${strike}]`.padEnd(7) : strike.toString().padEnd(7)

      return `${formatRowSide(ce, true)} | ${strikeStr} | ${formatRowSide(pe, false)}`
    })
    .join('\n')

  return `${header}\n${tableBody}\n${'='.repeat(110)}\n`
}
