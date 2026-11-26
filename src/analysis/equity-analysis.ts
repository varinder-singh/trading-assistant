import type { Connect as KiteConnectInstance } from 'kiteconnect'
import { getMultiTimeframeCandles } from '../data/yahoo.js'
import { analyzeMultiTimeframe, analyzeDailyContext } from './technical.js'
import { classifyInstrument, isNearMonthlyExpiry } from '../data/instrument-classifier.js'
import { globalKiteScanner } from '../data/kite-scanner.js'
import { EquityAnalystAgent, type EquityAnalysisContext, type EquityAgentDecision } from '../ai/equity-agent.js'
import { LLMService } from '../ai/llm.js'
import { getOptionToken } from '../data/kite.js'
import { getIndiaVix, type VixData } from '../data/vix.js'
import type { Candle } from '../types/analysis.js'

export interface EquityAnalysisPipelineResult {
  decision: EquityAgentDecision
  assetClass: 'EQUITY' | 'STOCK_OPTION'
  context?: EquityAnalysisContext
  vix?: VixData
  optionDetails?: {
    symbol: string
    token: number
    expiry: Date
    lotSize: number
  }
}

export interface UserEquityPreferences {
  stockOptionPreference?: string
  equityHoldingMode?: 'MIS' | 'CNC'
  equityRiskPerTrade?: number
}

export class EquityAnalysisService {
  constructor(
    private readonly agent: EquityAnalystAgent = new EquityAnalystAgent(),
    private readonly llmService: LLMService = new LLMService()
  ) {}

  /**
   * Executes the full multi-timeframe technical, VIX, and 3-Stage MAS deliberation pipeline
   * for a surfaced NSE stock candidate (supporting both Bullish and Bearish setups).
   */
  public async analyzeCandidate(
    kc: KiteConnectInstance,
    symbol: string,
    userPreferences?: UserEquityPreferences
  ): Promise<EquityAnalysisPipelineResult> {
    const s = symbol.toUpperCase().trim()
    const { stockCandles, niftyCandles, vix, classification, scanState } = await this.fetchCandidateData(kc, s)

    if (!stockCandles || stockCandles.candles15m.length === 0) {
      throw new Error(`Insufficient candle data for ${s}`)
    }

    const { context, masInput } = this.assembleContextAndMasInput({
      symbol: s,
      stockCandles,
      niftyCandles,
      classification,
      scanState,
      vix,
      userPreferences,
    })

    const aiRes = await this.llmService.analyzeWithEnsemble(masInput, 'SCALPER', '')
    const decision = this.toEquityAgentDecision(s, aiRes, context, userPreferences)
    const routed = await this.resolveOptionRouting(kc, s, decision, classification.isFnoListed)

    return {
      ...routed,
      context,
      vix,
    }
  }

  private async fetchCandidateData(kc: KiteConnectInstance, symbol: string) {
    const classification = await classifyInstrument(kc, symbol)
    const scanState = globalKiteScanner.getStockState(symbol)

    const [stockCandles, niftyCandles, vix] = await Promise.all([
      getMultiTimeframeCandles(symbol, kc).catch(() => null),
      getMultiTimeframeCandles('NIFTY', kc).catch(() => null),
      getIndiaVix().catch(() => ({ current: 15, change: 0, sentiment: 'normal' as const })),
    ])

    return { stockCandles, niftyCandles, vix, classification, scanState }
  }

