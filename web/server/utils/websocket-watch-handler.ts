import { getInstrumentToken, getOptionToken } from "@core/data/kite.js"
import { LiveAnalyzer } from "@core/analysis/live.js"
import { runAnalysis } from "@core/analysis/trade.js"
import { eventRepo } from "@core/db/repositories/event-repo.js"
import { seedCandleBuilder } from "@core/data/candle-builder.js"
import { isMarketOpen } from "@core/utils/market-hours.js"
import { AIMacroTrend } from "@core/ai/types.js"

export async function handleWatchCommand(peer: any, msg: any) {
  const client = wsConnectionManager.getClient(peer.id)
  if (!client || !client.userId) {
    peer.send(JSON.stringify({ type: "error", message: "Not authenticated" }))
    return
  }

  const { symbol, levels, mode, chartTimeframe } = msg.data
  const token = await getInstrumentToken(client.session.kc, symbol)

  if (!token) {
    peer.send(JSON.stringify({ type: "error", message: `Token not found for ${symbol}` }))
    return
  }

  await seedCandleBuilder(client.session.kc, token)

  const analyzer = new LiveAnalyzer()

  if (!isMarketOpen()) {
    peer.send(
      JSON.stringify({ type: "market_closed", message: "Market is closed. Operating in read-only mode." })
    )
  } else if (levels) {
    analyzer.setLevels(levels)

    analyzer.on("breakout", async (context) => {
      // Concurrency Lock: Prevent multiple overlapping AI analyses for the same client
      if (client.isAnalyzing) {
        console.log(`[ws] AI is already analyzing for ${symbol}. Dropping concurrent breakout event.`);
        return;
      }
      client.isAnalyzing = true;

      try {
        console.log(`[ws] Breakout detected for ${symbol}`)
        peer.send(JSON.stringify({ type: "breakout", data: context }))

        await eventRepo.saveEvent({
          symbol,
          reason: context.reason,
          price: context.tick.last_price,
          timestamp: new Date().toISOString(),
          metadata: { tick: context.tick },
        })

        const analysisResult = await runAnalysis(
          client.session.kc,
          symbol,
          client.mode,
          context,
          client.lastDecision
        )
        const { tf15m: tf, aiDecision: decision, vix, agentType } = analysisResult
        client.lastDecision = decision

        peer.send(JSON.stringify({ type: "analysis", data: analysisResult }))

        if (decision && decision.optionAction !== "NONE") {
          const type = decision.optionAction === "BUY_CE" ? "CE" : "PE"
          const option = await getOptionToken(client.session.kc, symbol, decision.strike || 0, type)

          if (option) {
            console.log(`[ws] Executing Paper Trade for ${option.symbol} (${agentType} Agent)...`)
            client.session.ticker.subscribe([option.token])
            client.session.ticker.setMode(client.session.ticker.modeFull, [option.token])

            const quote = await client.session.kc.getQuote([`NFO:${option.symbol}`])
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

              await client.session.paperTrader.placeOrder({
                symbol: option.symbol,
                token: option.token,
                strike: decision.strike || undefined,
                side: "BUY",
                quantity: 1,
                price: entryPrice,
                context: {
                  optionExpiry: option.expiry.toISOString(),
                  aiReasoning: decision.reason,
                  aiConfidence: decision.confidence,
                  aiStrike: decision.strike || undefined,
                  aiSetup: decision.setup,
                  strategyContext: {
                    macroTrend: decision.macroTrend as AIMacroTrend,
                    indexSl: decision.stopLoss,
                    agentType,
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
      } catch (err) {
        console.error(`[ws] Error during breakout analysis:`, err)
      } finally {
        client.isAnalyzing = false;
      }
    })
  }

  client.analyzer = analyzer
  client.symbol = symbol
  client.token = token
  client.mode = mode || "intraday"
  client.chartTimeframe = chartTimeframe || 1

  const positionTokens = client.session.paperTrader
    .getAllPositions()
    .map((p) => p.token)
    .filter((t) => !!t)
  const tokensToSubscribe = Array.from(new Set([token, ...positionTokens]))

  client.session.ticker.subscribe(tokensToSubscribe)
  client.session.ticker.setMode(client.session.ticker.modeFull, tokensToSubscribe)

  peer.send(JSON.stringify({ type: "watching", symbol, token }))
  peer.send(JSON.stringify({ type: "portfolio", data: client.session.paperTrader.getAllPositions() }))
}
