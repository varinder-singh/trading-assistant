import { getOptionChain } from '../data/kite-options.js'
import { analyzeOptions } from '../analysis/kite-options.js'
import { getYesterdayClosingOI } from '../data/kite-historical.js'
import { createKiteClient } from '../data/kite.js'
import { paperTrader } from '../execution/paper-trader.js'
import { generateOIHeatmap } from '../analysis/heatmap.js'

async function showDashboard() {
  const kc = createKiteClient(process.env.KITE_ACCESS_TOKEN)
  const symbol = 'NIFTY'
  const underlyingTicker = 'NSE:NIFTY 50'

  console.log("Fetching Friday's Closing Data for Dashboard Preview...\n")
  const [{ quotes, finalOptions }, underlyingQuote] = await Promise.all([
    getOptionChain(kc, symbol),
    kc.getQuote([underlyingTicker]),
  ])

  const underlyingPrice = underlyingQuote[underlyingTicker]?.last_price || 0
  const analysis = analyzeOptions(quotes, finalOptions, underlyingPrice, undefined)

  // 1. Mock an active position in PaperTrader to see the Greeks Dashboard
  const atmRow = analysis.rows.find((r) => r.strike === analysis.atmStrike && r.type === 'CE')
  if (atmRow) {
    const mockContext = {
      optionDelta: atmRow.greeks?.delta || 0.5,
      optionTheta: atmRow.greeks?.theta || -50,
      optionVega: atmRow.greeks?.vega || 10,
    }

    // Inject the mock position directly
    // @ts-ignore - overriding private map for mock
    paperTrader.positions.set('NIFTY_MOCK_CE', {
      symbol: 'NIFTY_MOCK_CE',
      token: 12345,
      strike: analysis.atmStrike,
      side: 'BUY',
      quantity: 150, // Delta adjusted quantity (e.g. 2 lots of 75)
      avgEntryPrice: atmRow.ltp - 10, // In profit
      currentPrice: atmRow.ltp,
      unrealizedPnL: 150 * 10,
      realizedPnL: 0,
      timestamp: new Date(),
      optionDelta: mockContext.optionDelta,
      optionTheta: mockContext.optionTheta,
      optionVega: mockContext.optionVega,
    })

    console.log('=================================================================================================')
    console.log('📈 LIVE GREEKS DASHBOARD (MOCK POSITION)')
    const positions = Array.from((paperTrader as any).positions.values()) as any[]
    console.table(
      positions.map((p) => ({
        Symbol: p.symbol,
        Qty: p.quantity,
        LTP: p.currentPrice.toFixed(2),
        PnL: p.unrealizedPnL >= 0 ? `+${p.unrealizedPnL.toFixed(2)}` : p.unrealizedPnL.toFixed(2),
        Delta: p.optionDelta ? (p.optionDelta * p.quantity).toFixed(2) : 'N/A',
        Theta: p.optionTheta ? (p.optionTheta * p.quantity).toFixed(2) : 'N/A',
        Vega: p.optionVega ? (p.optionVega * p.quantity).toFixed(2) : 'N/A',
        'Burn/Day': p.optionTheta ? `₹${Math.abs(p.optionTheta * p.quantity).toFixed(2)}` : 'N/A',
      }))
    )
    console.log('=================================================================================================\n')
  }

  // 2. Show the Heatmap
  console.log(generateOIHeatmap(analysis))
}

showDashboard().catch(console.error)
