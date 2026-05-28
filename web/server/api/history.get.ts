import { tradeRepo } from "@core/db/repositories/trade-repo.js"
export default defineEventHandler(async () => {
  try {
    const trades = await tradeRepo.getAllTrades()
    return trades
  } catch (error: any) {
    console.error("History API Error:", error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || "Failed to fetch trade history",
    })
  }
})
