import { runAnalysis } from "@core/analysis/trade.js"
import { getOptionToken } from "@core/data/kite.js"
import { serverSupabaseUser } from "#supabase/server"
import { db } from "@core/db/database.js"
import { sessionManager } from "@core/execution/session-manager.js"
import { isMarketOpen } from "@core/utils/market-hours.js"
import { decryptSecret } from "@core/utils/crypto.js"

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  }

  const userId = user.id || user.sub
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized (No User ID)" })
  }

  const brokerAccount = await db
    .selectFrom("brokerAccounts")
    .select(["accessToken", "apiKey"])
    .where("userId", "=", userId)
    .where("isActive", "=", true)
    .executeTakeFirst()

  if (!brokerAccount?.accessToken) {
    throw createError({ statusCode: 400, statusMessage: "Zerodha account not linked." })
  }

  // Retrieve or create the user's session (which holds kc, ticker, and paperTrader)
  const userSession = await sessionManager.getSession(userId, decryptSecret(brokerAccount.accessToken), brokerAccount.apiKey || undefined)
  const kc = userSession.kc
  const paperTrader = userSession.paperTrader

  const body = await readBody(event)
  const { symbol, mode } = body

  if (!symbol) {
    throw createError({
      statusCode: 400,
      statusMessage: "Symbol is required",
    })
  }

  if (!isMarketOpen()) {
    throw createError({
      statusCode: 400,
      statusMessage: "Market is closed. Analysis is unavailable.",
    })
  }

  try {
    const result = await runAnalysis(kc, symbol, mode || "intraday", undefined, undefined, undefined, userId)
    const { tf15m: tf, aiDecision: decision, vix, agentType } = result

    if (decision && decision.optionAction !== "NONE" && decision.decision !== "HOLD") {
      const type = decision.optionAction === "BUY_CE" ? "CE" : "PE"
      const option = await getOptionToken(kc, symbol, decision.strike || 0, type)
      if (option) {
        console.log(`[API ${user.id}] Executing Paper Trade for ${option.symbol} (${agentType} Agent)...`)
        const quote = await kc.getQuote([`NFO:${option.symbol}`])
        const entryPrice = quote[`NFO:${option.symbol}`]?.last_price || 0
        if (entryPrice > 0) {
          const indexRiskPoints = Math.abs(tf.price - decision.stopLoss)
          const estimatedDelta = 0.5
          const optionRiskPoints = indexRiskPoints * estimatedDelta
          let calculatedSl = entryPrice - optionRiskPoints
          const calculatedTarget = entryPrice + optionRiskPoints * (decision.riskRewardRatio || 1.5)
          const floorPercentage = agentType === "TREND" ? 0 : 0.2
          const minAllowedSl = Math.max(entryPrice * floorPercentage, 0.05)
          if (calculatedSl < minAllowedSl) calculatedSl = minAllowedSl

          await paperTrader.placeOrder({
            symbol: option.symbol,
            token: option.token,
            strike: decision.strike || undefined,
            side: "BUY",
            quantity: 1,
            price: entryPrice,
            context: {
              aiReasoning: decision.reason,
              aiConfidence: decision.confidence,
              aiStrike: decision.strike || undefined,
              aiSetup: decision.setup,
              strategyContext: {
                macroTrend: decision.macroTrend as any,
                indexSl: decision.stopLoss,
                agentType: agentType as any,
              },
              vixLevel: vix.current,
              rsiLevel: tf.rsi,
              trend15m: tf.trend,
              aiStopLoss: calculatedSl,
              aiTarget: calculatedTarget,
            },
          })
        }
      }
    }

    return result
  } catch (error: any) {
    console.error("Analysis API Error:", error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || "Analysis failed",
    })
  }
})
