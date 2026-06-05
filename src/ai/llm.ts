import { getLLMProvider } from "./factory.js"
import { SCALPER_RULES, TREND_RULES, POSITION_MANAGEMENT_RULES, ORCHESTRATOR_PROMPT } from "./prompts.js"
import type {
  TradingAgentType,
  OrchestratorResponse,
  AgentUpdate,
  AISuccessResponse,
  AISentimentResponse,
} from "./types.js"
import { eventHub } from "../utils/event-hub.js"

export class LLMService {
  private emitUpdate(update: AgentUpdate) {
    eventHub.emit("agent_update", update)
  }

  public async evaluateMarketState(input: any): Promise<OrchestratorResponse> {
    console.log("[AI] Starting evaluateMarketState (Orchestrator)...")
    this.emitUpdate({
      agent: "Orchestrator",
      status: "thinking",
      message: "Evaluating market regime and selecting active agent...",
    })

    const systemMessage = ORCHESTRATOR_PROMPT
    const userPrompt = `Evaluate the current macro context to decide the active trading agent:
## MARKET DATA
${JSON.stringify(input, null, 2)}
`
    try {
      const provider = getLLMProvider()
      const text = await provider.chat(
        [
          { role: "system", content: systemMessage },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0.2 }
      )

      const cleanedText = text
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "")
        .trim()
      const result: OrchestratorResponse = JSON.parse(cleanedText)

      this.emitUpdate({
        agent: "Orchestrator",
        status: "decided",
        message: `Selected ${result.activeAgent} agent with ${result.confidence}% confidence.`,
        data: result,
      })

      return result
    } catch (error: any) {
      console.error("[AI] Error in evaluateMarketState:", error)
      this.emitUpdate({
        agent: "Orchestrator",
        status: "error",
        message: "Failed to evaluate market state. Falling back to SCALPER.",
      })
      return {
        activeAgent: "SCALPER",
        confidence: 0,
        rationale: "Orchestrator failed, falling back to SCALPER",
      }
    }
  }

  public async analyzeSentimentWithAI(input: any) {
    let userPrompt = ""
    let systemMessage = ""
    if (input.prompt) {
      userPrompt = input.prompt
    }
    if (input.systemPrompt) {
      systemMessage = input.systemPrompt
    }

    const provider = getLLMProvider()
    const text = await provider.chat([
      { role: "system", content: systemMessage },
      { role: "user", content: userPrompt },
    ])
    const cleanedText = text
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim()
    const result: AISentimentResponse = JSON.parse(cleanedText)
    return result
  }

  public async analyzeWithAI(
    input: any,
    agentType: TradingAgentType = "SCALPER"
  ): Promise<AISuccessResponse | undefined> {
    console.log(`[AI] Starting analyzeWithAI using ${agentType} agent...`)
    this.emitUpdate({
      agent: agentType,
      status: "thinking",
      message: `Analyzing technicals and order flow for ${agentType} setup...`,
    })

    let userPrompt = ""
    let systemMessage =
      "You are a professional NSE options trader and technical analyst specializing in NIFTY intraday and swing trades. You produce precise, actionable trade plans based on technical indicators, options flow data (OI/COI), and market sentiment. You always respond with valid JSON only."

    if (agentType === "TREND") {
      systemMessage += TREND_RULES
      // Programmatic Math Injection: Inject Wave 5 target if available
      const wave5Target = input.tf15m?.waveContext?.wave5Target || input.marketData?.tf15m?.waveContext?.wave5Target
      if (wave5Target) {
        systemMessage = systemMessage.replace(
          /`Wave 5 Target = Wave 4 Low \+ \(1\.0 \* \(Wave 1 High - Wave 1 Low\)\)`/g,
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
        let liveContextSection = ""
        if (input.liveContext) {
          const oiInsights = input.optionsAnalysisZerodha?.windowStats
            ? `\n- OI Window Insights (${input.optionsAnalysisZerodha.windowStats.intervalMins}m): Top Short Covering: ${input.optionsAnalysisZerodha.windowStats.topShortCovering.map((r: any) => r.symbol).join(", ")}`
            : ""
          const flowInsight = input.optionsAnalysisZerodha?.marketFlow
            ? `\n- Aggregate Market Flow: ${input.optionsAnalysisZerodha.marketFlow}`
            : ""

          liveContextSection = `
## REAL-TIME WEBSOCKET CONTEXT (TRULY LIVE)
- Trigger Reason: ${input.liveContext.reason}
- Last Price: ${input.liveContext.tick.last_price}${oiInsights}${flowInsight}
- Momentum: ${input.liveContext.reason.includes("Volatility") ? "High Volatility detected" : "Price Action driven"}
- Recent Ticks (last 60s): ${JSON.stringify(input.liveContext.recentTicks.map((t: any) => t.last_price))}

NOTE: This real-time data takes PRECEDENCE over historical candles.
`
        }

        let previousDecisionSection = ""
        if (input.previousDecision) {
          previousDecisionSection = `
## PREVIOUS AI DECISION (FEEDBACK LOOP)
Your last analysis resulted in:
- Decision: ${input.previousDecision.decision}
- Setup: ${input.previousDecision.setup}
- Reason: ${input.previousDecision.reason}

Use this to decide if the current live breakout confirms your previous bias.
`
        }

        const cleanedInput = { ...input }
        if (cleanedInput.liveContext) {
          cleanedInput.liveContext = {
            ...cleanedInput.liveContext,
            recentTicks: "[OMITTED]",
          }
        }
        if (cleanedInput.previousDecision) {
          cleanedInput.previousDecision = "[OMITTED]"
        }

        userPrompt = `Analyze market data and produce a trade decision using DUAL TIMEFRAME analysis with ORDER FLOW focus.
${liveContextSection}
${previousDecisionSection}
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
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
      ])

      const cleanedText = text
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "")
        .trim()

      try {
        const result: AISuccessResponse = JSON.parse(cleanedText)
        this.emitUpdate({
          agent: agentType,
          status: "decided",
          message: `${result.decision} signal with ${result.confidence}% confidence.`,
          data: result,
        })
        return result
      } catch (_parseError) {
        console.error("[AI] Failed to parse JSON response:", cleanedText)
        this.emitUpdate({
          agent: agentType,
          status: "error",
          message: "Failed to parse AI response.",
        })
        return
      }
    } catch (error: any) {
      console.error("[AI] Critical Error in analyzeWithAI:", error)
      this.emitUpdate({
        agent: agentType,
        status: "error",
        message: "Internal AI error during analysis.",
      })
      return
    }
  }

  public async managePositionWithAI(input: any, agentType: TradingAgentType = "SCALPER") {
    console.log(`[AI] Starting managePositionWithAI using ${agentType} agent...`)
    this.emitUpdate({
      agent: "Risk Manager",
      status: "thinking",
      message: `Evaluating risk for ${input.openPosition.symbol}...`,
    })

    let systemMessage =
      `You are a professional NSE Risk Manager. Your sole task is to manage an OPEN options position based on live technicals and OI flow.
The position was originally opened by a ${agentType} agent. You must decide whether to HOLD, EXIT, or UPDATE_SL. Respond with valid JSON only.

`
    systemMessage += POSITION_MANAGEMENT_RULES

    // Programmatic Math Injection: Inject Wave 5 target if available
    const wave5Target = input.tf15m?.waveContext?.wave5Target || input.marketData?.tf15m?.waveContext?.wave5Target
    if (wave5Target) {
      systemMessage = systemMessage.replace(
        /`Wave 5 Target = Wave 4 Low \+ \(1\.0 \* \(Wave 1 High - Wave 1 Low\)\)`/g,
        `The mathematical Wave 5 Exhaustion Target is exactly ${wave5Target.toFixed(2)}. If price enters within 5 points of this level, shift trailing stop tightly.`
      )
    }

    const userPrompt = `Evaluate the following open position against current market data:

## OPEN POSITION
${JSON.stringify(input.openPosition, null, 2)}

## CURRENT MARKET DATA
${JSON.stringify(input.marketData, null, 2)}

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
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
      ])

      const cleanedText = text
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "")
        .trim()
      const result = JSON.parse(cleanedText)

      this.emitUpdate({
        agent: "Risk Manager",
        status: "decided",
        message: `${result.decision}: ${result.reason}`,
        data: result,
      })

      return result
    } catch (error: any) {
      console.error("[AI] Error in managePositionWithAI:", error)
      this.emitUpdate({
        agent: "Risk Manager",
        status: "error",
        message: "Risk evaluation failed. Holding for safety.",
      })
      return {
        decision: "HOLD",
        reason: "AI re-evaluation failed, holding as safety fallback",
        confidence: 0,
      }
    }
  }
}
