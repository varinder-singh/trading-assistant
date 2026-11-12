import type { LLMProvider, LLMMessage } from './types.js'
import { GeminiProvider } from './providers/gemini.js'

export interface EquityAnalysisContext {
  symbol: string
  currentPrice: number
  atp: number // Exchange VWAP
  changePct: number
  volumeSurgeRatio: number
  obi: number
  tf5m: {
    price: number
    rsi: number
    vwap: number
    trend: string
    atr14?: number | undefined
  }
  tf15m: {
    price: number
    rsi: number
    vwap: number
    trend: string
    support: number
    resistance: number
  }
  tf1h?: {
    trend: string
    support: number
    resistance: number
  }
  dailyContext?: {
    trend?: string
    prevDayHigh?: number
    prevDayLow?: number
    atr14?: number
  } | null
  relativeStrengthVsNifty: number
  isFnoListed: boolean
  stockOptionPreference?: string
  equityHoldingMode?: 'MIS' | 'CNC'
}

export interface EquityAgentDecision {
  symbol: string
  decision: 'BUY' | 'SELL' | 'NO_TRADE' | 'HOLD'
  action: 'BUY_EQUITY' | 'BUY_CE' | 'BUY_PE' | 'NONE'
  strike?: number | null
  entryPrice: number
  stopLoss: number
  targets: number[]
  riskRewardRatio: number
  confidence: number
  holdingMode: 'MIS' | 'CNC'
  reason: string
}

export const EQUITY_ANALYST_PROMPT = `
## ROLE: INSTITUTIONAL NSE EQUITY & STOCK OPTIONS ANALYST

You are an institutional trading analyst specialized in National Stock Exchange (NSE) cash equities and stock options.
Your mandate is precision trend continuation and momentum breakouts on high-volume liquid stocks.

### CORE PRINCIPLES:
1. **Unleveraged Equity Physics**:
   - Stock prices move in percentage terms (typically 0.8% to 3.5% intraday).
   - Stop-Losses and Targets are denominated directly in stock price ₹ (INR), NEVER option points or index points.
   - Target 1 (T1) should be realistic for intraday equities (+1.0% to +1.5%, or 1.2R).
   - Target 2 (T2) (+2.0% to +2.5%, or 2.0R).
   - Target 3 (T3) (+3.0% to +3.5%, runner).
   - Stop-Loss must be placed strictly at structural invalidation (e.g. below 5m/15m VWAP or previous swing low, typically 0.8% - 1.5% risk).

2. **Volume & Microstructure Confirmation**:
   - A valid BUY requires: Price > Exchange VWAP (ATP), Volume Surge >= 2.5x, and positive Order Book Imbalance (OBI > 0).
   - Strong Relative Strength vs NIFTY (stock outperforming the broader market) strongly boosts conviction.

3. **Instrument Selection (Cash vs Stock Options)**:
   - If 'isFnoListed' is FALSE: Action MUST be 'BUY_EQUITY'.
   - If 'isFnoListed' is TRUE and user preference allows options:
     - You may suggest 'BUY_CE' for high-conviction momentum near ATM strike, OR 'BUY_EQUITY' for cleaner risk.
     - Never trade illiquid deep OTM strikes.

4. **SEBI Capping Guard**:
   - Cash equities have daily circuit limits (max 20%). Never project unrealistic targets > 5% intraday.

### OUTPUT FORMAT:
You MUST respond ONLY with a single valid JSON object:
{
  "symbol": "<SYMBOL>",
  "decision": "BUY" | "SELL" | "NO_TRADE" | "HOLD",
  "action": "BUY_EQUITY" | "BUY_CE" | "BUY_PE" | "NONE",
  "strike": <strike_number_or_null>,
  "entryPrice": <number>,
  "stopLoss": <number>,
  "targets": [<t1>, <t2>, <t3>],
  "riskRewardRatio": <number>,
  "confidence": <0-100>,
  "holdingMode": "MIS" | "CNC",
  "reason": "<2-3 concise sentences citing price action, volume surge, VWAP, and relative strength>"
}
`

