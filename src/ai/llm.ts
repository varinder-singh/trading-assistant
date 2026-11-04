import { getLLMProvider } from './factory.js'
import { SCALPER_RULES, TREND_RULES, POSITION_MANAGEMENT_RULES, ORCHESTRATOR_PROMPT } from './prompts.js'
import { TradingMASOrchestrator } from './mas/agents.js'
import type {
  TradingAgentType,
  OrchestratorResponse,
  AgentUpdate,
  AISuccessResponse,
  AISentimentResponse,
} from './types.js'
import { eventHub } from '../utils/event-hub.js'
import { memoryService } from './memory.js'

export function cleanJson(text: string): string {
  return text
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
    .replace(/"(?:[^"\\]|\\.)*"/g, (match) => match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'))
}

function sanitizeStopLoss(
  result: AISuccessResponse,
  indexPrice: number,
  isBearish: boolean,
  _agentType: TradingAgentType = 'SCALPER'
): void {
  const isDirectionInvalid = isBearish ? result.stopLoss <= indexPrice : result.stopLoss >= indexPrice
  const distPct = Math.abs(result.stopLoss - indexPrice) / indexPrice
  const isDistanceInvalid = distPct < 0.001 || distPct > 0.02
  const isMacroOutOfRange = result.stopLoss < indexPrice * 0.9 || result.stopLoss > indexPrice * 1.1

  if (
    isDirectionInvalid ||
    isDistanceInvalid ||
    isMacroOutOfRange ||
    !result.stopLoss ||
    Number.isNaN(result.stopLoss)
  ) {
    console.warn(
      `[AI Validation] Invalid Stop Loss (${result.stopLoss}) for indexPrice ${indexPrice} (${(distPct * 100).toFixed(2)}% distance, direction=${isBearish ? 'PE' : 'CE'}). AI Hallucination detected, overriding.`
    )
    result.stopLoss = isBearish ? indexPrice * 1.005 : indexPrice * 0.995
  }
}

function isSingleTargetValid(target: number, indexPrice: number, isBearish: boolean): boolean {
  if (!target || Number.isNaN(target)) return false
  const isRightSide = isBearish ? target < indexPrice : target > indexPrice
  const isWithinBounds = Math.abs(target - indexPrice) / indexPrice <= 0.05
  return isRightSide && isWithinBounds
}

function sanitizeTargets(result: AISuccessResponse, indexPrice: number, isBearish: boolean): void {
  const rawTargets = Array.isArray(result.targets) ? result.targets : []
  const validTargets = rawTargets.filter((t) => isSingleTargetValid(t, indexPrice, isBearish))

  if (validTargets.length === 0) {
    console.warn(
      `[AI Validation] Invalid Target (${rawTargets[0]}) for direction ${isBearish ? 'PE' : 'CE'} (indexPrice ${indexPrice}). AI Hallucination detected, overriding.`
    )
    result.targets = [isBearish ? indexPrice * 0.995 : indexPrice * 1.005]
    return
  }

  // Enforce monotonic target progression (ascending for CE, descending for PE)
  const sortedTargets = [...validTargets].sort((a, b) => (isBearish ? b - a : a - b))
  result.targets = sortedTargets
}

export function sanitizeAiDecision(
  result: AISuccessResponse,
  input: any,
  agentType: TradingAgentType = 'SCALPER'
): AISuccessResponse {
  // Normalize "SELL" with BUY_PE / BUY_CE into "BUY" so bearish option entries are never bypassed
  if (
    (result.decision as string) === 'SELL' &&
    (result.optionAction === 'BUY_PE' || result.optionAction === 'BUY_CE')
  ) {
    result.decision = 'BUY'
  }

  if (result.decision !== 'BUY') return result

  if (result.confidence < 0 || result.confidence > 100 || Number.isNaN(result.confidence)) {
    result.confidence = Math.min(Math.max(result.confidence || 0, 0), 100)
  }

  const isBearish = result.optionAction === 'BUY_PE'
  const indexPrice = result.entry || input?.tf15m?.price || input?.price || 0
  if (indexPrice <= 0) return result

  if (!result.entry) {
    result.entry = indexPrice
  }

  sanitizeStopLoss(result, indexPrice, isBearish, agentType)
  sanitizeTargets(result, indexPrice, isBearish)

  return result
}

