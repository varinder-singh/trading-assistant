import { getLLMProvider } from "./src/ai/factory.js"

async function testFactory() {
  console.log("--- Testing LLM Provider Factory ---")

  // Case 1: No keys, no override
  delete process.env.GEMINI_API_KEY
  delete process.env.AZURE_OPENAI_API_KEY
  delete process.env.LLM_PROVIDER
  try {
    const provider = getLLMProvider()
    console.log("1. No keys/No override:", provider.name)
  } catch (e: any) {
    console.log("1. No keys/No override correctly threw:", e.message)
  }

  // Case 2: Gemini key present
  process.env.GEMINI_API_KEY = "mock-gemini-key"
  const provider2 = getLLMProvider()
  console.log("2. Gemini key present:", provider2.name)

  // Case 3: Both keys present, should pick Gemini
  process.env.AZURE_OPENAI_API_KEY = "mock-openai-key"
  const provider3 = getLLMProvider()
  console.log("3. Both keys present (Gemini first):", provider3.name)

  // Case 4: Explicit override to OpenAI
  process.env.LLM_PROVIDER = "openai"
  const provider4 = getLLMProvider()
  console.log("4. Explicit override to OpenAI:", provider4.name)

  // Case 5: Missing Gemini, have OpenAI
  delete process.env.GEMINI_API_KEY
  delete process.env.LLM_PROVIDER
  const provider5 = getLLMProvider()
  console.log("5. Missing Gemini, have OpenAI:", provider5.name)
}

testFactory()
