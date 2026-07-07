import 'dotenv/config'
import { createKiteClient } from '../data/kite.js'
import { getOptionChain } from '../data/kite-options.js'
import { analyzeOptions } from '../analysis/kite-options.js'
import { ivHistoryRepo } from '../db/repositories/iv-history.js'
import { resolveKiteUnderlying } from '../utils/symbol.js'

async function main() {
  const symbol = process.argv[2] || 'NIFTY'
  console.log(`[IV Snapshot] Starting EOD IV snapshot for ${symbol}...`)

  if (!process.env.KITE_ACCESS_TOKEN) {
    console.error('Missing KITE_ACCESS_TOKEN in environment.')
    process.exit(1)
  }

  const kc = createKiteClient(process.env.KITE_ACCESS_TOKEN)
  const underlyingTicker = resolveKiteUnderlying(symbol)

  try {
    const [{ quotes, finalOptions }, underlyingQuote] = await Promise.all([
      getOptionChain(kc, symbol),
      kc.getQuote([underlyingTicker]),
    ])

    const underlyingPrice = underlyingQuote[underlyingTicker]?.last_price || 0
    if (underlyingPrice === 0) {
      throw new Error(`Failed to fetch underlying price for ${underlyingTicker}`)
    }

    const analysis = analyzeOptions(quotes, finalOptions, underlyingPrice)

    const atmRow = analysis.rows.find((r) => r.strike === analysis.atmStrike && r.type === 'CE')

    const currentIv = atmRow?.greeks?.iv
    if (currentIv === undefined) {
      throw new Error(`Failed to calculate ATM IV for ${symbol} at strike ${analysis.atmStrike}`)
    }

    console.log(`[IV Snapshot] ATM Strike: ${analysis.atmStrike}`)
    console.log(`[IV Snapshot] Calculated IV: ${(currentIv * 100).toFixed(2)}%`)

    await ivHistoryRepo.saveDailyIV(symbol, currentIv)

    console.log(`[IV Snapshot] Successfully saved daily IV for ${symbol}.`)
    process.exit(0)
  } catch (err) {
    console.error('[IV Snapshot] Error capturing IV:', err)
    process.exit(1)
  }
}

main()
