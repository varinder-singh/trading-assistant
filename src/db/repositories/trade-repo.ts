import { db } from "../database.js";
import type { PaperTradesTable } from "../database.js";
import { randomUUID } from "node:crypto";

export type NewPaperTrade = Omit<PaperTradesTable, "id" | "opened_at" | "closed_at" | "exit_price" | "pnl" | "status">;

export class TradeRepository {
  async insertTrade(trade: NewPaperTrade) {
    const id = randomUUID();
    const openedAt = new Date().toISOString();

    await db
      .insertInto("paper_trades")
      .values({
        ...trade,
        id,
        opened_at: openedAt,
        status: "OPEN",
        exit_price: null,
        pnl: null,
        closed_at: null,
      })
      .execute();

    return id;
  }

  async closeTrade(id: string, exitPrice: number) {
    const closedAt = new Date().toISOString();
    
    // Fetch the trade to calculate PnL
    const trade = await db
      .selectFrom("paper_trades")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    if (!trade) {
      throw new Error(`Trade with ID ${id} not found`);
    }

    const pnl = (exitPrice - trade.entry_price) * trade.quantity;

    await db
      .updateTable("paper_trades")
      .set({
        exit_price: exitPrice,
        pnl: pnl,
        status: "CLOSED",
        closed_at: closedAt,
      })
      .where("id", "=", id)
      .execute();
  }

  async getOpenTrades() {
    return await db
      .selectFrom("paper_trades")
      .selectAll()
      .where("status", "=", "OPEN")
      .execute();
  }

  async getAllTrades() {
    return await db
      .selectFrom("paper_trades")
      .selectAll()
      .orderBy("opened_at", "desc")
      .execute();
  }
}

export const tradeRepo = new TradeRepository();
