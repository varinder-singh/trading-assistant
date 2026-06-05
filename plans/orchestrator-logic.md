# Implementation Plan: Orchestrator Agent Logic

## Background & Motivation

The current trading system utilizes a monolithic LLM prompt that attempts to handle all market conditions. This often results in conflicting decisions—specifically, the tight risk-management logic designed for choppy markets prematurely exits high-reward trades during "Trend Days."

To resolve this, we are transitioning to a Multi-Agent Architecture. The cornerstone of this new architecture is the **Orchestrator Agent**. The Orchestrator does not execute trades; instead, it acts as a "traffic cop," analyzing macro conditions and determining which specialized trading agent (Scalper or Trend) should have control over the current market state.

## Objective

Implement the logic and framework for the Orchestrator Agent to dynamically switch between the default "Scalper/Base" strategy and the new "Trend/Squeeze" strategy based on specific environmental catalysts.

## Key Files & Context

- `src/ai/prompts.ts`: Will house the new `ORCHESTRATOR_PROMPT`.
- `src/ai/llm.ts`: Needs a new function (e.g., `evaluateMarketState()`) to run the Orchestrator check before delegating to the specific trading agent.
- `src/ai/types.ts`: Define the expected JSON output format for the Orchestrator (e.g., `{ activeAgent: "SCALPER" | "TREND", confidence: number, rationale: string }`).

## Proposed Logic & Triggers

The Orchestrator will evaluate the following data points to make its decision:

### 1. Time-of-Day Windows

Certain times of the day are historically prone to massive institutional directional moves (the 50-300 point rallies).

- **Opening Drive / Initial Balance Break (09:45 AM - 10:30 AM):** High probability of trend establishment.
- **European Open / PM Session (01:30 PM - 02:30 PM):** High probability of squeeze and trend continuation.
- **Dead Zone (11:30 AM - 01:00 PM):** High probability of chop/mean reversion. **Scalper Agent Default.**

### 2. Volatility and Macro Context

- **Compression Breakout:** If the previous day was highly compressed (Range < 70% of 14-day ATR) and today opens with a gap or strong momentum, bias shifts heavily toward the **Trend Agent**.
- **VIX Levels:** Spikes in VIX alongside structural breaks favor the Trend Agent.

### 3. Options Flow & Gamma Squeeze Potential

- **OI Clusters:** If the index is approaching a massive Call or Put Open Interest wall and shows signs of _absorbing_ selling pressure (price bases near the wall instead of rejecting instantly), the Orchestrator anticipates a forced liquidation (squeeze).
- **Trigger:** Heavy Short Covering (Price ↑, Call OI ↓) detected near key levels activates the **Trend Agent** to capture the ensuing violent move.

### 4. Heavyweight Component Alignment

- If the index is breaking out, but top heavyweights (e.g., HDFC, Reliance) are flat or divergent, it is likely a trap.
- **Trigger:** Only authorize the **Trend Agent** if the top 3 heavyweights are confirming the structural breakout.

## Handoff Mechanism

The Orchestrator's primary function is state management:

1. **Default State:** `SCALPER`.
2. **Evaluation:** Every 15 minutes (or upon major structural breach alerts), the Orchestrator evaluates the macro context.
3. **State Change:** If conditions align (e.g., 1:30 PM + Break of PDH + Short Covering), the Orchestrator issues a state change to `TREND`.
4. **Active Trade Management:** If the Scalper is currently holding a trade when a state change to `TREND` occurs, the trade management parameters (targets, trailing stops) are handed over to the Trend Agent to maximize the run.

## Implementation Steps

1. **Define Types:** Update `src/ai/types.ts` to include the `MarketState` and Orchestrator response interfaces.
2. **Draft Prompts:** Create the `ORCHESTRATOR_PROMPT` in `src/ai/prompts.ts` incorporating the logic outlined above.
3. **Build Orchestrator Loop:** Modify `src/ai/llm.ts` to include an `evaluateMarketState()` function that calls the LLM with the Orchestrator prompt.
4. **Integration:** Integrate this state check into the main execution loop (`src/analysis/trade.ts`) to dictate which agent's rules are applied to entry and management.

## Verification

- Mock various market conditions (choppy midday, explosive PM breakout, tight opening range) and run unit tests to ensure the Orchestrator correctly selects `SCALPER` or `TREND`.
- Log the Orchestrator's rationale heavily during live testing to ensure its decision-making aligns with the defined rules.
