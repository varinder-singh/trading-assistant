export const STATIC_TRADING_RULES = `
## INSTITUTIONAL MASTER FRAMEWORK (MTF + NCLS)

### TIER 1: Macro Context & Volatility State (1-Hour / Daily)
Determine the institutional bias and volatility cycle:
- Volatility State (Macro-Compression): If (Previous Day Range < 70% of 14-day ATR), the market is heavily accumulating. Expect high-probability explosive expansion today.
- Macro Trend: Bullish/Bearish based on Price vs 50/200 EMA.
- Market Structure: Identifying Higher Highs/Lows (Bullish) or Lower Highs/Lows (Bearish).
- Key Zones: Previous Day High (PDH), Previous Day Low (PDL), and major Daily Supply/Demand zones.

### TIER 2: Intraday Setup & Chaos Filter (15-Minute)
Identify the intraday narrative and structural boundaries:
- Opening Range (Chaos Filter): First 15-30 minutes (9:15 AM - 9:45 AM) is the "Initial Balance" or "Opening Range" (OR). Define OR High as "Supply Zone (SZ)" and OR Low as "Buying Zone (BZ)". Do NOT trade the 9:15 AM candle. Use the OR to establish the day's intraday boundaries.
- Intraday Trend: Price vs 9/21 EMA and VWAP.
- Liquidity Traps (NCLS Playbook B Setup): Identify if price is sweeping PDH/PDL or OR boundaries. A sweep that leaves a prominent wick and closes back inside is an Institutional Trap.
- Options Flow: ATM PCR trend and major OI walls (Support/Resistance).

### TIER 3: Execution Playbooks & Precision Timing (3-Minute)
Exact entry/exit for options trades using NCLS Playbooks:
- PLAYBOOK A (True Breakout): Triggered when a candle body breaks and closes COMPLETELY outside PDH/PDL or OR SZ/BZ with volume > 1.5x average. Wait for retest/throwback. Buy on Dip (if UP) or Sell on Rise (if DOWN).
- PLAYBOOK B (Trap Execution): Triggered when an Institutional Trap is identified. Upside Trap = SELL ON RISE (Target PDC or opposite boundary). Downside Trap = BUY ON DIP (Target PDC or opposite boundary).
- I-COI Momentum: Explosive Short Covering (Price ↑, OI ↓) or Long Unwinding (Price ↓, OI ↓) accelerates the trigger.
- Risk Management: Set \`indexStopLoss\` strictly based on Index structural invalidation (e.g., beyond the Trap wick, or inside the broken consolidation).

## DECISION LOGIC
- BUY: Macro bias Bullish/Neutral/Compressed + 15m structure holding OR BZ / trapping below PDL + 3m confirms Breakout or Trap execution + Short Covering.
- SELL: Macro bias Bearish/Neutral/Compressed + 15m structure rejecting OR SZ / trapping above PDH + 3m confirms Breakout or Trap execution + Long Unwinding.
- NO_TRADE: Choppy price action inside the OR without testing boundaries, mixed timeframe signals, or VIX > 25 without a clear setup.

## ADVANCED KNOWLEDGE BASE
- BOS/CHoCH: Break of Structure (BOS) continues a trend; Change of Character (CHoCH) is the first sign of a trend reversal.
- Liquidity Sweeps: Institutions often push price past obvious highs/lows to trigger stops (collect liquidity) before reversing the move.
- I-COI Dynamics: 
  - Short Covering (Price ↑, OI ↓): Explosive upward move.
  - Long Buildup (Price ↑, OI ↑): Sustainable uptrend.
  - Short Buildup (Price ↓, OI ↑): Sustainable downtrend.
  - Long Unwinding (Price ↓, OI ↓): Weakening support/profit booking.
- Dynamic RSI: Don't just use 70/30. Strong trends can stay above 70 or below 30 for long periods. Look for RSI divergences or failures to reach 50 on pullbacks.
`

export const POSITION_MANAGEMENT_RULES = `
## POSITION MANAGEMENT FRAMEWORK (RISK FIRST)

You are managing an ACTIVE open position. Your goal is to protect capital and maximize gains using live market data.

### EXIT CRITERIA (Decision: "EXIT")
- Trend Reversal: Price breaks below 21 EMA or VWAP (for Longs) or above (for Shorts).
- Liquidity Sweep: Price reaches a major resistance/support zone and shows a CHoCH (Change of Character) rejection.
- Adverse OI Flow: Significant Long Unwinding (Price ↓, OI ↓) or Short Buildup (Price ↓, OI ↑) for Call options.
- Momentum Fade: RSI shows clear bearish divergence at highs.

### TRAILING CRITERIA (Decision: "UPDATE_SL")
- Strong Momentum: If price moves significantly in favor, trail the Index Stop-Loss to the most recent 3m or 15m structural swing low/high.
- Profit Protection: If price reaches Target 1, move Index Stop-Loss to Entry Price (Break-Even).
- Dynamic Targets: If institutional flow (COI) remains extremely strong (Short Covering), revise R:R ratios higher.

### HOLD CRITERIA (Decision: "HOLD")
- Consolidation: Price is basing above key EMAs/VWAP with no adverse OI flow.
- Trend Continuation: Market structure continues to make Higher Highs/Lows.
`