import type { LLMProvider } from './types.js'
import { MemoryService } from './memory.js'

export class LLMService {
  public readonly masOrchestrator: TradingMASOrchestrator

  constructor(
    private readonly providerFactory: () => LLMProvider = getLLMProvider,
    private readonly memory: MemoryService = memoryService
  ) {
    this.masOrchestrator = new TradingMASOrchestrator(this.providerFactory, this.memory)
  }

  private emitUpdate(update: AgentUpdate) {
    eventHub.emit('agent_update', update)
  }

  private sanitizeForLLM(input: any): any {
    if (!input) return input

    // Deep clone carefully to avoid modifying the original running context state
    const cleaned = JSON.parse(JSON.stringify(input))

    // 1. Downsample Ticks (max 15 evenly spaced ticks representing the entire window)
    const downsampleTicks = (ticks: any[]) => {
      if (!Array.isArray(ticks) || ticks.length <= 15) return ticks
      const step = Math.max(1, Math.floor(ticks.length / 15))
      return ticks.filter((_, i) => i % step === 0 || i === ticks.length - 1)
    }

    if (cleaned.liveContext && Array.isArray(cleaned.liveContext.recentTicks)) {
      cleaned.liveContext.recentTicks = downsampleTicks(cleaned.liveContext.recentTicks)
    }

    if (cleaned.marketData?.liveContext && Array.isArray(cleaned.marketData.liveContext.recentTicks)) {
      cleaned.marketData.liveContext.recentTicks = downsampleTicks(cleaned.marketData.liveContext.recentTicks)
    }

    // 2. Truncate Swings (keep only last 10)
    const truncateSwings = (tf: any) => {
      if (tf && Array.isArray(tf.swings) && tf.swings.length > 10) {
        tf.swings = tf.swings.slice(-10)
      }
    }

    truncateSwings(cleaned.tf1h)
    truncateSwings(cleaned.tf30m)
    truncateSwings(cleaned.tf15m)
    truncateSwings(cleaned.tf3m)
    if (cleaned.marketData) {
      truncateSwings(cleaned.marketData.tf1h)
      truncateSwings(cleaned.marketData.tf30m)
      truncateSwings(cleaned.marketData.tf15m)
      truncateSwings(cleaned.marketData.tf3m)
    }

    // 3. Strip Raw Historical Candles (they consume massive tokens)
    const stripCandles = (obj: any) => {
      if (!obj) return
      delete obj.candles1h
      delete obj.candles15m
      delete obj.candles30m
      delete obj.candles3m
      delete obj.candles1d
    }

    stripCandles(cleaned)
    stripCandles(cleaned.marketData)

    // 4. Compress Previous Decision Context
    if (cleaned.previousDecision) {
      cleaned.previousDecision = {
        decision: cleaned.previousDecision.decision,
        setup: cleaned.previousDecision.setup,
        reason: cleaned.previousDecision.reason,
      }
    }

    return cleaned
  }

