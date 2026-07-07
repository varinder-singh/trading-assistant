export const gtiTracker = {
  setMarketContext(token: number, vwap: number, atr: number, flow: any) {
    // Dummy implementation
  },
  getCurrentScore(token: number) {
    return {
      composite: 0,
      classification: 'NEUTRAL',
      confidence: 0,
      components: {
        volumeAnomaly: 0,
        cvd: 0,
        vwapDeviation: 0,
        oiSignal: 0,
        smartMoneyFlow: 0,
      },
    }
  },
  getHistory(token: number) {
    return []
  },
  onCandleClose(token: number, candle: any) {
    return this.getCurrentScore(token)
  },
  addTick(tick: any) {
    // Dummy
  },
}
