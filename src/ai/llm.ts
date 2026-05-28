import { getLLMProvider } from "./factory.js";
import { STATIC_TRADING_RULES, POSITION_MANAGEMENT_RULES } from "./prompts.js";

export class LLMService {
  public async analyzeWithAI(input: any) {
    console.log("[AI] Starting analyzeWithAI...");
    let userPrompt = ""
    let systemMessage = "You are a professional NSE options trader and technical analyst specializing in NIFTY intraday and swing trades. You produce precise, actionable trade plans based on technical indicators, options flow data (OI/COI), and market sentiment. You always respond with valid JSON only."
    systemMessage += STATIC_TRADING_RULES

    try {
      if (input.prompt) {
        userPrompt = input.prompt
      } else {
        let liveContextSection = ""
        if (input.liveContext) {
          const oiInsights = input.optionsAnalysisZerodha?.windowStats 
            ? `\n- OI Window Insights (${input.optionsAnalysisZerodha.windowStats.intervalMins}m): Top Short Covering: ${input.optionsAnalysisZerodha.windowStats.topShortCovering.map((r:any) => r.symbol).join(', ')}`
            : "";

          liveContextSection = `
## REAL-TIME WEBSOCKET CONTEXT (TRULY LIVE)
- Trigger Reason: ${input.liveContext.reason}
- Last Price: ${input.liveContext.tick.last_price}${oiInsights}
- Momentum: ${input.liveContext.reason.includes('Volatility') ? 'High Volatility detected' : 'Price Action driven'}
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
          cleanedInput.liveContext = { ...cleanedInput.liveContext, recentTicks: "[OMITTED]" }
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
  "confidence": <0.0 to 1.0>,
  "indexStopLoss": <number - ACTUAL INDEX LEVEL FOR INVALIDATION>,
  "riskRewardRatio": <number - e.g. 1.5 or 2.0>,
  "riskReward": <number or null>
}

IMPORTANT: Do NOT attempt to guess the option premium price. Identify the structural support/resistance on the INDEX chart (Tier 1/Tier 2) and use that as the indexStopLoss.
`
      }

      if (input.systemPrompt) {
        systemMessage = input.systemPrompt
      }

      const provider = getLLMProvider();
      const text = await provider.chat([
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
      ]);

      const cleanedText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

      try {
        return JSON.parse(cleanedText)
      } catch (parseError) {
        console.error("[AI] Failed to parse JSON response:", cleanedText);
        return { decision: "NO_TRADE", reason: "Parsing error", confidence: 0 }
      }
    } catch (error: any) {
      console.error("[AI] Critical Error in analyzeWithAI:", error);
      return { decision: "NO_TRADE", reason: "Internal AI error", confidence: 0 }
    }
  }

  public async managePositionWithAI(input: any) {
    console.log("[AI] Starting managePositionWithAI...");
    const systemMessage = "You are a professional NSE Risk Manager. Your sole task is to manage an OPEN options position based on live technicals and OI flow. You must decide whether to HOLD, EXIT, or UPDATE_SL. Respond with valid JSON only." + POSITION_MANAGEMENT_RULES;

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
  "confidence": <0.0 to 1.0>
}
`;
    try {
      const provider = getLLMProvider();
      const text = await provider.chat([
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
      ]);

      const cleanedText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(cleanedText);
    } catch (error: any) {
      console.error("[AI] Error in managePositionWithAI:", error);
      return { decision: "HOLD", reason: "AI re-evaluation failed, holding as safety fallback", confidence: 0 };
    }
  }
}