  private toEquityAgentDecision(
    symbol: string,
    aiRes: any,
    context: EquityAnalysisContext,
    userPreferences?: UserEquityPreferences
  ): EquityAgentDecision {
    const isExecutionValid = aiRes && aiRes.decision !== 'NO_TRADE' && aiRes.confidence >= 75
    const currentPrice = context.currentPrice
    const holdingMode = userPreferences?.equityHoldingMode ?? 'MIS'

    return isExecutionValid
      ? {
          symbol,
          decision: aiRes.decision as 'BUY' | 'SELL',
          action: (aiRes.optionAction || (aiRes.decision === 'BUY' ? 'BUY_EQUITY' : 'SELL_EQUITY')) as
            | 'BUY_EQUITY'
            | 'SELL_EQUITY'
            | 'BUY_CE'
            | 'BUY_PE'
            | 'NONE',
          strike: aiRes.strike ?? null,
          entryPrice: aiRes.entry || currentPrice,
          stopLoss: aiRes.stopLoss || (aiRes.decision === 'SELL' ? currentPrice * 1.01 : currentPrice * 0.99),
          targets: Array.isArray(aiRes.targets) && aiRes.targets.length > 0 ? aiRes.targets : [currentPrice * 1.015],
          riskRewardRatio: aiRes.riskRewardRatio || 1.5,
          confidence: aiRes.confidence,
          holdingMode,
          reason: aiRes.reason || 'Synthesized by 3-Stage MAS Orchestrator.',
        }
      : {
          symbol,
          decision: 'NO_TRADE',
          action: 'NONE',
          strike: null,
          entryPrice: currentPrice,
          stopLoss: currentPrice,
          targets: [],
          riskRewardRatio: 0,
          confidence: aiRes?.confidence ?? 0,
          holdingMode,
          reason: aiRes?.reason || 'MAS rejected setup due to low confidence or regime gating.',
        }
  }

  private assembleContextAndMasInput(params: {
    symbol: string
    stockCandles: any
    niftyCandles: any
    classification: any
    scanState: any
    vix: any
    userPreferences?: any
  }): { context: EquityAnalysisContext; masInput: any } {
    const { symbol, stockCandles, niftyCandles, classification, scanState, vix, userPreferences } = params

    const mtf = analyzeMultiTimeframe(
      stockCandles.candles1h,
      stockCandles.candles30m || [],
      stockCandles.candles15m,
      stockCandles.candles5m || stockCandles.candles15m
    )
    const dailyContext = analyzeDailyContext(stockCandles.candles1d, stockCandles.candles15m)
    const niftyMtf = niftyCandles?.candles15m?.length
      ? analyzeMultiTimeframe(
          niftyCandles.candles1h || [],
          niftyCandles.candles30m || [],
          niftyCandles.candles15m,
          niftyCandles.candles5m || niftyCandles.candles15m
        )
      : null
    const relativeStrengthVsNifty = this.calculateRelativeStrength(
      stockCandles.candles15m,
      niftyCandles?.candles15m
    )

    const currentPrice = scanState?.lastPrice || mtf.tf15m.price
    const atp = scanState?.atp || mtf.tf15m.vwap

    const context: EquityAnalysisContext = {
      symbol,
      currentPrice,
      atp,
      changePct: scanState?.changePct ?? 0,
      volumeSurgeRatio: scanState?.volumeSurgeRatio ?? 1.0,
      obi: scanState?.obi ?? 0,
      tf5m: {
        price: mtf.tf5m?.price ?? currentPrice,
        rsi: mtf.tf5m?.rsi ?? 50,
        vwap: mtf.tf5m?.vwap ?? atp,
        trend: mtf.tf5m?.trend ?? 'NEUTRAL',
        atr14: mtf.tf5m?.atr14,
      },
      tf15m: {
        price: mtf.tf15m.price,
        rsi: mtf.tf15m.rsi,
        vwap: mtf.tf15m.vwap,
        trend: mtf.tf15m.trend,
        support: mtf.tf15m.support,
        resistance: mtf.tf15m.resistance,
      },
      tf1h: {
        trend: mtf.tf1h.trend,
        support: mtf.tf1h.support,
        resistance: mtf.tf1h.resistance,
      },
      dailyContext,
      relativeStrengthVsNifty,
      isFnoListed: classification.isFnoListed,
      stockOptionPreference: userPreferences?.stockOptionPreference,
      equityHoldingMode: userPreferences?.equityHoldingMode ?? 'MIS',
    }

    const masInput = {
      symbol,
      assetClass: classification.isFnoListed ? 'STOCK_OPTION' : 'EQUITY',
      isFnoListed: classification.isFnoListed,
      mode: 'intraday',
      tf1h: mtf.tf1h,
      tf30m: mtf.tf30m,
      tf15m: mtf.tf15m,
      tf5m: mtf.tf5m,
      dailyContext,
      vix,
      benchmark: {
        trend15m: niftyMtf?.tf15m?.trend || 'SIDEWAYS',
        rsi15m: niftyMtf?.tf15m?.rsi || 50,
        relativeStrength: relativeStrengthVsNifty,
      },
      optionsAnalysisZerodha: {
        pcr: 1.0,
        atmStrike: Math.round(mtf.tf15m.price / 10) * 10,
        marketFlow: 'NEUTRAL',
        rows: [],
      },
      userPreferences,
    }

    return { context, masInput }
  }

