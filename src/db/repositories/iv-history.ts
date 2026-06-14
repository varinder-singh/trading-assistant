import { db } from "../database.js"
import { randomUUID } from "node:crypto"

export class IvHistoryRepo {
  /**
   * Save or update the daily ATM IV for a symbol
   */
  async saveDailyIV(symbol: string, iv: number, dateStr?: string): Promise<void> {
    const date = dateStr || (new Date().toISOString().split("T")[0] as string)

    await db
      .insertInto("ivHistory")
      .values({
        id: randomUUID(),
        symbol,
        date,
        iv,
        createdAt: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.columns(["symbol", "date"]).doUpdateSet({
          iv: (eb) => eb.ref("excluded.iv"),
        })
      )
      .execute()
  }

  /**
   * Get historical IV data to compute IV Rank and IV Percentile
   * @param days Lookback window in days (default 30)
   */
  async getIvStats(symbol: string, currentIv: number, days: number = 30) {
    const records = await db
      .selectFrom("ivHistory")
      .select(["iv"])
      .where("symbol", "=", symbol)
      .orderBy("date", "desc")
      .limit(days)
      .execute()

    const ivs = records.map((r) => r.iv)
    if (ivs.length === 0) {
      return { ivRank: 0, ivPercentile: 0, highest: currentIv, lowest: currentIv }
    }

    const highest = Math.max(...ivs, currentIv)
    const lowest = Math.min(...ivs, currentIv)

    // IV Rank = (Current - Low) / (High - Low)
    const ivRank = highest === lowest ? 0 : ((currentIv - lowest) / (highest - lowest)) * 100

    // IV Percentile = Percentage of days where IV was lower than current IV
    const daysBelow = ivs.filter((iv) => iv < currentIv).length
    const ivPercentile = (daysBelow / ivs.length) * 100

    return {
      ivRank,
      ivPercentile,
      highest,
      lowest,
    }
  }
}

export const ivHistoryRepo = new IvHistoryRepo()
