import { analyzeWithAI } from "../ai/llm.js"

export async function analyzeSentiment(headlines: string[]) {
  if (headlines.length === 0) {
    return { sentiment: "neutral", confidence: 0.5, reason: "No headlines available" }
  }

  const systemPrompt = "You are a financial news sentiment analyst specializing in Indian equity markets (NSE/BSE). You assess the directional market impact of news on index-level sentiment and respond with valid JSON only — no markdown, no prose."

  const prompt = `Assess the overall market sentiment for Indian equities based on these news headlines.

Focus on:
- Macro impact (RBI, Fed, GDP, inflation, geopolitics)
- Index-level implications — positive = bullish for NIFTY, negative = bearish
- Ignore company-specific news unless it has index-level impact

Headlines:
${headlines.join("\n")}

Required Output (JSON only — no code fences):
{
  "sentiment": "positive" or "negative" or "neutral",
  "confidence": <0.0 to 1.0>,
  "reason": "<1-2 sentences citing the key headline(s) that drove the assessment>"
}
`

  const result = await analyzeWithAI({ prompt, systemPrompt })

  return result
}
