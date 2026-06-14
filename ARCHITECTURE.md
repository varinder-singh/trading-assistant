# Trading Assistant Architecture

## Overview
The Trading Assistant is a multi-agent AI-driven system designed for automated market analysis and paper trading. It integrates technical analysis, sentiment analysis, and options data to make informed trading decisions.

## Core Components

### 1. AI Layer (`src/ai`)
- **LLM Providers**: Abstracted interfaces for Gemini and OpenAI.
- **LLM Service**: Orchestrates calls to LLMs for different tasks.
- **Agents**:
    - **Orchestrator**: Evaluates market state and selects the most appropriate agent (Scalper or Trend).
    - **Scalper Agent**: Focused on quick, short-term moves.
    - **Trend Agent**: Focused on capturing larger market trends.
    - **Risk Manager Agent**: Evaluates open positions and suggests exits or SL updates.

### 2. Analysis Layer (`src/analysis`)
- **Technical Analysis**: Calculates indicators like EMA, VWAP, RSI, ATR, and identifies support/resistance.
- **Sentiment Analysis**: Analyzes news headlines using LLMs.
- **Options Analysis**: Processes Zerodha (Kite) options chain data, calculating OI shifts and buildup states.
- **Greeks Engine**: Implements the Black-Scholes model using Newton-Raphson to dynamically compute IV, Delta, Gamma, Theta, and Vega for active strikes.
- **Reversal Scoring**: Computes a 0-5 Reversal Quality Score based on Options Defense, VWAP proximity, Volume Climax, structural levels (POC/VAH/VAL), and Institutional Flow (GTI).
- **OI Heatmap**: Generates a live, multi-strike console heatmap for visualizing open interest changes and buildup states across the chain.

### 3. Data Layer (`src/data`)
- **Yahoo Finance**: Source for historical and real-time candle data.
- **News**: Fetches market news for sentiment analysis.
- **India VIX**: Fetches volatility index data.
- **Kite (Zerodha)**: Fetches live quotes, options chains, and instrument details.

### 4. Execution Layer (`src/execution`)
- **PaperTrader**: A simulated trading engine that:
    - Restores state from the database on startup.
    - Manages active positions and orders using Delta-Adjusted Position Sizing (targeting a normalized 0.50 delta notional risk).
    - Implements risk management (Max positions, Daily limits, Cooldowns, IV Crush Protection).
    - Monitors price ticks to trigger SL and Target hits.
    - Periodically re-evaluates positions using AI, updating the live Greeks Dashboard (tracking Delta, Vega, and Theta burn).

### 5. Database Layer (`src/db`)
- **Supabase (PostgreSQL)**: Cloud persistent storage for trades, events, profiles, and analytical history.
- **Kysely**: Type-safe query builder for SQL operations against Postgres.
- **Repositories**: Encapsulated data access logic for `trades`, `trade_analytics`, `gti_scores`, and `iv_history` (used for 30-day IV Rank calculations).

### 6. Communication Layer (`src/utils`)
- **EventHub**: A centralized EventEmitter for decoupled communication between components (e.g., price updates, trade notifications).

### 7. User Interface (`web/`)
- **Nuxt Dashboard**: A web-based interface for visualizing market data, AI reasoning, and portfolio status.

## Data Flow
1. **Analysis Trigger**: The system (CLI or Watcher) triggers a market analysis.
2. **Data Fetching**: Parallel fetching of candles, news, VIX, and options data.
3. **Market Evaluation**: Technical indicators are calculated and passed to the AI Orchestrator.
4. **AI Decision**: The selected agent (Scalper/Trend) provides a trade decision (BUY/SELL/HOLD).
5. **Execution**: If a BUY signal is generated and meets confidence thresholds, `PaperTrader` opens a position.
6. **Monitoring**: `PaperTrader` monitors the position via live price ticks (via `EventHub`) and periodic AI re-evaluation.
7. **Exit**: Positions are closed based on SL/Target hits, AI exit signals, or end-of-day square-off.

## Security & Configuration
- Configuration is managed via `.env` files.
- Sensitive tokens are cached locally in `.kite/` (ignored by git).
- Database credentials securely connect to Supabase PostgreSQL.
