import { getLLMProvider } from "./factory.js";

const STATIC_TRADING_RULES = `
## HYBRID MULTI-TIMEFRAME FRAMEWORK

### TIER 1: Macro & Structural Context (1-Hour / Daily)
Determine the dominant institutional bias:
- Macro Trend: Bullish/Bearish based on Price vs 50/200 EMA.
- Market Structure: Identifying Higher Highs/Lows (Bullish) or Lower Highs/Lows (Bearish).
- Key Zones: Previous Day High (PDH), Previous Day Low (PDL), and major Daily Supply/Demand zones.
- Macro RSI: Checking for overall momentum strength or exhaustion.

### TIER 2: Intermediate Intraday Setup (15-Minute)
Identify the intraday narrative and actionable levels:
- Intraday Trend: Price vs 9/21 EMA and VWAP.
- Structural Shifts: Look for BOS (Break of Structure) or CHoCH (Change of Character).
- Liquidity: Identify if price is sweeping PDH/PDL or 15m swing highs/lows before a reversal.
- Options Flow: ATM PCR trend and major OI walls (Support/Resistance).

### TIER 3: Execution & Precision Timing (3-Minute)
Exact entry/exit for options trades (minimizing noise while maintaining speed):
- The Trigger: Break and Retest of 15m levels, or explosive I-COI (Interval Change in OI).
- Momentum: Price closing strongly past VWAP or 9 EMA with volume expansion.
- Invalidation: Place stops just beyond the immediate 3m local structure (BOS/CHoCH).

## DECISION LOGIC
- BUY: Macro bias Bullish/Neutral + 15m structure holding above 21 EMA/VWAP + 3m shows momentum expansion/Short Covering.
- SELL: Macro bias Bearish/Neutral + 15m structure rejecting below VWAP/21 EMA + 3m shows momentum breakdown/Long Unwinding.
- NO_TRADE: Mixed signals between 1H and 15m, price chopping in a range (40-60 RSI), or high VIX (>25) without clear direction.

## ADVANCED KNOWLEDGE BASE
- BOS/CHoCH: Break of Structure (BOS) continues a trend; Change of Character (CHoCH) is the first sign of a trend reversal.
- Liquidity Sweeps: Institutions often push price past obvious highs/lows to trigger stops (collect liquidity) before reversing the move.
- I-COI Dynamics: 
  - Short Covering (Price ↑, OI ↓): Explosive upward move.
  - Long Buildup (Price ↑, OI ↑): Sustainable uptrend.
  - Short Buildup (Price ↓, OI ↑): Sustainable downtrend.
  - Long Unwinding (Price ↓, OI ↓): Weakening support/profit booking.
- Dynamic RSI: Don't just use 70/30. Strong trends can stay above 70 or below 30 for long periods. Look for RSI divergences or failures to reach 50 on pullbacks.
`

export async function analyzeWithAI(input: any) {
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
  "setup": "LONG_BUY" or "SHORT_SELL" or "NONE",
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

const POSITION_MANAGEMENT_RULES = `
## POSITION MANAGEMENT FRAMEWORK (RISK FIRST)

You are managing an ACTIVE open position. Your goal is to protect capital and maximize gains using live market data.

### EXIT CRITERIA (Decision: "EXIT")
- Trend Reversal: Price breaks below 21 EMA or VWAP (for Longs) or above (for Shorts).
- Liquidity Sweep: Price reaches a major resistance/support zone and shows a CHoCH (Change of Character) rejection.
- Adverse OI Flow: Significant Long Unwinding (Price ↓, OI ↓) or Short Buildup (Price ↓, OI ↑) for Call options.
- Momentum Fade: RSI shows clear bearish divergence at highs.

### TRAILING CRITERIA (Decision: "UPDATE_SL")
- Strong Momentum: If price moves significantly in favor, trail the Index Stop-Loss to the most recent 3m or 15m structural swing low/high.
- Profit Protection: If price reaches Target 1, move Index Stop-Loss to Entry Price (Break-Even).
- Dynamic Targets: If institutional flow (COI) remains extremely strong (Short Covering), revise R:R ratios higher.

### HOLD CRITERIA (Decision: "HOLD")
- Consolidation: Price is basing above key EMAs/VWAP with no adverse OI flow.
- Trend Continuation: Market structure continues to make Higher Highs/Lows.
`

export async function managePositionWithAI(input: any) {
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

