// scripts/test-regex.ts
const CONTRACT_REGEX = /^([A-Z0-9&-]+?)(\d{2})([A-Z]{3}|\d[A-Z]{2}|\d{2}[A-Z]{1})(\d+(?:\.\d+)?)(CE|PE)$/

const testSymbols = [
  'RELIANCE24OCT2500CE',
  'TATAMOTORS24NOV980PE',
  'ITC24DEC450CE',
  'M&M24OCT3100CE',
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

console.log('Testing CONTRACT_REGEX:')
for (const sym of testSymbols) {
  const match = sym.match(CONTRACT_REGEX)
  if (match) {
    console.log(
      `✅ MATCH: ${sym} -> Underlying: ${match[1]}, Year: ${match[2]}, Expiry: ${match[3]}, Strike: ${match[4]}, Type: ${match[5]}`
    )
  } else {
    console.log(`❌ FAIL:  ${sym} did not match!`)
  }
}
