export class CooldownManager {
  private cooldowns: Map<string, number> = new Map()

  public isOnCooldown(symbol: string): boolean {
    const expiry = this.cooldowns.get(symbol)
    if (!expiry) return false

    const isExpired = Date.now() > expiry
    if (isExpired) {
      this.cooldowns.delete(symbol)
    }
    return !isExpired
  }

  public setCooldown(symbol: string, minutes: number): void {
    const expiry = Date.now() + minutes * 60 * 1000
    this.cooldowns.set(symbol, expiry)
  }
}

export const cooldownManager = new CooldownManager()
