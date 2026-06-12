export class CooldownManager {
  private cooldowns: Map<string, number> = new Map()

  /**
   * Sets a cooldown for a given symbol.
   * @param symbol The ticker symbol (e.g., "NIFTY")
   * @param minutes Duration of the cooldown in minutes
   */
  setCooldown(symbol: string, minutes: number = 15): void {
    const expiresAt = Date.now() + minutes * 60 * 1000
    this.cooldowns.set(symbol, expiresAt)
    console.log(`[CooldownManager] ${symbol} placed on cooldown for ${minutes} minutes.`)
  }

  /**
   * Checks if a symbol is currently on cooldown.
   * @param symbol The ticker symbol
   * @returns true if on cooldown, false otherwise
   */
  isOnCooldown(symbol: string): boolean {
    const expiresAt = this.cooldowns.get(symbol)
    if (!expiresAt) return false

    if (Date.now() > expiresAt) {
      this.cooldowns.delete(symbol)
      return false
    }

    return true
  }

  /**
   * Clears all active cooldowns. Useful for testing or daily resets.
   */
  clearAll(): void {
    this.cooldowns.clear()
  }
}

export const cooldownManager = new CooldownManager()
