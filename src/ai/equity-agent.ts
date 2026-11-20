import type { LLMProvider, LLMMessage } from './types.js'
import { GeminiProvider } from './providers/gemini.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('EquityAnalystAgent')

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
  action: 'BUY_EQUITY' | 'SELL_EQUITY' | 'BUY_CE' | 'BUY_PE' | 'NONE'
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
## ROLE: INSTITUTIONAL NSE BI-DIRECTIONAL EQUITY & STOCK OPTIONS ANALYST

You are an institutional trading analyst specialized in National Stock Exchange (NSE) cash equities and stock options.
Your mandate is precision bi-directional momentum trading: capturing both Bullish Breakouts (Long / Call Options) and Bearish Breakdowns during market falls (Short / Put Options).

### CORE PRINCIPLES:
1. **Unleveraged Underlying Stock Physics**:
   - Stock prices move in percentage terms (typically 0.8% to 3.5% intraday).
   - Stop-Losses and Targets are ALWAYS denominated in underlying stock price ₹ (INR), NEVER option premium points.
   - **For BULLISH setups (BUY_EQUITY or BUY_CE)**:
     - Stop-Loss MUST be below entryPrice (e.g. below 5m/15m VWAP or swing low, ~0.8% - 1.5% risk).
     - Targets MUST be above entryPrice in ascending order: T1 (+1.0% to +1.5%), T2 (+2.0% to +2.5%), T3 (+3.0% to +3.5%).
   - **For BEARISH setups (BUY_PE or SELL_EQUITY during market/stock fall)**:
     - Stop-Loss MUST be above entryPrice (e.g. above 5m/15m VWAP or swing high, ~0.8% - 1.5% risk).
     - Targets MUST be below entryPrice in descending order: T1 (-1.0% to -1.5%), T2 (-2.0% to -2.5%), T3 (-3.0% to -3.5%).

2. **Bi-Directional Volume & Microstructure Confirmation**:
   - **Valid BULLISH Breakout (decision: "BUY")**: Price > Exchange VWAP (ATP), Volume Surge >= 2.5x, positive Order Book Imbalance (OBI > 0), and positive Relative Strength vs NIFTY.
   - **Valid BEARISH Breakdown (decision: "SELL")**: Price < Exchange VWAP (ATP), Volume Surge >= 2.5x, negative Order Book Imbalance (OBI < 0), or heavy Relative Weakness vs NIFTY during a market fall.

3. **Instrument Selection (Cash vs Stock Options & SEBI Rules)**:
   - **Bullish**:
     - If 'isFnoListed' is TRUE and user preference allows options: prefer 'BUY_CE' near ATM strike, or 'BUY_EQUITY'.
     - If 'isFnoListed' is FALSE: Action MUST be 'BUY_EQUITY'.
   - **Bearish (Market / Stock Fall)**:
     - If 'isFnoListed' is TRUE and user preference allows options: prefer 'BUY_PE' (Put Option) near ATM strike to capture downside delta + IV expansion with capped risk.
     - If 'isFnoListed' is FALSE (or EQUITY_ONLY preference):
       - If Preferred Holding Mode is 'MIS' (Intraday): Action is 'SELL_EQUITY' (Intraday Cash Short).
       - If Preferred Holding Mode is 'CNC' (Swing): Output 'NO_TRADE' / 'NONE' because SEBI prohibits overnight shorting of cash equities in CNC.

4. **SEBI Capping Guard**:
   - Cash equities have daily circuit limits. Never project unrealistic intraday targets > 5% away from entry.

5. **RSI Exhaustion Gate (Anti-Chasing Protection)**:
   - For BEARISH setups (BUY_PE or SELL_EQUITY): If 15m RSI is < 35, the downward leg is already in late exhaustion and Put Option IV is inflated. Output 'NO_TRADE' / 'NONE'.
   - For BULLISH setups (BUY_CE or BUY_EQUITY): If 15m RSI is > 65, the upward leg is already overextended and Call Option IV is peaked. Output 'NO_TRADE' / 'NONE'.

