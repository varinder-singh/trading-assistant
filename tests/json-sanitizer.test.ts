import { describe, it, expect } from 'vitest'
import { cleanAndSanitizeJson, safeJsonParse, extractJsonBlock } from '../src/utils/json-sanitizer.js'

describe('JSON Sanitizer & Normalizer', () => {
  it('extracts JSON from markdown code fences', () => {
    const raw = '```json\n{"status": "ok"}\n```'
    expect(extractJsonBlock(raw)).toBe('{"status": "ok"}')
  })

  it('extracts JSON when surrounded by commentary', () => {
    const raw = 'Here is the response:\n{"result": 42}\nHope this helps!'
    expect(extractJsonBlock(raw)).toBe('{"result": 42}')
  })

  it('correctly converts unquoted undefined to null', () => {
    const raw = `{
      "requirePullbackLimit": false,
      "suggestedLimitPrice": undefined,
      "minDeltaRequired": undefined,
      "tightenedIndexStopLoss": undefined
    }`
    const parsed = safeJsonParse(raw)
    expect(parsed).toEqual({
      requirePullbackLimit: false,
      suggestedLimitPrice: null,
      minDeltaRequired: null,
      tightenedIndexStopLoss: null,
    })
  })

  it('does NOT alter the word "undefined" when inside legitimate string values', () => {
    const raw = `{
      "thesis": "The signal state is undefined due to missing data",
      "flag": undefined,
      "comment": "undefined variable test"
    }`
    const parsed = safeJsonParse(raw)
    expect(parsed.thesis).toBe('The signal state is undefined due to missing data')
    expect(parsed.flag).toBeNull()
    expect(parsed.comment).toBe('undefined variable test')
  })

  it('correctly parses the exact DialecticCouncilAgent failure payload from Cloud Logging', () => {
    const raw = `{
      "consensusReached": false,
      "consensusBias": "NO_TRADE",
      "consensusOptionAction": "NONE",
      "confidence": 55,
      "resolutionRationale": "The council could not reach a consensus due to irreconcilable conflicts between the neutral structure and bullish options signals. The Adversarial Critic highlighted that the options flow might be a trap, given the consolidating structure and potential for aggressive put writing to be defensive rather than bullish.",
      "executionDirectives": {
        "requirePullbackLimit": false,
        "suggestedLimitPrice": undefined,
        "minDeltaRequired": undefined,
        "tightenedIndexStopLoss": undefined,
        "mandatoryConditions": [
          "Assess if the put writing pressure (ATM PCR) is accompanied by increasing open interest in puts, which would confirm bearish positioning rather than just premium selling.",
          "Cross-reference the RSI on the 5m timeframe with the actual ground truth to confirm the 41.98 value and its implications.",
          "Verify if the 'short covering' in OTM CE strikes is indeed covering of short positions or if it's related to selling of OTM calls."
        ]
      },
      "speeches": [
        {
          "agentName": "Structure Specialist",
          "role": "PROPOSAL",
          "thesis": "NIFTY is in a Wave 4 consolidation on the 5m timeframe with a neutral RSI.",
          "citedEvidence": ["Structure Claim: Wave 4 consolidation"],
          "recommendedAction": "NONE"
        }
      ]
    }`
    const parsed = safeJsonParse(raw, {} as any, 'DialecticCouncilAgentTest')
    expect(parsed).not.toBeNull()
    expect(parsed.consensusReached).toBe(false)
    expect(parsed.consensusBias).toBe('NO_TRADE')
    expect(parsed.confidence).toBe(55)
    expect(parsed.executionDirectives.suggestedLimitPrice).toBeNull()
    expect(parsed.executionDirectives.minDeltaRequired).toBeNull()
    expect(parsed.executionDirectives.tightenedIndexStopLoss).toBeNull()
    expect(parsed.executionDirectives.mandatoryConditions).toHaveLength(3)
    expect(parsed.speeches).toHaveLength(1)
  })

  it('handles NaN and Infinity outside strings', () => {
    const raw = `{
      "score": NaN,
      "maxVal": Infinity,
      "minVal": -Infinity,
      "note": "NaN is not a number"
    }`
    const parsed = safeJsonParse(raw)
    expect(parsed).toEqual({
      score: null,
      maxVal: null,
      minVal: null,
      note: 'NaN is not a number',
    })
  })

  it('removes trailing commas before closing braces and brackets', () => {
    const raw = `{
      "items": [1, 2, 3, ],
      "nested": {
        "key": "val",
      },
    }`
    const parsed = safeJsonParse(raw)
    expect(parsed).toEqual({
      items: [1, 2, 3],
      nested: { key: 'val' },
    })
  })

  it('removes single-line and multi-line comments while preserving comments inside strings', () => {
    const raw = `{
      // This is a line comment
      "active": true,
      /* This is a block comment */
      "url": "https://example.com/api?param=//not-a-comment",
      "desc": "Contains /* comment */ inside string"
    }`
    const parsed = safeJsonParse(raw)
    expect(parsed.active).toBe(true)
    expect(parsed.url).toBe('https://example.com/api?param=//not-a-comment')
    expect(parsed.desc).toBe('Contains /* comment */ inside string')
  })

  it('handles unescaped newlines and tabs inside strings', () => {
    const raw = '{"multiline": "line 1\nline 2\ttabbed"}'
    const parsed = safeJsonParse(raw)
    expect(parsed.multiline).toBe('line 1\nline 2\ttabbed')
  })

  it('returns fallback gracefully on completely unparseable input', () => {
    const raw = 'This is completely garbage text without any JSON'
    const fallback = { fallbackUsed: true }
    const result = safeJsonParse(raw, fallback, 'TestContext')
    expect(result).toBe(fallback)
  })
})
