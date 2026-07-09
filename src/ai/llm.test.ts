import { describe, it, expect } from 'vitest'
import { cleanJson } from './llm.js'

describe('cleanJson', () => {
  it('should clean markdown json code blocks', () => {
    const raw = '```json\n{\n  "test": "value"\n}\n```'
    const cleaned = cleanJson(raw)
    expect(cleaned).toBe('{\n  "test": "value"\n}')
  })

  it('should escape raw newlines inside double-quoted string values', () => {
    const raw = '{\n  "reason": "This is line 1.\nThis is line 2."\n}'
    const cleaned = cleanJson(raw)
    const parsed = JSON.parse(cleaned)
    expect(parsed.reason).toBe('This is line 1.\nThis is line 2.')
  })
})
