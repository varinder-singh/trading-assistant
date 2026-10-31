export class GTITracker {
  setMarketContext(_token: number, _vwap: number, _atr: number, _flow: any) {
    // Dummy implementation
  }

  getCurrentScore(_token: number) {
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
  }

  getHistory(_token: number) {
    return []
  }

  onCandleClose(token: number, _candle: any) {
    return this.getCurrentScore(token)
  }

  addTick(_tick: any) {
    // Dummy
  }
}

export const gtiTracker = new GTITracker()
