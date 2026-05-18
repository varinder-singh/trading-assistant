import { EventEmitter } from "node:events";
import type { TradeOrder, PaperPosition, TradeResponse, OrderSide, OrderType } from "./types.js";

export class PaperTrader extends EventEmitter {
  private positions: Map<string, PaperPosition> = new Map();
  private orders: TradeOrder[] = [];

  constructor() {
    super();
  }

  async placeOrder(params: {
    symbol: string;
    token: number;
    side: OrderSide;
    quantity: number;
    price: number;
  }): Promise<TradeResponse> {
    const orderId = `paper_${Math.random().toString(36).substr(2, 9)}`;
    
    const order: TradeOrder = {
      id: orderId,
      symbol: params.symbol,
      token: params.token,
      side: params.side,
      quantity: params.quantity,
      price: params.price,
      type: "MARKET",
      status: "COMPLETE",
      timestamp: new Date(),
    };

    this.orders.push(order);
    this.updatePosition(order);

    console.log(`📝 [PAPER TRADE] ${order.side} ${order.quantity}x ${order.symbol} @ ${order.price}`);
    
    this.emit("order_update", order);
    this.emit("portfolio_update", this.getAllPositions());

    return { success: true, orderId };
  }

  private updatePosition(order: TradeOrder) {
    const existing = this.positions.get(order.symbol);

    if (order.side === "BUY") {
      if (existing) {
        const totalQty = existing.quantity + order.quantity;
        const totalCost = (existing.avgEntryPrice * existing.quantity) + (order.price! * order.quantity);
        existing.avgEntryPrice = totalCost / totalQty;
        existing.quantity = totalQty;
      } else {
        this.positions.set(order.symbol, {
          symbol: order.symbol,
          token: order.token,
          side: "BUY",
          quantity: order.quantity,
          avgEntryPrice: order.price!,
          currentPrice: order.price!,
          unrealizedPnL: 0,
          realizedPnL: 0,
          timestamp: new Date(),
        });
      }
    } else {
      // Simple SELL logic: Close position
      if (existing) {
        const pnl = (order.price! - existing.avgEntryPrice) * order.quantity;
        existing.realizedPnL += pnl;
        existing.quantity -= order.quantity;
        if (existing.quantity <= 0) {
          this.positions.delete(order.symbol);
        }
      }
    }
  }

  updatePrice(token: number, price: number) {
    let changed = false;
    for (const [symbol, pos] of this.positions) {
      if (pos.token === token) {
        pos.currentPrice = price;
        pos.unrealizedPnL = (price - pos.avgEntryPrice) * pos.quantity;
        changed = true;
      }
    }
    if (changed) {
      this.emit("pnl_update", this.getAllPositions());
    }
  }

  getAllPositions(): PaperPosition[] {
    return Array.from(this.positions.values());
  }

  getOrders(): TradeOrder[] {
    return this.orders;
  }
}

// Singleton for easy access across the app
export const paperTrader = new PaperTrader();
