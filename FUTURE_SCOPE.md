# Future Scope & Multi-Agent Enhancements

This document outlines proposed ideas for improving the Trading Assistant's multi-agent architecture and overall capabilities.

## Multi-Agent Setup Improvements

### 1. Collaborative Decision Making (Ensemble Agents) [IMPLEMENTED]
- **Current**: Multiple agents (Technical Agent, Options Agent) provide independent assessments. A **Consensus Agent** aggregates these into a final trade signal.
- **Benefits**: Reduces single-agent bias and improves validation of technical setups against order flow.

### 2. Specialized Risk Management Agent [IMPLEMENTED]
- **Current**: A dedicated agent ("Guardian") that monitors open positions and manages trailing stops based on real-time volatility, wave maturity, and news.
- **Benefits**: Better capital preservation and optimized exits during wave exhaustion.

### 3. Memory-Augmented Agents (RAG-lite) [IMPLEMENTED]
- **Current**: Uses a `MemoryService` to query past trade outcomes from SQLite based on market context (Trend, VIX). Agents use these lessons to avoid repeating past mistakes.
- **Future**: Upgrade to a Vector Database (like Pinecone or local Chroma) for semantic search across all historical data points.

### 4. Self-Correction Loop (Backtesting Agent)
- **Future**: An agent that automatically runs backtests on different prompt versions and technical parameters, optimizing the system's "personality" over time without human intervention.

## Architectural Enhancements

### 1. Real-Time WebSocket Integration [IMPLEMENTED]
- **Current**: Replaced periodic polling (e.g., for Yahoo candles) with real-time WebSockets from Zerodha/Kite for both underlying and option premiums. Uses in-memory `CandleBuilder` for sub-second execution accuracy and multi-timeframe (1m, 3m, 15m, 30m) analysis.

### 2. Microservices Refactoring
- **Future**: Separate the Data Fetcher, AI Service, and Execution Engine into distinct microservices (e.g., using Docker and a message broker like RabbitMQ or Redis). This would allow for better scaling and fault tolerance.

### 3. Advanced Risk Controls
- **Future**: Implement "Circuit Breakers" at the system level—automatically halting all trading if certain drawdown limits are hit or if the India VIX spikes beyond a predefined threshold.

### 4. Multi-Strategy Portfolio Management
- **Future**: Allow the system to run multiple strategies simultaneously (e.g., an Intraday Scalping strategy and a Swing Trading strategy) with independent capital allocation and risk management.

### 5. Automated Journaling & Review
- **Future**: Use LLMs to generate a "Daily Post-Market Report" that summarizes all trades, the rationale behind them, and lessons learned, automatically saving this to a `JOURNAL.md` or a web dashboard.
