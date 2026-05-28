import { GeminiProvider } from "./providers/gemini.js"
import { OpenAIProvider } from "./providers/openai.js"
import type { LLMProvider } from "./types.js"

export function getLLMProvider(): LLMProvider {
  // 1. Explicit override if needed
  const override = process.env.LLM_PROVIDER
  if (override === "openai") return new OpenAIProvider()
  if (override === "gemini") return new GeminiProvider()

  // 2. Auto-detection based on keys
  if (process.env.GEMINI_API_KEY) {
    return new GeminiProvider()
  }

  if (process.env.AZURE_OPENAI_API_KEY) {
    return new OpenAIProvider()
  }

  // 3. Default fallback
  return new GeminiProvider()
}
