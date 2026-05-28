import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { getLLMProvider } from "./factory.js"
import { GeminiProvider } from "./providers/gemini.js"
import { OpenAIProvider } from "./providers/openai.js"

describe("getLLMProvider factory", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.GEMINI_API_KEY
    delete process.env.AZURE_OPENAI_API_KEY
    delete process.env.LLM_PROVIDER
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("should default to Gemini even if no keys are present", () => {
    const provider = getLLMProvider()
    expect(provider).toBeInstanceOf(GeminiProvider)
    expect(provider.name).toBe("gemini")
  })

  it("should pick Gemini if GEMINI_API_KEY is present", () => {
    process.env.GEMINI_API_KEY = "mock-key"
    const provider = getLLMProvider()
    expect(provider).toBeInstanceOf(GeminiProvider)
  })

  it("should pick OpenAI if only AZURE_OPENAI_API_KEY is present", () => {
    process.env.AZURE_OPENAI_API_KEY = "mock-key"
    const provider = getLLMProvider()
    expect(provider).toBeInstanceOf(OpenAIProvider)
  })

  it("should prioritize Gemini if both keys are present", () => {
    process.env.GEMINI_API_KEY = "mock-gemini"
    process.env.AZURE_OPENAI_API_KEY = "mock-openai"
    const provider = getLLMProvider()
    expect(provider).toBeInstanceOf(GeminiProvider)
  })

  it("should honor explicit LLM_PROVIDER override", () => {
    process.env.GEMINI_API_KEY = "mock-gemini"
    process.env.LLM_PROVIDER = "openai"
    const provider = getLLMProvider()
    expect(provider).toBeInstanceOf(OpenAIProvider)
  })
})