  public async evaluateMarketState(input: any, _userId: string = ''): Promise<OrchestratorResponse> {
    console.log('[AI] Starting evaluateMarketState (Orchestrator)...')
    this.emitUpdate({
      agent: 'Orchestrator',
      status: 'thinking',
      message: 'Evaluating market regime and selecting active agent...',
    })

    const systemMessage = ORCHESTRATOR_PROMPT
    const cleanedInput = this.sanitizeForLLM(input)
    const userPrompt = `Evaluate the current macro context to decide the active trading agent:
## MARKET DATA
${JSON.stringify(cleanedInput, null, 2)}
`
    try {
      const provider = this.providerFactory()
      const text = await provider.chat(
        [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.2 }
      )

      const result: OrchestratorResponse = JSON.parse(cleanJson(text))

      this.emitUpdate({
        agent: 'Orchestrator',
        status: 'decided',
        message: `Selected ${result.activeAgent} agent with ${result.confidence}% confidence.`,
        data: result,
      })
      this.emitUpdate({
        agent: 'Regime Validator',
        status: 'decided',
        message: `Regime validated. Passing control to ${result.activeAgent}.`,
        data: {
          rationale: `Validated the current market regime based on multi-timeframe structure, momentum, and institutional activity. The environment dictates the ${result.activeAgent} strategy is optimal.`,
          marketRegimeConfidence: result.confidence,
        },
      })

      return result
    } catch (error: any) {
      console.error('[AI] Error in evaluateMarketState:', error)
      this.emitUpdate({
        agent: 'Orchestrator',
        status: 'error',
        message: 'Failed to evaluate market state. Falling back to SCALPER.',
      })
      return {
        activeAgent: 'SCALPER',
        confidence: 0,
        rationale: 'Orchestrator failed, falling back to SCALPER',
      }
    }
  }

  public async analyzeSentimentWithAI(input: { prompt?: string; systemPrompt?: string }) {
    const userPrompt = input.prompt || ''
    const systemMessage = input.systemPrompt || ''

    const provider = this.providerFactory()
    const text = await provider.chat([
      { role: 'system', content: systemMessage },
      { role: 'user', content: userPrompt },
    ])
    const result: AISentimentResponse = JSON.parse(cleanJson(text))
    return result
  }

  private injectWave5Target(systemMessage: string, input: any): string {
    const wave5Target = input.tf15m?.waveContext?.wave5Target || input.marketData?.tf15m?.waveContext?.wave5Target
    if (!wave5Target) {
      return systemMessage.replace(/\{\{WAVE5_TARGET_INSTRUCTION\}\}\n?/g, '')
    }

    return systemMessage.replace(
      /\{\{WAVE5_TARGET_INSTRUCTION\}\}/g,
      `The mathematical Wave 5 Exhaustion Target is exactly ${wave5Target.toFixed(2)}. If price enters within 5 points of this level, shift trailing stop tightly.`
    )
  }

  private buildSingleAgentSystemPrompt(input: any, agentType: TradingAgentType): string {
    if (input.systemPrompt) return input.systemPrompt

    const baseMessage =
      'You are a professional NSE options trader and technical analyst specializing in NIFTY intraday and swing trades. You produce precise, actionable trade plans based on technical indicators, options flow data (OI/COI), and market sentiment. You always respond with valid JSON only.'

    if (agentType === 'TREND') {
      return this.injectWave5Target(baseMessage + TREND_RULES, input)
    }
    return baseMessage + SCALPER_RULES
  }

  private buildLiveContextSection(cleanedInput: any): string {
    if (!cleanedInput.liveContext) return ''

    const oiInsights = cleanedInput.optionsAnalysisZerodha?.windowStats
      ? `\n- OI Window Insights (${cleanedInput.optionsAnalysisZerodha.windowStats.intervalMins}m): Top Short Covering: ${cleanedInput.optionsAnalysisZerodha.windowStats.topShortCovering.map((r: any) => r.symbol).join(', ')}`
      : ''
    const flowInsight = cleanedInput.optionsAnalysisZerodha?.marketFlow
      ? `\n- Aggregate Market Flow: ${cleanedInput.optionsAnalysisZerodha.marketFlow}`
      : ''

    return `
## REAL-TIME WEBSOCKET CONTEXT (TRULY LIVE)
- Trigger Reason: ${cleanedInput.liveContext.reason}
- Last Price: ${cleanedInput.liveContext.tick.last_price}${oiInsights}${flowInsight}
- Momentum: ${cleanedInput.liveContext.reason.includes('Volatility') ? 'High Volatility detected' : 'Price Action driven'}
- Recent Ticks (sampled 60s): ${JSON.stringify(cleanedInput.liveContext.recentTicks.map((t: any) => t.last_price || t))}

NOTE: This real-time data takes PRECEDENCE over historical candles.
`
  }

