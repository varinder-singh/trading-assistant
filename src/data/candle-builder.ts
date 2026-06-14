import { EventEmitter } from "node:events"

export class CandleBuilder extends EventEmitter {
  private candles: Map<number, Map<number, any[]>> = new Map()

  isSeeded(token: number): boolean {
    return true
  }

  seed(token: number, timeframe: number, candles: any[]) {
    // Dummy
  }

  addTick(tick: any) {
    // Dummy
  }

  getCandles(token: number, timeframe: number): any[] {
    return []
  }
}

export const candleBuilder = new CandleBuilder()
