export function extractJsonFromText(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  
  if (start !== -1 && end !== -1 && end >= start) {
    return text.substring(start, end + 1)
  }
  
  // Fallback to the original logic if for some reason brackets aren't found
  return text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
}
