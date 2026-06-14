export function isMarketOpen(date: Date = new Date()): boolean {
  // Convert current time to IST
  const options = { timeZone: "Asia/Kolkata", hour12: false }
  const formatter = new Intl.DateTimeFormat("en-US", {
    ...options,
    weekday: "long",
    hour: "numeric",
    minute: "numeric",
  })
  const parts = formatter.formatToParts(date)

  let weekday = ""
  let hour = 0
  let minute = 0

  for (const part of parts) {
    if (part.type === "weekday") weekday = part.value
    if (part.type === "hour") hour = parseInt(part.value, 10)
    if (part.type === "minute") minute = parseInt(part.value, 10)
  }

  // Check weekends
  if (weekday === "Saturday" || weekday === "Sunday") {
    return false
  }

  // Market hours: 09:15 AM to 03:30 PM (15:30)
  const timeInMinutes = hour * 60 + minute
  const marketOpen = 9 * 60 + 15 // 555
  const marketClose = 15 * 60 + 30 // 930

  return timeInMinutes >= marketOpen && timeInMinutes < marketClose
}

export function getMarketStatusMessage(date: Date = new Date()): string {
  if (isMarketOpen(date)) {
    return "Market is Open"
  }
  return "Market is Closed"
}
