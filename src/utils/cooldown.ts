export class CooldownManager {
  private cooldowns: Map<string, number> = new Map()

  isOnCooldown(symbol: string): boolean {
    const expiry = this.cooldowns.get(symbol)
    if (!expiry) return false
    if (Date.now() > expiry) {
      this.cooldowns.delete(symbol)
      return false
    }
    return true
  }

  setCooldown(symbol: string, minutes: number) {
    const expiry = Date.now() + minutes * 60 * 1000
    this.cooldowns.set(symbol, expiry)
  }
}

export const cooldownManager = new CooldownManager()
