import { runAnalysis } from '@core/analysis/trade.js'
import { getOptionToken } from '@core/data/kite.js'
import { classifyInstrument } from '@core/data/instrument-classifier.js'
import { equityAnalysisService } from '@core/analysis/equity-analysis.js'
import { serverSupabaseUser } from '#supabase/server'
import { userRepo, analysisSnapshotRepo } from '@core/db/repositories/container.js'
import { sessionManager } from '@core/execution/session-manager.js'
import { isMarketOpen } from '@core/utils/market-hours.js'
import { decryptSecret } from '@core/utils/crypto.js'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const userId = user.id || user.sub
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized (No User ID)' })
  }

  const brokerAccount = await userRepo.getUserBrokerAccountByUserId(userId)

  if (!brokerAccount?.apiKey || !brokerAccount?.accessToken) {
    throw createError({ statusCode: 400, statusMessage: 'Zerodha account is not linked with user account.' })
  }

  const profile = await userRepo.getUserProfileByUserId(userId)

  const tradeMode = profile?.tradeMode || 'PAPER'

  // Retrieve or create the user's session (which holds kc, ticker, and paperTrader)
  const userSession = await sessionManager.getSession(
    userId,
    decryptSecret(brokerAccount.accessToken),
    brokerAccount.apiKey,
    tradeMode
  )
  const kc = userSession.kc
  const paperTrader = userSession.paperTrader

  const body = await readBody(event)
  const { symbol, mode } = body

  if (!symbol) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Symbol is required',
    })
  }

  if (!isMarketOpen()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Market is closed. Analysis is unavailable.',
    })
  }

  try {
    const classification = await classifyInstrument(kc, symbol)

    if (classification.assetClass === 'EQUITY') {
      const equityResult = await equityAnalysisService.analyzeCandidate(kc, symbol, {
        stockOptionPreference: profile?.stockOptionPreference || 'PREFER_OPTIONS_IF_LISTED',
        equityHoldingMode: (profile?.equityHoldingMode as 'MIS' | 'CNC') || 'MIS',
        equityRiskPerTrade: Number(profile?.equityRiskPerTrade) || 1500,
      })

      const { decision } = equityResult
      if (decision && decision.decision === 'BUY' && decision.action === 'BUY_EQUITY') {
        console.log(`[API ${user.id}] Executing Equity Trade for ${decision.symbol} (${decision.holdingMode})...`)
        await paperTrader.placeOrder({
          symbol: decision.symbol,
          token: classification.token || 0,
          side: 'BUY',
          quantity: 1,
          price: decision.entryPrice,
          context: {
            assetClass: 'EQUITY',
            product: decision.holdingMode,
            aiReasoning: decision.reason,
            aiConfidence: decision.confidence,
            aiStopLoss: decision.stopLoss,
            aiTarget: decision.targets[0],
            aiIndexTargets: decision.targets,
          },
        })
      }

      const tradingDate = new Date().toISOString().split('T')[0]!
      await analysisSnapshotRepo.saveSnapshot({
        userId,
        symbol: decision.symbol,
        timeframe: '15m',
        support: null,
        resistance: null,
        vwap: null,
        atr: null,
        levels: {
          entry: decision.entryPrice,
          stopLoss: decision.stopLoss,
          targets: decision.targets,
        },
        decision,
        agentDeliberations: {
          assetClass: equityResult.assetClass,
          confidence: decision.confidence,
          reason: decision.reason,
        },
        tradingDate,
      })

      return equityResult
    }

    // Default: Existing NIFTY/BANKNIFTY Index Options Pipeline
    const result = await runAnalysis(kc, symbol, mode || 'intraday', undefined, undefined, undefined, userId)
    const { tf15m: tf, aiDecision: decision, vix, agentType } = result

    if (decision && decision.optionAction !== 'NONE' && decision.decision !== 'HOLD') {
      const type = decision.optionAction === 'BUY_CE' ? 'CE' : 'PE'
      const option = await getOptionToken(kc, symbol, decision.strike || 0, type)
      if (option) {
        console.log(`[API ${user.id}] Executing Paper Trade for ${option.symbol} (${agentType} Agent)...`)
        const quote = await kc.getQuote([`NFO:${option.symbol}`])
        const entryPrice = quote[`NFO:${option.symbol}`]?.last_price || 0
        if (entryPrice > 0) {
          const optionRow = result.optionsAnalysis?.rows?.find(
            (r: any) => r.strike === decision.strike && r.type === type
          )
          const actualDelta = optionRow?.greeks?.delta ? Math.abs(optionRow.greeks.delta) : 0.5
          const indexRiskPoints = Math.abs(tf.price - decision.stopLoss)
          const optionRiskPoints = indexRiskPoints * actualDelta
          let calculatedSl = entryPrice - optionRiskPoints
          const calculatedTarget = entryPrice + optionRiskPoints * (decision.riskRewardRatio || 1.5)
          const floorPercentage = agentType === 'TREND' ? 0 : 0.2
          const minAllowedSl = Math.max(entryPrice * floorPercentage, 0.05)
          if (calculatedSl < minAllowedSl) calculatedSl = minAllowedSl

          await paperTrader.placeOrder({
            symbol: option.symbol,
            token: option.token,
            strike: decision.strike || undefined,
            side: 'BUY',
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
              lotSize: result.lotSize,
              currentIndexPrice: tf.price,
              optionDelta: actualDelta,
            },
          })
        }
      }
    }

    const tradingDate = new Date().toISOString().split('T')[0]!
    await analysisSnapshotRepo.saveSnapshot({
      userId,
      symbol,
      timeframe: '15m',
      support: tf.support,
      resistance: tf.resistance,
      vwap: tf.vwap,
      atr: tf.atr14,
      levels: {
        support: tf.support,
        resistance: tf.resistance,
        vwap: tf.vwap,
        orb: tf.openingRange,
        daily: result.dailyContext,
      },
      decision,
      agentDeliberations: {
        agentType,
        vix,
        sentiment: result.sentiment,
        macroTrend: result.macroTrend,
      },
      tradingDate,
    })

    return result
  } catch (error: any) {
    console.error('Analysis API Error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Analysis failed',
    })
  }
})
