export function isMarketOpen(): boolean {
  const now = new Date()

  // Convert current time to IST string
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  const istDate = new Date(istString)

  const day = istDate.getDay()
  // Closed on weekends (0 = Sunday, 6 = Saturday)
  if (day === 0 || day === 6) return false

  const hours = istDate.getHours()
  const minutes = istDate.getMinutes()

  const totalMinutes = hours * 60 + minutes
  const marketStart = 9 * 60 + 15 // 09:15
  const marketEnd = 15 * 60 + 30 // 15:30

  return totalMinutes >= marketStart && totalMinutes <= marketEnd
}
