import { runAnalysis } from "@core/analysis/trade.js"
import { paperTrader } from "@core/execution/paper-trader.js"
import { getOptionToken } from "@core/data/kite.js"
import kc from "@core/data/kite.js"

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { symbol, mode } = body

  if (!symbol) {
    throw createError({
      statusCode: 400,
      statusMessage: "Symbol is required",
    })
  }

  try {
    const result = await runAnalysis(symbol, mode || "intraday")
    const { tf15m: tf, aiDecision: decision, vix, agentType } = result

    if (decision && decision.optionAction !== "NONE" && decision.decision !== "HOLD") {
      const type = decision.optionAction === "BUY_CE" ? "CE" : "PE"
      const option = await getOptionToken(symbol, decision.strike || 0, type)
      if (option) {
        console.log(`[API] Executing Paper Trade for ${option.symbol} (${agentType} Agent)...`)
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
              strategyContext: { macroTrend: decision.macroTrend as any, indexSl: decision.stopLoss, agentType: agentType as any },
              vixLevel: vix.current, rsiLevel: tf.rsi, trend15m: tf.trend, aiStopLoss: calculatedSl, aiTarget: calculatedTarget
            }
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
