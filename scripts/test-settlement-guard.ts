// scripts/test-settlement-guard.ts
export class PhysicalSettlementGuard {
  public static readonly MIN_DTE_FOR_ENTRY_DAYS = 4
  public static readonly EXPIRY_SQUARE_OFF_DOW = 2 // Tuesday (0=Sun, 1=Mon, 2=Tue)
  public static readonly EXPIRY_SQUARE_OFF_HOUR = 15 // 15:00 IST

  public static getTradingDaysToExpiry(expiryDate: Date, currentDate: Date = new Date()): number {
    let count = 0
    const cur = new Date(currentDate)
    cur.setHours(0, 0, 0, 0)
    const exp = new Date(expiryDate)
    exp.setHours(0, 0, 0, 0)

    while (cur < exp) {
      cur.setDate(cur.getDate() + 1)
      const day = cur.getDay()
      if (day !== 0 && day !== 6) {
        // Exclude weekends
        count++
      }
    }
    return count
  }

  public static canEnterContract(
    expiryDate: Date,
    currentDate: Date = new Date()
  ): {
    allowed: boolean
    reason?: string
    recommendedAction: 'TRADE_CURRENT' | 'ROLL_TO_NEXT_MONTH'
  } {
    const dte = this.getTradingDaysToExpiry(expiryDate, currentDate)
    if (dte <= this.MIN_DTE_FOR_ENTRY_DAYS) {
      return {
        allowed: false,
        reason: `DTE (${dte} days) <= 4 days cutoff. SEBI physical settlement risk active.`,
        recommendedAction: 'ROLL_TO_NEXT_MONTH',
      }
    }
    return {
      allowed: true,
      recommendedAction: 'TRADE_CURRENT',
    }
  }

  public static isMandatorySquareOffRequired(expiryDate: Date, currentDate: Date = new Date()): boolean {
    const dte = this.getTradingDaysToExpiry(expiryDate, currentDate)

    // If DTE is 2 days or fewer (e.g. Tuesday afternoon or Wednesday)
    if (dte <= 2) {
      return true
    }

    // Specifically trigger on Tuesday of expiry week at or after 15:00 IST
    if (
      dte <= 3 &&
      currentDate.getDay() === this.EXPIRY_SQUARE_OFF_DOW &&
      currentDate.getHours() >= this.EXPIRY_SQUARE_OFF_HOUR
    ) {
      return true
    }

    return false
  }
}

// Test against October 2024 expiry: Thursday, Oct 31, 2024
const expiryDate = new Date('2024-10-31T15:30:00Z')

console.log('='.repeat(80))
console.log('EMPIRICAL TEST: PhysicalSettlementGuard Calendar & Hour-by-Hour Tracing')
console.log('='.repeat(80))

const testPoints = [
  { desc: 'Fri before expiry (Oct 25 10:00)', date: new Date('2024-10-25T10:00:00Z') },
  { desc: 'Mon of expiry week (Oct 28 09:15)', date: new Date('2024-10-28T09:15:00Z') },
  { desc: 'Mon of expiry week (Oct 28 15:00)', date: new Date('2024-10-28T15:00:00Z') },
  { desc: 'Tue morning market open (Oct 29 09:15)', date: new Date('2024-10-29T09:15:00Z') },
  { desc: 'Tue midday (Oct 29 12:00)', date: new Date('2024-10-29T12:00:00Z') },
  { desc: 'Tue before cutoff (Oct 29 14:30)', date: new Date('2024-10-29T14:30:00Z') },
  { desc: 'Tue AT cutoff (Oct 29 15:00)', date: new Date('2024-10-29T15:00:00Z') },
  { desc: 'Wed morning (Oct 30 09:15)', date: new Date('2024-10-30T09:15:00Z') },
  { desc: 'Thu expiry day (Oct 31 09:15)', date: new Date('2024-10-31T09:15:00Z') },
]

for (const tp of testPoints) {
  const dte = PhysicalSettlementGuard.getTradingDaysToExpiry(expiryDate, tp.date)
  const entry = PhysicalSettlementGuard.canEnterContract(expiryDate, tp.date)
  const squareOff = PhysicalSettlementGuard.isMandatorySquareOffRequired(expiryDate, tp.date)

  console.log(`\nTime: ${tp.desc}`)
  console.log(`  Day: ${tp.date.toLocaleDateString('en-US', { weekday: 'short' })} | Hour: ${tp.date.getUTCHours()}:00`)
  console.log(`  Calculated DTE: ${dte} trading days`)
  console.log(`  Can Enter Contract: ${entry.allowed} (${entry.recommendedAction})`)
  console.log(`  Mandatory Square-off Required: ${squareOff}`)
}
