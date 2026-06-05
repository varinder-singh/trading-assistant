import { describe, it, expect } from "vitest"
import { setVixDataSentiment } from "./vix.js"

describe("setVixDataSentiment", () => {
  it("should return 'low' when VIX is less than 12", () => {
    expect(setVixDataSentiment(10)).toBe("low")
    expect(setVixDataSentiment(11.9)).toBe("low")
  })

  it("should return 'normal' when VIX is between 12 and 20", () => {
    expect(setVixDataSentiment(12)).toBe("normal")
    expect(setVixDataSentiment(15)).toBe("normal")
    expect(setVixDataSentiment(20)).toBe("normal")
  })

  it("should return 'high' when VIX is between 20 and 25", () => {
    expect(setVixDataSentiment(20.1)).toBe("high")
    expect(setVixDataSentiment(22)).toBe("high")
    expect(setVixDataSentiment(25)).toBe("high")
  })

  it("should return 'extreme' when VIX is greater than 25", () => {
    expect(setVixDataSentiment(25.1)).toBe("extreme")
    expect(setVixDataSentiment(30)).toBe("extreme")
  })
})