  private buildPreviousDecisionSection(cleanedInput: any): string {
    if (!cleanedInput.previousDecision) return ''

    return `
## PREVIOUS AI DECISION (FEEDBACK LOOP)
Your last analysis resulted in:
- Decision: ${cleanedInput.previousDecision.decision}
- Setup: ${cleanedInput.previousDecision.setup}
- Reason: ${cleanedInput.previousDecision.reason}

Use this to decide if the current live breakout confirms your previous bias.
`
  }

  private buildReversalScoreSection(cleanedInput: any): string {
    if (!cleanedInput.reversalScore) return ''

    return `
## REVERSAL QUALITY SCORE (0 to 5)
- Bullish Reversal Score: ${cleanedInput.reversalScore.bullish}/5
- Bearish Reversal Score: ${cleanedInput.reversalScore.bearish}/5
NOTE: Do NOT take a reversal trade (Playbook B) if the score is less than 3/5.
`
  }

  private buildSingleAgentUserPrompt(input: any): string {
    if (input.prompt) return input.prompt

    const cleanedInput = this.sanitizeForLLM(input)
    const liveContextSection = this.buildLiveContextSection(cleanedInput)
    const previousDecisionSection = this.buildPreviousDecisionSection(cleanedInput)
    const reversalScoreSection = this.buildReversalScoreSection(cleanedInput)

    return `Analyze market data and produce a trade decision using DUAL TIMEFRAME analysis with ORDER FLOW focus.
${liveContextSection}
${previousDecisionSection}
${reversalScoreSection}
## Market Data
${JSON.stringify(cleanedInput, null, 2)}

## Required Output (JSON only)
{
  "decision": "BUY" or "SELL" or "NO_TRADE",
  "setup": "TRUE_BREAKOUT" | "INSTITUTIONAL_TRAP" | "TREND_CONTINUATION" | "NONE",
  "macroTrend": "COMPRESSION_BULLISH" | "EXPANDING_BEARISH" | "SIDEWAYS" | string,
  "instrument": "OPTIONS",
  "optionAction": "BUY_CE" or "BUY_PE" or "NONE",
  "strike": <number or null>,
  "reason": "<2-3 sentences citing technicals AND specific OI/buildup signals>",
  "confidence": <0-100>,
  "entry": <number - Current Index Price or Breakout Level>,
  "stopLoss": <number - ACTUAL INDEX LEVEL FOR INVALIDATION>,
  "targets": [<number>, <number>],
  "riskRewardRatio": <number - e.g. 1.5 or 2.0>
}

IMPORTANT: Do NOT attempt to guess the option premium price. Identify the structural support/resistance on the INDEX chart (Tier 1/Tier 2) and use that as the stopLoss.
`
  }