export class EquityAnalystAgent {
  constructor(private readonly provider: LLMProvider = new GeminiProvider()) {}

  public async evaluate(context: EquityAnalysisContext): Promise<EquityAgentDecision> {
    const messages: LLMMessage[] = [
      { role: 'system', content: EQUITY_ANALYST_PROMPT },
      { role: 'user', content: this.buildUserPrompt(context) },
    ]

    try {
      const raw = await this.provider.chat(messages, { temperature: 0.1 })
      return this.parseJson(raw, context)
    } catch (err: any) {
      console.error(`[EquityAnalystAgent] Error evaluating ${context.symbol}:`, err.message || err)
      return this.buildFallbackNoTrade(context, `AI analysis failed: ${err.message}`)
    }
  }

  private buildUserPrompt(context: EquityAnalysisContext): string {
    return `
EVALUATE CANDIDATE FOR NSE TRADE:
- Symbol: ${context.symbol}
- Current Price: ₹${context.currentPrice.toFixed(2)}
- Exchange VWAP (ATP): ₹${context.atp.toFixed(2)}
- Day Change: ${context.changePct >= 0 ? '+' : ''}${context.changePct.toFixed(2)}%
- 5m Volume Surge Ratio: ${context.volumeSurgeRatio.toFixed(2)}x
- Order Book Imbalance (OBI): ${context.obi.toFixed(3)} (-1 to +1)
- Relative Strength vs NIFTY: ${context.relativeStrengthVsNifty >= 0 ? '+' : ''}${context.relativeStrengthVsNifty.toFixed(2)}%

TIMEFRAME SIGNALS:
- 5m: Price ₹${context.tf5m.price}, RSI ${context.tf5m.rsi.toFixed(1)}, VWAP ₹${context.tf5m.vwap.toFixed(2)}, Trend: ${context.tf5m.trend}
- 15m: Price ₹${context.tf15m.price}, RSI ${context.tf15m.rsi.toFixed(1)}, VWAP ₹${context.tf15m.vwap.toFixed(2)}, Support ₹${context.tf15m.support}, Resistance ₹${context.tf15m.resistance}
- 1h: Trend: ${context.tf1h?.trend ?? 'N/A'}, Support ₹${context.tf1h?.support ?? 'N/A'}, Resistance ₹${context.tf1h?.resistance ?? 'N/A'}
- Daily ATR(14): ₹${context.dailyContext?.atr14?.toFixed(2) ?? 'N/A'}

CONSTRAINTS & PREFERENCES:
- F&O Listed: ${context.isFnoListed ? 'YES' : 'NO'}
- Stock Option Preference: ${context.stockOptionPreference ?? 'PREFER_OPTIONS_IF_LISTED'}
- Preferred Holding Mode: ${context.equityHoldingMode ?? 'MIS'}
`
  }

  private parseJson(raw: string, context: EquityAnalysisContext): EquityAgentDecision {
    const cleaned = this.extractJsonBlock(raw)

    try {
      const parsed = JSON.parse(cleaned)
      const decision = parsed.decision ?? 'NO_TRADE'
      const action = this.resolveAction(parsed.action, context.isFnoListed)
      const entryPrice = this.resolveEquityEntryPrice(parsed.entryPrice, context.currentPrice)
      const stopLoss = this.resolveEquityStopLoss(parsed.stopLoss, entryPrice)
      const targets = this.resolveEquityTargets(parsed.targets, entryPrice)
      const strike = this.resolveStrike(action, parsed.strike, context.currentPrice)
      const riskRewardRatio = this.computeRiskReward(entryPrice, stopLoss, targets)

      return {
        symbol: context.symbol,
        decision,
        action,
        strike,
        entryPrice,
        stopLoss,
        targets,
        riskRewardRatio,
        confidence: Number(parsed.confidence) || 50,
        holdingMode: parsed.holdingMode === 'CNC' ? 'CNC' : 'MIS',
        reason: parsed.reason ?? 'Evaluated based on price action and VWAP structure.',
      }
    } catch {
      return this.buildFallbackNoTrade(context, 'Failed to parse AI response JSON.')
    }
  }

