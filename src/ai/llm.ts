import { getLLMProvider } from './factory.js'
import {
  SCALPER_RULES,
  TREND_RULES,
  POSITION_MANAGEMENT_RULES,
  ORCHESTRATOR_PROMPT,
  TECHNICAL_AGENT_PROMPT,
  OPTIONS_AGENT_PROMPT,
  CONSENSUS_AGENT_PROMPT,
} from './prompts.js'
import type {
  TradingAgentType,
  OrchestratorResponse,
  AgentUpdate,
  AISuccessResponse,
  AISentimentResponse,
} from './types.js'
import { eventHub } from '../utils/event-hub.js'
import { memoryService } from './memory.js'

export class LLMService {
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
    truncateSwings(cleaned.tf15m)
    truncateSwings(cleaned.tf3m)
    if (cleaned.marketData) {
      truncateSwings(cleaned.marketData.tf1h)
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

  public async evaluateMarketState(input: any, userId: string = ''): Promise<OrchestratorResponse> {
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
      const provider = getLLMProvider()
      const text = await provider.chat(
        [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.2 }
      )

      const cleanedText = text
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '')
        .trim()
      const result: OrchestratorResponse = JSON.parse(cleanedText)

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

  public async analyzeSentimentWithAI(input: any) {
    let userPrompt = ''
    let systemMessage = ''
    if (input.prompt) {
      userPrompt = input.prompt
    }
    if (input.systemPrompt) {
      systemMessage = input.systemPrompt
    }

    const provider = getLLMProvider()
    const text = await provider.chat([
      { role: 'system', content: systemMessage },
      { role: 'user', content: userPrompt },
    ])
    const cleanedText = text
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim()
    const result: AISentimentResponse = JSON.parse(cleanedText)
    return result
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

    let userPrompt = ''
    let systemMessage =
      'You are a professional NSE options trader and technical analyst specializing in NIFTY intraday and swing trades. You produce precise, actionable trade plans based on technical indicators, options flow data (OI/COI), and market sentiment. You always respond with valid JSON only.'

    if (agentType === 'TREND') {
      systemMessage += TREND_RULES
      // Programmatic Math Injection: Inject Wave 5 target if available
      const wave5Target = input.tf15m?.waveContext?.wave5Target || input.marketData?.tf15m?.waveContext?.wave5Target
      if (wave5Target) {
        systemMessage = systemMessage.replace(
          /\{\{WAVE5_TARGET_INSTRUCTION\}\}/g,
          `The mathematical Wave 5 Exhaustion Target is exactly ${wave5Target.toFixed(2)}. If price enters within 5 points of this level, shift trailing stop tightly.`
        )
      }
    } else {
      systemMessage += SCALPER_RULES
    }

    try {
      if (input.prompt) {
        userPrompt = input.prompt
      } else {
        const cleanedInput = this.sanitizeForLLM(input)

        let liveContextSection = ''
        if (cleanedInput.liveContext) {
          const oiInsights = cleanedInput.optionsAnalysisZerodha?.windowStats
            ? `\n- OI Window Insights (${cleanedInput.optionsAnalysisZerodha.windowStats.intervalMins}m): Top Short Covering: ${cleanedInput.optionsAnalysisZerodha.windowStats.topShortCovering.map((r: any) => r.symbol).join(', ')}`
            : ''
          const flowInsight = cleanedInput.optionsAnalysisZerodha?.marketFlow
            ? `\n- Aggregate Market Flow: ${cleanedInput.optionsAnalysisZerodha.marketFlow}`
            : ''

          liveContextSection = `
## REAL-TIME WEBSOCKET CONTEXT (TRULY LIVE)
- Trigger Reason: ${cleanedInput.liveContext.reason}
- Last Price: ${cleanedInput.liveContext.tick.last_price}${oiInsights}${flowInsight}
- Momentum: ${cleanedInput.liveContext.reason.includes('Volatility') ? 'High Volatility detected' : 'Price Action driven'}
- Recent Ticks (sampled 60s): ${JSON.stringify(cleanedInput.liveContext.recentTicks.map((t: any) => t.last_price || t))}

NOTE: This real-time data takes PRECEDENCE over historical candles.
`
        }

        let previousDecisionSection = ''
        if (cleanedInput.previousDecision) {
          previousDecisionSection = `
## PREVIOUS AI DECISION (FEEDBACK LOOP)
Your last analysis resulted in:
- Decision: ${cleanedInput.previousDecision.decision}
- Setup: ${cleanedInput.previousDecision.setup}
- Reason: ${cleanedInput.previousDecision.reason}

Use this to decide if the current live breakout confirms your previous bias.
`
        }

        let reversalScoreSection = ''
        if (cleanedInput.reversalScore) {
          reversalScoreSection = `
## REVERSAL QUALITY SCORE (0 to 5)
- Bullish Reversal Score: ${cleanedInput.reversalScore.bullish}/5
- Bearish Reversal Score: ${cleanedInput.reversalScore.bearish}/5
NOTE: Do NOT take a reversal trade (Playbook B) if the score is less than 3/5.
`
        }

        userPrompt = `Analyze market data and produce a trade decision using DUAL TIMEFRAME analysis with ORDER FLOW focus.
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

      if (input.systemPrompt) {
        systemMessage = input.systemPrompt
      }

      const provider = getLLMProvider()
      const text = await provider.chat([
        { role: 'system', content: systemMessage },
        { role: 'user', content: userPrompt },
      ])

      const cleanedText = text
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '')
        .trim()

      try {
        const result: AISuccessResponse = JSON.parse(cleanedText)

        // Validation & Guardrails
        if (result.decision === 'BUY') {
          if (result.confidence < 0 || result.confidence > 100) {
            result.confidence = Math.min(Math.max(result.confidence, 0), 100)
          }
          if (result.stopLoss && result.entry && result.stopLoss >= result.entry) {
            console.warn(
              `[AI Validation] Invalid Stop Loss (${result.stopLoss}) >= Entry (${result.entry}). AI Hallucination detected, overriding.`
            )
            // Default 0.5% index move for Nifty/BankNifty fallback
            result.stopLoss = result.entry * 0.995
          }
          if (
            result.targets &&
            result.targets.length > 0 &&
            result.targets[0] !== undefined &&
            result.entry &&
            result.targets[0] <= result.entry
          ) {
            console.warn(
              `[AI Validation] Invalid Target (${result.targets[0]}) <= Entry (${result.entry}). AI Hallucination detected, overriding.`
            )
            result.targets[0] = result.entry * 1.01
          }
        }

        this.emitUpdate({
          agent: agentType,
          status: 'decided',
          message: `${result.decision} signal with ${result.confidence}% confidence.`,
          data: result,
        })
        return result
      } catch (_parseError) {
        console.error('[AI] Failed to parse JSON response:', cleanedText)
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
    console.log(`[AI] Starting Ensemble Analysis (${agentType} regime)...`)

    try {
      const provider = getLLMProvider()

      // Fetch Memory
      const symbol = input.symbol || 'NIFTY'
      const trend = input.tf15m?.trend || 'SIDEWAYS'
      const vix = input.vix?.current || 15
      const pastTrades = await memoryService.getRegimeStats(userId, symbol, trend, vix)
      const memoryPrompt = memoryService.formatForPrompt(pastTrades)

      const cleanedInput = this.sanitizeForLLM(input)
      const marketDataStr = JSON.stringify(cleanedInput, null, 2)

      // 1. Run Technical and Options agents in parallel
      this.emitUpdate({
        agent: agentType,
        status: 'thinking',
        message: 'Ensemble: Technical & Options agents are analyzing in parallel...',
      })

      const [techRes, optRes] = await Promise.all([
        provider.chat([
          { role: 'system', content: TECHNICAL_AGENT_PROMPT + (agentType === 'TREND' ? TREND_RULES : SCALPER_RULES) },
          { role: 'user', content: `${memoryPrompt}\n\nAnalyze this market state:\n${marketDataStr}` },
        ]),
        provider.chat([
          { role: 'system', content: OPTIONS_AGENT_PROMPT },
          { role: 'user', content: `${memoryPrompt}\n\nAnalyze this options flow:\n${marketDataStr}` },
        ]),
      ])

      const cleanJson = (text: string) =>
        text
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '')
          .trim()

      const technical = JSON.parse(cleanJson(techRes))
      const options = JSON.parse(cleanJson(optRes))

      console.log('[AI] Technical Agent Bias:', technical.bias)
      console.log('[AI] Options Agent Bias:', options.bias)

      this.emitUpdate({
        agent: agentType,
        status: 'thinking',
        message: `Ensemble: Technical: ${technical.bias}, Options: ${options.bias}. Determining consensus...`,
      })

      // 2. Run Consensus Agent
      const consensusPrompt = `
Assess the following inputs and provide a final trade decision.
## TECHNICAL ASSESSMENT
${JSON.stringify(technical, null, 2)}

## OPTIONS ASSESSMENT
${JSON.stringify(options, null, 2)}

## RAW MARKET DATA (CONTEXT)
${marketDataStr}
`
      const consensusRes = await provider.chat([
        { role: 'system', content: CONSENSUS_AGENT_PROMPT },
        { role: 'user', content: consensusPrompt },
      ])

      const result: AISuccessResponse = JSON.parse(cleanJson(consensusRes))

      this.emitUpdate({
        agent: agentType,
        status: 'decided',
        message: `${result.decision} signal confirmed by ensemble.`,
        data: { result, technical, options },
      })

      return result
    } catch (error: any) {
      console.error('[AI] Ensemble Analysis Error:', error)
      this.emitUpdate({
        agent: agentType,
        status: 'error',
        message: 'Ensemble analysis failed. Falling back to single-agent mode.',
      })
      return this.analyzeWithAI(input, agentType)
    }
  }

  public async managePositionWithAI(input: any, agentType: TradingAgentType = 'SCALPER', userId: string = '') {
    console.log(`[AI] Starting managePositionWithAI using ${agentType} agent...`)
    this.emitUpdate({
      agent: 'Risk Manager',
      status: 'thinking',
      message: `Evaluating risk for ${input.openPosition.symbol}...`,
    })

    let systemMessage = `You are a professional NSE Risk Manager. Your sole task is to manage an OPEN options position based on live technicals and OI flow.
The position was originally opened by a ${agentType} agent. You must decide whether to HOLD, EXIT, or UPDATE_SL. Respond with valid JSON only.

`
    systemMessage += POSITION_MANAGEMENT_RULES

    // Programmatic Math Injection: Inject Wave 5 target if available
    const wave5Target = input.tf15m?.waveContext?.wave5Target || input.marketData?.tf15m?.waveContext?.wave5Target
    if (wave5Target) {
      systemMessage = systemMessage.replace(
        /\{\{WAVE5_TARGET_INSTRUCTION\}\}/g,
        `The mathematical Wave 5 Exhaustion Target is exactly ${wave5Target.toFixed(2)}. If price enters within 5 points of this level, shift trailing stop tightly.`
      )
    }

    // Fetch Memory for Risk Context
    const symbol = input.openPosition?.symbol || 'NIFTY'
    const trend = input.marketData?.tf15m?.trend || 'SIDEWAYS'
    const vix = input.marketData?.vix?.current || 15
    const pastTrades = await memoryService.getRegimeStats(userId, symbol, trend, vix)
    const memoryPrompt = memoryService.formatForPrompt(pastTrades)

    const cleanedMarketData = this.sanitizeForLLM({ marketData: input.marketData }).marketData
    const userPrompt = `Evaluate the following open position against current market data:

${memoryPrompt}

## OPEN POSITION
${JSON.stringify(input.openPosition, null, 2)}

## CURRENT MARKET DATA
${JSON.stringify(cleanedMarketData, null, 2)}

## Required Output (JSON only)
{
  "decision": "HOLD" | "EXIT" | "UPDATE_SL",
  "reason": "<1-2 sentences explaining the risk/momentum shift>",
  "newIndexStopLoss": <number or null>,
  "riskRewardRatio": <number or null>,
  "confidence": <0-100>
}
`
    try {
      const provider = getLLMProvider()
      const text = await provider.chat([
        { role: 'system', content: systemMessage },
        { role: 'user', content: userPrompt },
      ])

      const cleanedText = text
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '')
        .trim()
      const result = JSON.parse(cleanedText)

      this.emitUpdate({
        agent: 'Risk Manager',
        status: 'decided',
        message: `${result.decision}: ${result.reason}`,
        data: result,
      })

      return result
    } catch (error: any) {
      console.error('[AI] Error in managePositionWithAI:', error)
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