  public async analyzeWithAI(
    input: any,
    agentType: TradingAgentType = 'SCALPER'
  ): Promise<AISuccessResponse | undefined> {
    console.log(`[AI] Starting analyzeWithAI using ${agentType} agent...`)
    this.emitUpdate({
      agent: agentType,
      status: 'thinking',
      message: `Analyzing technicals and order flow for ${agentType} setup...`,
    })

    const systemMessage = this.buildSingleAgentSystemPrompt(input, agentType)

    try {
      const userPrompt = this.buildSingleAgentUserPrompt(input)
      const provider = this.providerFactory()
      const text = await provider.chat([
        { role: 'system', content: systemMessage },
        { role: 'user', content: userPrompt },
      ])

      try {
        const result: AISuccessResponse = JSON.parse(cleanJson(text))
        sanitizeAiDecision(result, input, agentType)

        this.emitUpdate({
          agent: agentType,
          status: 'decided',
          message: `${result.decision} signal with ${result.confidence}% confidence.`,
          data: result,
        })
        return result
      } catch (_parseError) {
        console.error('[AI] Failed to parse JSON response:', text)
        this.emitUpdate({
          agent: agentType,
          status: 'error',
          message: 'Failed to parse AI response.',
        })
        return
      }
    } catch (error: any) {
      console.error('[AI] Critical Error in analyzeWithAI:', error)
      this.emitUpdate({
        agent: agentType,
        status: 'error',
        message: 'Internal AI error during analysis.',
      })
      return
    }
  }

  public async analyzeWithEnsemble(
    input: any,
    agentType: TradingAgentType = 'SCALPER',
    userId: string = ''
  ): Promise<AISuccessResponse | undefined> {
    console.log(`[AI] Starting 3-Stage Hybrid MAS Graph Analysis (${agentType} regime)...`)
    this.emitUpdate({
      agent: agentType,
      status: 'thinking',
      message: 'MAS Graph: Structure, Options & Macro specialists analyzing in parallel...',
    })

    try {
      const result = await this.masOrchestrator.executeEnsembleGraph(input, agentType, userId, sanitizeAiDecision)
      return result
    } catch (error: any) {
      console.error('[AI] MAS Ensemble Analysis Error:', error)
      this.emitUpdate({
        agent: agentType,
        status: 'error',
        message: 'MAS ensemble analysis failed. Falling back to single-agent mode.',
      })
      return this.analyzeWithAI(input, agentType)
    }
  }

  public async managePositionWithAI(
    input: any,
    agentType: TradingAgentType = 'SCALPER',
    userId: string = ''
  ): Promise<any> {
    console.log(`[AI] Starting managePositionWithAI (PositionGuardianAgent) using ${agentType} agent...`)
    this.emitUpdate({
      agent: 'Risk Manager',
      status: 'thinking',
      message: `Evaluating risk & clean-slate counterfactual for ${input.openPosition?.symbol || 'NIFTY'}...`,
    })

    try {
      const symbol = input.openPosition?.symbol || 'NIFTY'
      const trend = input.marketData?.tf15m?.trend || 'SIDEWAYS'
      const vix = input.marketData?.vix?.current || 15
      const pastTrades = await this.memory.getRegimeStats(userId, symbol, trend, vix)
      const memoryPrompt = this.memory.formatForPrompt(pastTrades, agentType, symbol, vix)
      const cleanedMarketData = this.sanitizeForLLM({ marketData: input.marketData }).marketData
      const provider = this.providerFactory()

      const result = await this.masOrchestrator.guardianAgent.evaluateOpenPosition(
        {
          ...input,
          marketData: cleanedMarketData,
        },
        agentType,
        provider,
        memoryPrompt
      )

      this.emitUpdate({
        agent: 'Risk Manager',
        status: 'decided',
        message: `${result.decision} (${result.cleanSlateCounterfactual}): ${result.reason}`,
        data: result,
      })

      return result
    } catch (error: any) {
      console.error('[AI] Error in managePositionWithAI:', error)
      const rawSystemMessage = `You are a professional NSE Risk Manager. Your sole task is to manage an OPEN options position based on live technicals and OI flow.\n${POSITION_MANAGEMENT_RULES}`
      void this.injectWave5Target(rawSystemMessage, input)
      this.emitUpdate({
        agent: 'Risk Manager',
        status: 'error',
        message: 'Risk evaluation failed. Holding for safety.',
      })
      return {
        decision: 'HOLD',
        reason: 'AI re-evaluation failed, holding as safety fallback',
        confidence: 0,
      }
    }
  }
}
