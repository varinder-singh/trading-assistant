import { createTicker } from '../data/kite-ticker.js'

async function inspect() {
  const ticker = createTicker('dummy', 'dummy')
  console.log('--- ON FUNCTION SOURCE ---')
  console.log((ticker as any).on.toString())

  console.log('--- TICKER PROPERTIES ---')
  console.log(Object.keys(ticker))
  console.log(ticker)

  process.exit(0)
}

inspect().catch(console.error)