  private resolveAction(rawAction: any, isFnoListed: boolean): 'BUY_EQUITY' | 'BUY_CE' | 'BUY_PE' | 'NONE' {
    if (!rawAction || typeof rawAction !== 'string') return 'NONE'
    if (!isFnoListed && (rawAction === 'BUY_CE' || rawAction === 'BUY_PE')) return 'BUY_EQUITY'
    if (rawAction === 'BUY_EQUITY' || rawAction === 'BUY_CE' || rawAction === 'BUY_PE') return rawAction
    return 'NONE'
  }

  private resolveEquityEntryPrice(rawEntry: any, currentPrice: number): number {
    const price = Number(rawEntry)
    if (!price || price <= 0) return currentPrice
    const deviation = Math.abs(price - currentPrice) / currentPrice
    if (deviation > 0.025) {
      console.warn(`[EquityAnalystAgent] AI entry ₹${price} deviates >2.5% from CMP ₹${currentPrice}. Forcing CMP.`)
      return currentPrice
    }
    return price
  }

  private resolveEquityStopLoss(rawSl: any, entryPrice: number): number {
    const sl = Number(rawSl)
    const minSl = entryPrice * 0.97
    const maxSl = entryPrice * 0.995
    if (!sl || sl < minSl || sl > maxSl) {
      return Number((entryPrice * 0.985).toFixed(2))
    }
    return sl
  }

  private resolveEquityTargets(rawTargets: any, entryPrice: number): number[] {
    const defaultTargets = [
      Number((entryPrice * 1.012).toFixed(2)),
      Number((entryPrice * 1.020).toFixed(2)),
      Number((entryPrice * 1.032).toFixed(2)),
    ]
    if (!Array.isArray(rawTargets) || rawTargets.length < 2) return defaultTargets
    const validTargets = rawTargets.map(Number).filter((t) => t > entryPrice && t <= entryPrice * 1.08)
    const isAscending = validTargets.every((t, i) => i === 0 || t > validTargets[i - 1]!)
    if (validTargets.length >= 2 && isAscending) return validTargets
    return defaultTargets
  }

  private resolveStrike(action: string, rawStrike: any, currentPrice: number): number | null {
    if (action === 'BUY_EQUITY' || action === 'NONE') return null
    const strike = Number(rawStrike)
    if (!strike || strike <= 0) return Math.round(currentPrice)
    const deviation = Math.abs(strike - currentPrice) / currentPrice
    if (deviation > 0.15) return Math.round(currentPrice)
    return strike
  }

  private computeRiskReward(entryPrice: number, stopLoss: number, targets: number[]): number {
    const risk = Math.max(entryPrice - stopLoss, 0.01)
    const reward = Math.max((targets[0] || entryPrice) - entryPrice, 0.01)
    return Number((reward / risk).toFixed(2))
  }

  private extractJsonBlock(raw: string): string {
    const text = raw.trim()
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    const hasBraces = firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
    return hasBraces ? text.substring(firstBrace, lastBrace + 1) : text
  }

  private buildFallbackNoTrade(context: EquityAnalysisContext, reason: string): EquityAgentDecision {
    return {
      symbol: context.symbol,
      decision: 'NO_TRADE',
      action: 'NONE',
      strike: null,
      entryPrice: context.currentPrice,
      stopLoss: Number((context.currentPrice * 0.985).toFixed(2)),
      targets: [],
      riskRewardRatio: 0,
      confidence: 0,
      holdingMode: context.equityHoldingMode ?? 'MIS',
      reason,
    }
  }
}
