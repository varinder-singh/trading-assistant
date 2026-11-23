/**
 * Institutional LLM JSON Sanitizer & Normalizer
 *
 * LLM responses commonly contain JavaScript quirks that violate standard RFC 8259 JSON:
 * 1. undefined keyword (e.g. "suggestedLimitPrice": undefined) -> null
 * 2. NaN, +Infinity, -Infinity -> null
 * 3. Trailing commas before closing braces/brackets (e.g. [1, 2,] or {"a": 1,})
 * 4. Single-line and multi-line comments
 * 5. Unescaped control characters inside string literals
 * 6. Markdown code blocks
 *
 * This sanitizer performs string-safe tokenization so that valid occurrences of
 * "undefined", comments, or trailing commas inside legitimate string values are never mutated.
 */

export function extractJsonBlock(raw: string): string {
  const text = String(raw || '').trim()
  if (!text) return ''

  // 1. Strip markdown fences if present
  const fenced = text
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim()

  if ((fenced.startsWith('{') && fenced.endsWith('}')) || (fenced.startsWith('[') && fenced.endsWith(']'))) {
    return fenced
  }

  // 2. Fallback: extract substring between first '{' and last '}'
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  const firstBracket = text.indexOf('[')
  const lastBracket = text.lastIndexOf(']')

  const hasBraces = firstBrace !== -1 && lastBrace > firstBrace
  const hasBrackets = firstBracket !== -1 && lastBracket > firstBracket

  if (hasBraces && (!hasBrackets || firstBrace < firstBracket)) {
    return text.substring(firstBrace, lastBrace + 1).trim()
  } else if (hasBrackets) {
    return text.substring(firstBracket, lastBracket + 1).trim()
  }

  return text
}

export function cleanAndSanitizeJson(raw: string): string {
  const extracted = extractJsonBlock(raw)
  if (!extracted) return ''

  // Step 1: Extract and preserve all quoted string literals.
  // We replace them with placeholder tokens so that internal string contents
  // (which might contain the word "undefined" or "//" or trailing commas) are never touched.
  const stringLiterals: string[] = []
  const PLACEHOLDER_PREFIX = '___JSON_SAN_TOKEN_'

  const tokenized = extracted.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
    // Normalize unescaped newlines, carriage returns, and tabs within string values
    const normalized = match
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
    const token = `${PLACEHOLDER_PREFIX}${stringLiterals.length}___`
    stringLiterals.push(normalized)
    return token
  })

  // Step 2: Apply structural cleanup on JSON syntax outside string literals
  let cleaned = tokenized
    // Strip single-line comments // ...
    .replace(/\/\/[^\n\r]*/g, '')
    // Strip block comments /* ... */
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Convert unquoted JS undefined to JSON null
    .replace(/\bundefined\b/g, 'null')
    // Convert unquoted JS NaN to JSON null
    .replace(/(?:[+-]\s*)?NaN\b/g, 'null')
    // Convert unquoted JS +/-Infinity to JSON null
    .replace(/(?:[+-]\s*)?Infinity\b/g, 'null')
    // Strip trailing commas before closing curly braces or square brackets
    .replace(/,\s*([}\]])/g, '$1')

  // Step 3: Restore string literals
  cleaned = cleaned.replace(new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)___`, 'g'), (_, indexStr) => {
    const idx = Number(indexStr)
    return stringLiterals[idx] ?? '""'
  })

  return cleaned.trim()
}

export function safeJsonParse<T = any>(raw: string, fallback: T = {} as T, logContext?: string): T {
  const cleaned = cleanAndSanitizeJson(raw)
  if (!cleaned) return fallback
  try {
    return JSON.parse(cleaned) as T
  } catch (error) {
    if (logContext) {
      console.warn(`[${logContext}] JSON parse error: ${(error as Error).message}. Raw response was:`, raw)
    }
    return fallback
  }
}