### OUTPUT FORMAT:
You MUST respond ONLY with a single valid JSON object:
{
  "symbol": "<SYMBOL>",
  "decision": "BUY" | "SELL" | "NO_TRADE" | "HOLD",
  "action": "BUY_EQUITY" | "SELL_EQUITY" | "BUY_CE" | "BUY_PE" | "NONE",
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
      logger.error(`Error evaluating ${context.symbol}:`, err)
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
      const holdingMode = parsed.holdingMode === 'CNC' ? 'CNC' : 'MIS'
      const action = this.resolveAction(parsed.action, context.isFnoListed, holdingMode)
      const isBearish = parsed.decision === 'SELL' || action === 'BUY_PE' || action === 'SELL_EQUITY'
      const decision = this.normalizeDecision(parsed.decision, action, isBearish)

      // RSI Exhaustion Guard: Reject late-stage breakdown or breakout chasing
      if (isBearish && context.tf15m.rsi < 35) {
        logger.warn(
          `Bearish setup rejected for ${context.symbol}: 15m RSI (${context.tf15m.rsi.toFixed(1)}) is oversold (< 35). Exhaustion breakdown risk.`
        )
        return this.buildFallbackNoTrade(
          context,
          `Bearish entry rejected: 15m RSI (${context.tf15m.rsi.toFixed(1)}) is oversold (< 35). High risk of mean-reversion bounce.`
        )
      }

      if (!isBearish && action !== 'NONE' && decision === 'BUY' && context.tf15m.rsi > 65) {
        logger.warn(
          `Bullish setup rejected for ${context.symbol}: 15m RSI (${context.tf15m.rsi.toFixed(1)}) is overbought (> 65). Exhaustion breakout risk.`
        )
        return this.buildFallbackNoTrade(
          context,
          `Bullish entry rejected: 15m RSI (${context.tf15m.rsi.toFixed(1)}) is overbought (> 65). High risk of pullback.`
        )
      }

      const entryPrice = this.resolveEquityEntryPrice(parsed.entryPrice, context.currentPrice)
      const stopLoss = isBearish
        ? this.resolveBearishStopLoss(parsed.stopLoss, entryPrice)
        : this.resolveBullishStopLoss(parsed.stopLoss, entryPrice)
      const targets = isBearish
        ? this.resolveBearishTargets(parsed.targets, entryPrice)
        : this.resolveBullishTargets(parsed.targets, entryPrice)
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
        holdingMode,
        reason: parsed.reason ?? 'Evaluated based on price action and VWAP structure.',
      }
    } catch {
      return this.buildFallbackNoTrade(context, 'Failed to parse AI response JSON.')
    }
  }

  /**
   * Normalizes the decision verb ('BUY', 'SELL', 'NO_TRADE', 'HOLD') to stay consistent
   * with the resolved action, preventing mismatched decision/action pairs.
   */
  private normalizeDecision(
    rawDecision: any,
    action: EquityAgentDecision['action'],
    isBearish: boolean
  ): EquityAgentDecision['decision'] {
    if (action === 'NONE') {
      return rawDecision === 'HOLD' ? 'HOLD' : 'NO_TRADE'
    }
    if (rawDecision === 'NO_TRADE' || rawDecision === 'HOLD') return rawDecision
    return isBearish ? 'SELL' : 'BUY'
  }

  /**
   * Resolves the instrument action while enforcing SEBI rules:
   * - Non-F&O stocks cannot trade options (falls back to BUY_EQUITY or SELL_EQUITY).
   * - Overnight short selling in CNC mode is prohibited by SEBI (falls back to NONE).
   */
  private resolveAction(
    rawAction: any,
    isFnoListed: boolean,
    holdingMode: 'MIS' | 'CNC'
  ): 'BUY_EQUITY' | 'SELL_EQUITY' | 'BUY_CE' | 'BUY_PE' | 'NONE' {
    if (!rawAction || typeof rawAction !== 'string') return 'NONE'
    if (!isFnoListed && rawAction === 'BUY_CE') return 'BUY_EQUITY'
    if (!isFnoListed && rawAction === 'BUY_PE') {
      return holdingMode === 'MIS' ? 'SELL_EQUITY' : 'NONE'
    }
    if (rawAction === 'SELL_EQUITY' && holdingMode === 'CNC') return 'NONE'
    if (
      rawAction === 'BUY_EQUITY' ||
      rawAction === 'SELL_EQUITY' ||
      rawAction === 'BUY_CE' ||
      rawAction === 'BUY_PE'
    ) {
      return rawAction
    }
    return 'NONE'
  }

  private resolveEquityEntryPrice(rawEntry: any, currentPrice: number): number {
    const price = Number(rawEntry)
    if (!price || price <= 0) return currentPrice
    const deviation = Math.abs(price - currentPrice) / currentPrice
    if (deviation > 0.025) {
      logger.warn(`AI entry ₹${price} deviates >2.5% from CMP ₹${currentPrice}. Forcing CMP.`)
      return currentPrice
    }
    return price
  }

  /**
   * Validates and bounds stop-loss for Bullish setups (must sit 0.5% to 3.0% BELOW entry).
   */
  private resolveBullishStopLoss(rawSl: any, entryPrice: number): number {
    const sl = Number(rawSl)
    const minSl = entryPrice * 0.97
    const maxSl = entryPrice * 0.995
    if (!sl || sl < minSl || sl > maxSl) {
      return Number((entryPrice * 0.985).toFixed(2))
    }
    return sl
  }

  /**
   * Validates and bounds stop-loss for Bearish / Short setups (must sit 0.5% to 3.0% ABOVE entry).
   */
  private resolveBearishStopLoss(rawSl: any, entryPrice: number): number {
    const sl = Number(rawSl)
    const minSl = entryPrice * 1.005
    const maxSl = entryPrice * 1.03
    if (!sl || sl < minSl || sl > maxSl) {
      return Number((entryPrice * 1.015).toFixed(2))
    }
    return sl
  }

  /**
   * Validates and bounds profit targets for Bullish setups (ascending above entryPrice).
   */
  private resolveBullishTargets(rawTargets: any, entryPrice: number): number[] {
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

  /**
   * Validates and bounds profit targets for Bearish / Short setups (descending below entryPrice).
   */
  private resolveBearishTargets(rawTargets: any, entryPrice: number): number[] {
    const defaultTargets = [
      Number((entryPrice * 0.988).toFixed(2)),
      Number((entryPrice * 0.980).toFixed(2)),
      Number((entryPrice * 0.968).toFixed(2)),
    ]
    if (!Array.isArray(rawTargets) || rawTargets.length < 2) return defaultTargets
    const validTargets = rawTargets.map(Number).filter((t) => t < entryPrice && t >= entryPrice * 0.92)
    const isDescending = validTargets.every((t, i) => i === 0 || t < validTargets[i - 1]!)
    if (validTargets.length >= 2 && isDescending) return validTargets
    return defaultTargets
  }

  private resolveStrike(action: string, rawStrike: any, currentPrice: number): number | null {
    if (action === 'BUY_EQUITY' || action === 'SELL_EQUITY' || action === 'NONE') return null
    const strike = Number(rawStrike)
    if (!strike || strike <= 0) return Math.round(currentPrice)
    const deviation = Math.abs(strike - currentPrice) / currentPrice
    if (deviation > 0.15) return Math.round(currentPrice)
    return strike
  }

  private computeRiskReward(entryPrice: number, stopLoss: number, targets: number[]): number {
    const risk = Math.max(Math.abs(entryPrice - stopLoss), 0.01)
    const reward = Math.max(Math.abs((targets[0] || entryPrice) - entryPrice), 0.01)
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
