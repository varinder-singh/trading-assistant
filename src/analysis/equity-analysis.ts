import type { Connect as KiteConnectInstance } from 'kiteconnect'
import { getMultiTimeframeCandles } from '../data/yahoo.js'
import { analyzeMultiTimeframe, analyzeDailyContext } from './technical.js'
import { classifyInstrument, isNearMonthlyExpiry } from '../data/instrument-classifier.js'
import { globalKiteScanner } from '../data/kite-scanner.js'
import { EquityAnalystAgent, type EquityAnalysisContext, type EquityAgentDecision } from '../ai/equity-agent.js'
import { getOptionToken } from '../data/kite.js'
import type { Candle } from '../types/analysis.js'

export interface EquityAnalysisPipelineResult {
  decision: EquityAgentDecision
  assetClass: 'EQUITY' | 'STOCK_OPTION'
  optionDetails?: {
    symbol: string
    token: number
    expiry: Date
  }
}

export class EquityAnalysisService {
  constructor(private readonly agent: EquityAnalystAgent = new EquityAnalystAgent()) {}

  public async analyzeCandidate(
    kc: KiteConnectInstance,
    symbol: string,
    userPreferences?: {
      stockOptionPreference?: string
      equityHoldingMode?: 'MIS' | 'CNC'
      equityRiskPerTrade?: number
    }
  ): Promise<EquityAnalysisPipelineResult> {
    const s = symbol.toUpperCase().trim()

    const classification = await classifyInstrument(kc, s)
    const scanState = globalKiteScanner.getStockState(s)

    const [stockCandles, niftyCandles] = await Promise.all([
      getMultiTimeframeCandles(s, kc).catch(() => null),
      getMultiTimeframeCandles('NIFTY', kc).catch(() => null),
    ])

    if (!stockCandles || stockCandles.candles15m.length === 0) {
      throw new Error(`Insufficient candle data for ${s}`)
    }

    const context = this.assembleContext({
      symbol: s,
      stockCandles,
      niftyCandles,
      classification,
      scanState,
      userPreferences,
    })

    const decision = await this.agent.evaluate(context)

    return this.resolveOptionRouting(kc, s, decision, classification.isFnoListed)
  }

  private assembleContext(params: {
    symbol: string
    stockCandles: any
    niftyCandles: any
    classification: any
    scanState: any
    userPreferences?: any
  }): EquityAnalysisContext {
    const { symbol, stockCandles, niftyCandles, classification, scanState, userPreferences } = params

    const mtf = analyzeMultiTimeframe(
      stockCandles.candles1h,
      stockCandles.candles30m || [],
      stockCandles.candles15m,
      stockCandles.candles5m || stockCandles.candles15m
    )
    const dailyContext = analyzeDailyContext(stockCandles.candles1d, stockCandles.candles15m)
    const relativeStrengthVsNifty = this.calculateRelativeStrength(
      stockCandles.candles15m,
      niftyCandles?.candles15m
    )

    const currentPrice = scanState?.lastPrice || mtf.tf15m.price
    const atp = scanState?.atp || mtf.tf15m.vwap

    return {
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

  private async resolveOptionRouting(
    kc: KiteConnectInstance,
    symbol: string,
    decision: EquityAgentDecision,
    isFnoListed: boolean
  ): Promise<EquityAnalysisPipelineResult> {
    const isOptionAction = decision.decision === 'BUY' && (decision.action === 'BUY_CE' || decision.action === 'BUY_PE')
    if (!isOptionAction) {
      return { decision, assetClass: 'EQUITY' }
    }

    if (!isFnoListed || !decision.strike) {
      decision.action = 'BUY_EQUITY'
      return { decision, assetClass: 'EQUITY' }
    }

    const optType = decision.action === 'BUY_CE' ? 'CE' : 'PE'
    const option = await getOptionToken(kc, symbol, decision.strike, optType)

    // SEBI Physical Settlement Guard: Prohibit options within 4 days of monthly expiry
    if (option && !isNearMonthlyExpiry(option.expiry)) {
      return { decision, assetClass: 'STOCK_OPTION', optionDetails: option }
    }

    console.warn(`[EquityAnalysis] Stock option near expiry or unavailable for ${symbol}. Falling back to equity cash.`)
    decision.action = 'BUY_EQUITY'
    return { decision, assetClass: 'EQUITY' }
  }
}

export const equityAnalysisService = new EquityAnalysisService()
