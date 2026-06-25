# Project Rules

## LLM Payload Optimization Rule

When preparing large JSON payloads (such as market data, ticks, options chains, or historical state) to be sent to Gemini or any other LLM, ALWAYS apply **Downsampling, Truncation, Stripping, and Compression** to optimize token usage without arbitrarily removing context:

1. **Downsampling**: Uniformly sample high-frequency data (like ticks) to a small, representative array (e.g., 10-15 evenly spaced data points) rather than sending thousands of raw data points.
2. **Truncation**: Slice long historical arrays (like swings, patterns, or trends) to keep only the most recent `N` elements that define the current context.
3. **Stripping**: Actively delete heavy raw components (e.g., raw OHLC candles) from the payload if only computed states or indicators are actually needed.
4. **Compression**: Extract only essential summary fields from nested or historical decision blocks instead of passing deeply nested recursive states.

## Always Apply Deep Fixes

When addressing issues, performance problems, or bugs:
- **Do not** provide shallow fixes (e.g., merely hiding errors, silencing logs, or abruptly omitting required data just to bypass a limit).
- **Go deep** to understand the architectural cause of the problem.
- Provide a proper, comprehensive fix that elegantly solves the root problem without compromising the integrity, contextual awareness, or functionality of the system.
