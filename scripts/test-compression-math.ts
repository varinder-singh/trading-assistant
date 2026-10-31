// scripts/test-compression-math.ts
import { OptionsPayloadCompressor, type CompactOptionRow, type CompressedOptionsPayload } from './compressor.js'

// Let's create a realistic mock of raw KiteOptionsAnalysis with 21 strikes (42 rows)
function createRawAnalysis(symbol: string = 'RELIANCE', spot: number = 2500): any {
  const baseStrike = 2500
  const step = 20
  const strikes: number[] = []
  for (let i = -10; i <= 10; i++) {
    strikes.push(baseStrike + i * step)
  }

  const rows: any[] = []
  for (const strike of strikes) {
    // CE row
    rows.push({
      strike,
      type: 'CE',
      symbol: `${symbol}24OCT${strike}CE`,
      oi: Math.floor(100000 + Math.random() * 500000),
      ltp: Math.max(1, Number((50 - (strike - spot) * 0.4).toFixed(2))),
      volume: Math.floor(10000 + Math.random() * 80000),
      intervalOi: Math.floor(-5000 + Math.random() * 10000),
      buildup: 'Long Buildup',
      greeks: {
        iv: 0.22,
        delta: Number((0.5 - (strike - spot) / 200).toFixed(4)),
        theta: -8.45,
        vega: 14.2,
        gamma: 0.0035,
      },
      yesterdayOi: 250000,
    })

    // PE row
    rows.push({
      strike,
      type: 'PE',
      symbol: `${symbol}24OCT${strike}PE`,
      oi: Math.floor(100000 + Math.random() * 500000),
      ltp: Math.max(1, Number((50 + (strike - spot) * 0.4).toFixed(2))),
      volume: Math.floor(10000 + Math.random() * 80000),
      intervalOi: Math.floor(-5000 + Math.random() * 10000),
      buildup: 'Short Buildup',
      greeks: {
        iv: 0.23,
        delta: Number((-0.5 - (strike - spot) / 200).toFixed(4)),
        theta: -8.12,
        vega: 13.8,
        gamma: 0.0034,
      },
      yesterdayOi: 240000,
    })
  }

  return {
    pcr: 1.15,
    pcrAtm: 0.95,
    maxPain: 2500,
    ivRank: 35.5,
    ivPercentile: 42.1,
    sentiment: 'bullish',
    atmStrike: 2500,
    totalCallOI: 4500000,
    totalPutOI: 5175000,
    resistance: 2600,
    support: 2400,
    windowStats: {
      intervalMins: 5,
      topShortCovering: [{ symbol: 'RELIANCE24OCT2480PE' }],
      topLongBuildup: [{ symbol: 'RELIANCE24OCT2520CE' }],
    },
    marketFlow: 'Bullish Institutional Flow',
    rows,
    recommendedCE: { strike: 2520, gammaToPriceRatio: 0.00014 },
    recommendedPE: { strike: 2480, gammaToPriceRatio: 0.00012 },
  }
}

// Estimate tokens (roughly 1 token per 3.8 - 4.0 chars for structured JSON)
function estimateTokens(str: string): number {
  return Math.ceil(str.length / 3.8)
}

const raw = createRawAnalysis('RELIANCE', 2500)
const compressed = OptionsPayloadCompressor.compress(raw, 'RELIANCE', 2500)

const rawJson = JSON.stringify(raw)
const compJson = JSON.stringify(compressed)

const rawBytes = Buffer.byteLength(rawJson, 'utf8')
const compBytes = Buffer.byteLength(compJson, 'utf8')

const rawTokens = estimateTokens(rawJson)
const compTokens = estimateTokens(compJson)

const byteSavingsPct = ((rawBytes - compBytes) / rawBytes) * 100
const tokenSavingsPct = ((rawTokens - compTokens) / rawTokens) * 100

console.log('='.repeat(80))
console.log('PAYLOAD COMPRESSION BENCHMARK')
console.log('='.repeat(80))
console.log(`Raw Payload:        ${rawBytes} Bytes | ~${rawTokens} Tokens | ${raw.rows.length} rows (21 strikes)`)
console.log(
  `Compressed Payload: ${compBytes} Bytes | ~${compTokens} Tokens | ${compressed.strikes.length} strikes (unified CE/PE)`
)
console.log(`Byte Reduction:     ${byteSavingsPct.toFixed(2)}%`)
console.log(`Token Reduction:    ${tokenSavingsPct.toFixed(2)}%`)
console.log('='.repeat(80))
console.log('\nCompressed JSON Sample:')
console.log(compJson)
