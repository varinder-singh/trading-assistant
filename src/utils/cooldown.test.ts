import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { CooldownManager } from "./cooldown.js"

describe("CooldownManager", () => {
  let cooldownManager: CooldownManager

  beforeEach(() => {
    cooldownManager = new CooldownManager()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should set and check cooldown correctly", () => {
    expect(cooldownManager.isOnCooldown("NIFTY")).toBe(false)
    
    cooldownManager.setCooldown("NIFTY", 15)
    expect(cooldownManager.isOnCooldown("NIFTY")).toBe(true)
    
    // Advance time by 14 minutes
    vi.advanceTimersByTime(14 * 60 * 1000)
    expect(cooldownManager.isOnCooldown("NIFTY")).toBe(true)
    
    // Advance time by 2 more minutes (total 16 mins)
    vi.advanceTimersByTime(2 * 60 * 1000)
    expect(cooldownManager.isOnCooldown("NIFTY")).toBe(false)
  })

  it("should handle multiple symbols independently", () => {
    cooldownManager.setCooldown("NIFTY", 15)
    cooldownManager.setCooldown("BANKNIFTY", 30)

    expect(cooldownManager.isOnCooldown("NIFTY")).toBe(true)
    expect(cooldownManager.isOnCooldown("BANKNIFTY")).toBe(true)

    vi.advanceTimersByTime(16 * 60 * 1000)
    
    expect(cooldownManager.isOnCooldown("NIFTY")).toBe(false)
    expect(cooldownManager.isOnCooldown("BANKNIFTY")).toBe(true)
  })

  it("should clear all cooldowns", () => {
    cooldownManager.setCooldown("NIFTY", 15)
    expect(cooldownManager.isOnCooldown("NIFTY")).toBe(true)
    
    cooldownManager.clearAll()
    expect(cooldownManager.isOnCooldown("NIFTY")).toBe(false)
  })
})
