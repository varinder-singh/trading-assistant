# 🚀 AI Trading Assistant

A sophisticated, autonomous trading assistant designed for the Indian markets (NIFTY & BANKNIFTY). It combines real-time technical analysis, sentiment tracking, and LLM-powered decision making with a robust paper-trading execution engine and a modern web dashboard.

## 🌟 Key Features

### 🤖 AI-Driven Strategy
- **Dual Timeframe Analysis**: Combines 15-minute trend bias with 5-minute entry precision.
- **LLM Brain**: Uses Google Gemini/OpenAI to synthesize technicals, option flow (PCR), VIX, and news sentiment into actionable trade plans.
- **Smart Money Concepts**: Focuses on institutional levels, VWAP, and volume-weighted average price.

### ⚡ Live Execution & Monitoring
- **Real-time Breakout Detection**: Continuously monitors live WebSocket ticks from Kite Connect.
- **Automated Paper Trading**: Executes trades based on AI signals with automatic position tracking.
- **Autonomous Exit Management**:
    - **Take Profit**: Automatically books profit when AI targets are reached.
    - **Stop-Loss**: Protects capital with automated SL execution.
    - **Market Square-Off**: Automatically closes all intraday positions at 3:25 PM IST.
    - **Graceful Shutdown**: Stops all watchers at 3:30 PM IST when market hours end.

### 📊 Modern Dashboard (Nuxt 3)
- **Live Price Charting**: High-performance "Lightweight Charts" for real-time price action.
- **AI Decision Panel**: Detailed breakdown of AI rationale, confidence levels, and entry/exit targets.
- **Trade History**: Persistent database of all paper trades with PnL tracking and original AI context.
- **Real-time Toast Notifications**: Instant UI alerts for breakouts, trade entries, and automated exits.

## 🛠 Tech Stack
- **Backend**: Node.js, TypeScript, Commander (CLI), Kysely (SQL Builder), SQLite.
- **Frontend**: Nuxt 3, Vue 3, Tailwind CSS, Lucide Icons.
- **Broker Integration**: Kite Connect API (Zerodha).
- **AI**: Google Generative AI (Gemini) / OpenAI.

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18+)
- Kite Connect API Key & Secret

### 2. Configuration
Create a `.env` file in the root directory:
```env
KITE_API_KEY=your_api_key
KITE_API_SECRET=your_api_secret
GEMINI_API_KEY=your_gemini_key
```

### 3. Installation
```bash
npm install
cd web && npm install
```

### 4. Database Setup
```bash
npm run db:migrate
```

### 5. Running the Assistant
- **Generate Kite Token**: `npm run kite:token`
- **CLI Watch Mode**: `npm run trade <symbol> watch`
- **Dashboard**: `npm run dashboard:dev`

## 📁 Project Structure
- `src/ai/`: LLM provider logic and prompt engineering.
- `src/analysis/`: Technical analysis engines and live breakout detectors.
- `src/data/`: Data fetching from Kite, Yahoo Finance, and News APIs.
- `src/db/`: Database schema, migrations, and repositories.
- `src/execution/`: Paper trading engine and order management.
- `web/`: Nuxt 3 frontend application.

## ⚖️ Disclaimer
This project is for **educational and paper trading purposes only**. Trading in financial markets involves significant risk. Always perform your own research before making financial decisions.