  private calculateRelativeStrength(stock15m: Candle[], nifty15m?: Candle[]): number {
    const hasEnoughCandles = nifty15m && nifty15m.length >= 2 && stock15m.length >= 2
    if (!hasEnoughCandles) return 0

    const stockLast = stock15m[stock15m.length - 1]!
    const stockPrev = stock15m[stock15m.length - 2]!
    const niftyLast = nifty15m[nifty15m.length - 1]!
    const niftyPrev = nifty15m[nifty15m.length - 2]!

    const stockPct = ((stockLast.close - stockPrev.close) / stockPrev.close) * 100
    const niftyPct = ((niftyLast.close - niftyPrev.close) / niftyPrev.close) * 100
    return parseFloat((stockPct - niftyPct).toFixed(2))
  }

  /**
   * Routes F&O option actions (BUY_CE / BUY_PE) to their corresponding NFO option contract,
   * or safely falls back to Cash Equity (BUY_EQUITY for bullish, SELL_EQUITY for MIS bearish)
   * when options are unavailable or within the 4-day SEBI physical settlement window.
   */
  private async resolveOptionRouting(
    kc: KiteConnectInstance,
    symbol: string,
    decision: EquityAgentDecision,
    isFnoListed: boolean
  ): Promise<EquityAnalysisPipelineResult> {
    const isDirectionalTrade = decision.decision === 'BUY' || decision.decision === 'SELL'
    const isOptionAction = isDirectionalTrade && (decision.action === 'BUY_CE' || decision.action === 'BUY_PE')
    if (!isOptionAction) {
      return { decision, assetClass: 'EQUITY' }
    }

    if (!isFnoListed || !decision.strike) {
      return { decision: this.applyCashEquityFallback(decision), assetClass: 'EQUITY' }
    }

    const optType = decision.action === 'BUY_CE' ? 'CE' : 'PE'
    const option = await getOptionToken(kc, symbol, decision.strike, optType)

    // SEBI Physical Settlement Guard: Prohibit options within 4 days of monthly expiry
    if (option && !isNearMonthlyExpiry(option.expiry)) {
      return { decision, assetClass: 'STOCK_OPTION', optionDetails: option }
    }

    console.warn(`[EquityAnalysis] Stock option near expiry or unavailable for ${symbol}. Falling back to equity cash.`)
    return { decision: this.applyCashEquityFallback(decision), assetClass: 'EQUITY' }
  }

  private applyCashEquityFallback(decision: EquityAgentDecision): EquityAgentDecision {
    const isBearish = decision.action === 'BUY_PE' || decision.decision === 'SELL'
    if (!isBearish) {
      return { ...decision, action: 'BUY_EQUITY' }
    }

    // Strict institutional rule: Do not silently convert a Put Option intent into a naked intraday cash short!
    // A Put option has strictly capped downside risk, whereas a short equity position has uncapped upside risk.
    console.warn(
      `[EquityAnalysis] Stock option unavailable for bearish setup ${decision.symbol}. Silent conversion of Put Option to Cash Short is PROHIBITED. Abstaining.`
    )
    return {
      ...decision,
      action: 'NONE',
      decision: 'NO_TRADE',
      reason: `${decision.reason} [ABSTAIN: Stock option unavailable near expiry; silent cash short conversion prohibited]`,
    }
  }
}

export const equityAnalysisService = new EquityAnalysisService()
