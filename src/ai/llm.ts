import { createRequire } from "module"
const require = createRequire(import.meta.url)
const OpenAI = require("openai").default

const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? "https://delta-codex-us-2-poc.services.ai.azure.com/openai/v1").replace(/\/+$/, "")
// const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.5"
const deploymentName = "gpt-5.5"

const client = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: endpoint,
})

export async function analyzeWithAI(input: any) {
  let prompt = ""
  let systemMessage = "You are a professional NSE options trader and technical analyst specializing in NIFTY intraday and swing trades. You produce precise, actionable trade plans based on technical indicators, options flow data, and market sentiment. You always respond with valid JSON only — no markdown, no prose, no code fences."

  if (input.prompt) {
    prompt = input.prompt
  }
  else {
    prompt = `Analyze the market data below and produce a trade decision using DUAL TIMEFRAME analysis.

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
- Sentiment: Positive / Negative / Neutral

## Step 2 — Direction Confirmation (15-Minute)
Require ≥3 of 5 signals to align for a clear direction:
- BUY: 15m trend bullish, price above VWAP, near 15m support, pcrAtm bullish, positive/neutral sentiment
- SELL: 15m trend bearish, price below VWAP, near 15m resistance, pcrAtm bearish, negative/neutral sentiment
- NO_TRADE: mixed signals, RSI extreme without confirmation, sideways trend

## Step 3 — Entry Precision (5-Minute)
If direction is confirmed in Step 2, use 5m data for exact entry/exit:
- Entry: Breakout of 5m resistance (for BUY) or breakdown of 5m support (for SELL)
- Stop Loss: Beyond 5m opposing level with margin
- Targets: Use 5m resistance/support for quick profits
- Risk-Reward: Minimum 1.5 for intraday (5m moves fast, use tight stops)

## Mode Rules
- intraday: Use 5m entries for quick exits (scalp profits before theta decay)
- swing: Can hold 5m breakouts longer, wider stops acceptable

## Mode rules
- intraday: tighter stops (0.3–0.5% of price), require ≥4/5 signals
- swing: wider stops (1–2%), use daily trend as primary signal

## RSI rules
- RSI > 70: avoid fresh BUY; SHORT_SELL only on clear rejection + 3+ signals
- RSI < 30: avoid fresh SHORT_SELL; BUY only on bounce + 3+ signals
- RSI 40–60 without confirmed direction: NO_TRADE

## Market Data
${JSON.stringify(input, null, 2)}

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
    const response = await client.chat.completions.create({
      model: deploymentName,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt },
      ]
    })

    text = response.choices[0]?.message.content || "{}"
    // Strip markdown code fences if present
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  } catch (error) {
    console.error("⚠️ AI request failed", {
      error,
      endpoint,
      deploymentName,
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

