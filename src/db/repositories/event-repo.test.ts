import { describe, it, expect, beforeEach } from "vitest"
import { eventRepo } from "./event-repo.js"
import { db } from "../database.js"
import { sql } from "kysely"

describe("EventRepository", () => {
  beforeEach(async () => {
    // Clean up before each test
    await sql`DELETE FROM market_events`.execute(db)
  })

  it("should save and retrieve an event", async () => {
    const event = {
      symbol: "NIFTY",
      reason: "Breakout",
      price: 18000,
      timestamp: new Date().toISOString(),
      metadata: { type: "resistance" },
    }

    await eventRepo.saveEvent(event)

    const recent = await eventRepo.getRecentEvents("NIFTY")
    expect(recent.length).toBe(1)
    const first = recent[0]!
    expect(first.symbol).toBe("NIFTY")
    expect(first.reason).toBe("Breakout")
    expect(Number(first.price)).toBe(18000)
    expect(first.metadata).toEqual(event.metadata)
  })

  it("should return events in descending order of timestamp", async () => {
    const now = new Date()
    const e1 = {
      symbol: "NIFTY",
      reason: "R1",
      price: 18000,
      timestamp: new Date(now.getTime() - 1000).toISOString(),
    }
    const e2 = {
      symbol: "NIFTY",
      reason: "R2",
      price: 18100,
      timestamp: now.toISOString(),
    }

    await eventRepo.saveEvent(e1)
    await eventRepo.saveEvent(e2)

    const recent = await eventRepo.getRecentEvents("NIFTY")
    expect(recent.length).toBe(2)
    expect(recent[0]!.reason).toBe("R2")
    expect(recent[1]!.reason).toBe("R1")
  })
})
