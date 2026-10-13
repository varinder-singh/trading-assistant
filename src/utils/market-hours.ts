export function isMarketOpen(date: Date = new Date()): boolean {
  // Convert current time to IST
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    weekday: 'long',
    hour: 'numeric',
    minute: 'numeric',
  })
  const parts = formatter.formatToParts(date)

  const getValue = (type: string) => parts.find((p) => p.type === type)?.value ?? ''

  const weekday = getValue('weekday')
  if (weekday === 'Saturday' || weekday === 'Sunday') {
    return false
  }

  const hour = parseInt(getValue('hour') || '0', 10)
  const minute = parseInt(getValue('minute') || '0', 10)

  // Market hours: 09:15 AM to 03:30 PM (15:30)
  const timeInMinutes = hour * 60 + minute
  const marketOpen = 9 * 60 + 15 // 555
  const marketClose = 15 * 60 + 30 // 930

  return timeInMinutes >= marketOpen && timeInMinutes <= marketClose
}

export function getMarketStatusMessage(date: Date = new Date()): string {
  return isMarketOpen(date) ? 'Market is Open' : 'Market is Closed'
}
