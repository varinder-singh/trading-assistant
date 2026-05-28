import "dotenv/config"
import { GoogleGenerativeAI } from "@google/generative-ai"

async function testGemini(modelName: string) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing")
    return
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  console.log(`Testing model: ${modelName}`)

  try {
    const model = genAI.getGenerativeModel({ model: modelName })
    const result = await model.generateContent("Say hello")
    const response = await result.response
    console.log(`Success with ${modelName}:`, response.text())
  } catch (error: any) {
    console.error(`Error with ${modelName}:`, error.message || error)
  }
}

async function run() {
  await testGemini("gemini-2.5-flash-lite")
  console.log("---")
  await testGemini("gemini-2.0-flash")
  console.log("---")
  await testGemini("gemini-1.5-flash")
}

run()
