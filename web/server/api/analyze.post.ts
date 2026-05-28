import { runAnalysis } from "@core/analysis/trade.js"

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { symbol, mode } = body

  if (!symbol) {
    throw createError({
      statusCode: 400,
      statusMessage: "Symbol is required",
    })
  }

  try {
    const result = await runAnalysis(symbol, mode || "intraday")
    return result
  } catch (error: any) {
    console.error("Analysis API Error:", error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || "Analysis failed",
    })
  }
})
