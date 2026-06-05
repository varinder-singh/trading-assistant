# Identified Bugs and Vulnerabilities

This document lists potential bugs, architectural weaknesses, and vulnerabilities in the Trading Assistant project.

## VULNERABLE

1. **Insecure API Key Handling Potential**: Although `.env` and `.kite/` are ignored in `.gitignore`, the application lacks a centralized secret management system. If the local machine is compromised, all trading keys are easily accessible in plain text.
2. **LLM Injection / Malformed Response Handling**: LLM responses are parsed and directly influence trading decisions (e.g., SL/Target levels). A malicious or hallucinated response could lead to extreme values that bypass basic sanity checks, potentially causing "infinite loops" of exits or invalid trade parameters.

## MAJOR

1. **Race Condition in PaperTrader Initialization**: `PaperTrader.initialize()` is called asynchronously. If multiple trade orders are placed simultaneously before the first initialization completes, it could lead to duplicate state restoration or inconsistent position tracking.
2. **Ambiguous Trade Closure Logic**: In `PaperTrader.updatePosition` (SELL side), the system finds the "most recent open trade" for a symbol to close in the database. If multiple trades for the same symbol are open (due to DB sync issues or manual edits), it might close the wrong record, leading to data corruption in trade history.
3. **Redundant DB Reads on Order Placement**: Every call to `placeOrder` triggers `await this.initialize()`. While it has a guard, this architectural pattern is inefficient and risks performance degradation under high activity.
4. **Timezone-Dependent Market Logic**: The use of `new Date().toLocaleTimeString("en-IN", ...)` for market square-off and closing logic is brittle. It depends on the system's locale and timezone settings being correctly configured for Asia/Kolkata, which might fail on cloud servers or different environments.
5. **Brittle SL/Target Validation**: The logic to "invalidate" SL if it's higher than entry for a BUY might result in trades running without any safety net if the AI provides incorrect levels.

## MINOR

1. **Hardcoded Lot Sizes**: Lot sizes for NIFTY (65) and BANKNIFTY (15) are hardcoded in `PaperTrader.ts`. These values are subject to change by the exchange and should be configurable or dynamic.
2. **Inconsistent Confidence Normalization**: `runAnalysis` handles confidence on both 0.0-1.0 and 0-100 scales, but this normalization is scattered. A centralized `AIUtility` class should handle such transformations.
3. **Lack of Detailed Ticker Error Handling**: If the price ticker (via `EventHub`) fails, the `PaperTrader` will stop receiving price updates, and automated SL/Target hits will be delayed until the next 3-minute AI evaluation cycle.
4. **Log Verbosity**: Some logs are very verbose and could clutter the console during high-frequency price updates, potentially masking more critical errors.
5. **Path Resolution Complexity**: `src/data/kite.ts` uses complex path resolution logic to find `access-token.json`, which might fail in certain deployment scenarios (e.g., containerized environments).
