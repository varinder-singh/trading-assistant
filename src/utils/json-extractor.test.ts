import { describe, it, expect } from "vitest"
import { extractJsonFromText } from "./json-extractor.js"

describe("extractJsonFromText", () => {
  it("should extract JSON correctly when there is conversational padding", () => {
    const text = `Here is my analysis:
    
    \`\`\`json
    {
      "decision": "BUY",
      "confidence": 90
    }
    \`\`\`
    
    Hope this helps!`
    
    const result = extractJsonFromText(text)
    const parsed = JSON.parse(result)
    
    expect(parsed.decision).toBe("BUY")
    expect(parsed.confidence).toBe(90)
  })

  it("should extract JSON correctly with no padding", () => {
    const text = `{"key": "value"}`
    const result = extractJsonFromText(text)
    const parsed = JSON.parse(result)
    expect(parsed.key).toBe("value")
  })

  it("should handle nested JSON correctly", () => {
    const text = `Wait let me think...
    {
      "outer": {
        "inner": [1, 2, 3]
      }
    }
    Done.`
    const result = extractJsonFromText(text)
    const parsed = JSON.parse(result)
    expect(parsed.outer.inner).toEqual([1, 2, 3])
  })

  it("should fallback to string replacement if no brackets exist (though technically invalid json)", () => {
    const text = `\`\`\`json
    "just a string"
    \`\`\``
    const result = extractJsonFromText(text)
    // In this edge case, it strips the code fences
    expect(result.trim()).toBe('"just a string"')
  })
})
