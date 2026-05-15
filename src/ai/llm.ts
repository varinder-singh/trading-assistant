import { getLLMProvider } from "./factory.js";

export async function analyzeWithAI(input: any) {
  let prompt = ""
  let systemMessage = "You are a professional NSE options trader and technical analyst specializing in NIFTY intraday and swing trades. You produce precise, actionable trade plans based on technical indicators, options flow data, and market sentiment. You always respond with valid JSON only — no markdown, no prose, no code fences."

  if (input.prompt) {
    prompt = input.prompt
  } else {
    let liveContextSection = ""
    if (input.liveContext) {
      liveContextSection = `
## REAL-TIME WEBSOCKET CONTEXT (TRULY LIVE)
- Trigger Reason: ${input.liveContext.reason}
- Last Price: ${input.liveContext.tick.last_price}
- Momentum: ${input.liveContext.reason.includes('Volatility') ? 'High Volatility detected' : 'Price Action driven'}
- Recent Ticks (last 60s): ${JSON.stringify(input.liveContext.recentTicks.map((t: any) => t.last_price))}

NOTE: This real-time data is from a live WebSocket. It takes PRECEDENCE over the 5m/15m historical candles if there is a sharp divergence or breakout happening RIGHT NOW.
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
- Entry: ${input.previousDecision.entry}
- Stop Loss: ${input.previousDecision.stopLoss}

Use this context to decide if the current live breakout confirms your previous bias or if a trend reversal is occurring.
`
    }

    // Strip massive arrays from input before stringifying to avoid token limits
    const cleanedInput = { ...input }
    if (cleanedInput.liveContext) {
      cleanedInput.liveContext = { ...cleanedInput.liveContext, recentTicks: "[OMITTED FOR BREVITY - SEE LIVE CONTEXT SECTION ABOVE]" }
    }
    if (cleanedInput.previousDecision) {
      cleanedInput.previousDecision = "[OMITTED - SEE PREVIOUS AI DECISION SECTION ABOVE]"
    }

    prompt = `Analyze the market data below and produce a trade decision using DUAL TIMEFRAME analysis.
${liveContextSection}
${previousDecisionSection}
## TIMEFRAME STRATEGY
- 15-Minute (tf15m): Trend confirmation and directional bias
- 5-Minute (tf5m): Entry precision and exact levels
- Use 15m for DIRECTION, 5m for ENTRY TIMING

## Step 1 — Trend Confirmation (15-Minute)
Assess the primary direction from 15-min data:
- Price vs VWAP (15m): Bullish / Bearish / Neutral
- Trend (15m): Bullish / Bearish / Sideways
- RSI (15m): Overbought / Oversold / Neutral
- Options flow (ATM PCR): Bullish / Bearish / Neutral
  - pcrAtm > 1.2 = bearish (more puts = hedging), pcrAtm < 0.8 = bullish (more calls), 0.8–1.2 = neutral
- India VIX (Volatility): Low / Normal / High / Extreme
  - VIX < 12 (Low): Expect range-bound or slow moves; breakouts may lack follow-through.
  - VIX 12-20 (Normal): Standard rules apply.
  - VIX > 20 (High/Extreme): High volatility; increase stop-loss width, reduce position size, expect sharp reversals.
- Sentiment: Positive / Negative / Neutral

## Step 2 — Direction Confirmation (15-Minute)
Require ≥3 of 6 signals to align for a clear direction:
- BUY: 15m trend bullish, price above VWAP, near 15m support, pcrAtm bullish, VIX not extreme, positive/neutral sentiment
- SELL: 15m trend bearish, price below VWAP, near 15m resistance, pcrAtm bearish, negative/neutral sentiment
- NO_TRADE: mixed signals, RSI extreme without confirmation, sideways trend, or VIX > 25 (Extreme) without clear trend.

## Step 3 — Entry Precision (5-Minute)
If direction is confirmed in Step 2, use 5m data for exact entry/exit:
- Entry: Breakout of 5m resistance (for BUY) or breakdown of 5m support (for SELL)
- Stop Loss: Beyond 5m opposing level with margin
- Targets: Use 5m resistance/support for quick profits
- Risk-Reward: Minimum 1.5 for intraday (5m moves fast, use tight stops)

## RSI rules
- RSI > 70: avoid fresh BUY; SHORT_SELL only on clear rejection + 3+ signals
- RSI < 30: avoid fresh SHORT_SELL; BUY only on bounce + 3+ signals
- RSI 40–60 without confirmed direction: NO_TRADE

## Market Data
${JSON.stringify(cleanedInput, null, 2)}

## Required Output (JSON only — no other text, no code fences)
{
  "decision": "BUY" or "SELL" or "NO_TRADE",
  "setup": "LONG_BUY" or "SHORT_SELL" or "NONE",
  "instrument": "UNDERLYING" or "FUTURES" or "OPTIONS" or "NONE",
  "optionAction": "BUY_CE" or "BUY_PE" or "NONE",
  "strike": <number or null>,
  "reason": "<2-3 sentences citing the key signals that drove this decision>",
  "confidence": <0.0 to 1.0>,
  "entry": <number or null>,
  "stopLoss": <number or null>,
  "targets": [<number>, <number>],
  "riskReward": <number or null>
}
`
  }

  if (input.systemPrompt) {
    systemMessage = input.systemPrompt
  }

  let text = "{}"

  try {
    const provider = getLLMProvider();
    text = await provider.chat([
      { role: "system", content: systemMessage },
      { role: "user", content: prompt },
    ]);

    // Strip markdown code fences if present
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  } catch (error: any) {
    console.error(`⚠️ AI request failed with provider: ${process.env.LLM_PROVIDER || 'gemini'}`, {
      error: error.message || error,
    })
    return { decision: "NO_TRADE", reason: "AI request error", confidence: 0 }
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("⚠️ Failed to parse AI response", {
      error,
      response: text,
    })
    return { decision: "NO_TRADE", reason: "Parsing error", confidence: 0 }
  }
}
