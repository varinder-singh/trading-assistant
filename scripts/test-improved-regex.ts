// scripts/test-improved-regex.ts
const PROPOSED_DOC_REGEX = /^([A-Z0-9&-]+?)(\d{2})([A-Z]{3}|\d[A-Z]{2}|\d{2}[A-Z]{1})(\d+(?:\.\d+)?)(CE|PE)$/
const ROBUST_REGEX = /^([A-Z0-9&-]+?)(\d{2})([A-Z]{3}|[A-Z]{2}|[A-Z0-9]\d{2})(\d+(?:\.\d+)?)(CE|PE)$/

const testSymbols = [
  'RELIANCE24OCT2500CE',
  'TATAMOTORS24NOV980PE',
  'ITC24DEC450CE',
  'M&M24OCT3100CE',
  'M&M24OCT3000CE',
  'NIFTY24OCT25000CE',
  'INFY24NO1500PE',
  'INFY24NOV1500PE',
  'NIFTY24O1025000CE',
  'BANKNIFTY24N0652000PE',
  'FINNIFTY24D0323000CE',
  'NIFTY2492625000CE',
  'TATASTEEL24OCT152.5CE',
  'L&TFH24OCT160CE',
]

console.log('--- COMPARING PROPOSED REGEX vs ROBUST REGEX ---')
for (const sym of testSymbols) {
  const m1 = sym.match(PROPOSED_DOC_REGEX)
  const m2 = sym.match(ROBUST_REGEX)
  console.log(`\nSymbol: ${sym}`)
  console.log(`  Proposed Regex: ${m1 ? `✅ MATCH (underlying=${m1[1]}, exp=${m1[3]}, strike=${m1[4]})` : '❌ FAILED'}`)
  console.log(`  Robust Regex:   ${m2 ? `✅ MATCH (underlying=${m2[1]}, exp=${m2[3]}, strike=${m2[4]})` : '❌ FAILED'}`)
}
