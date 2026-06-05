# Feature: Analyzer Event Tracking

To improve transparency and facilitate backtesting audits, we will store all events triggered by the `LiveAnalyzer` (e.g., breakouts, volatility spikes) in the database. This provides a historical timeline of why the AI was invoked throughout the trading session.

## Changes

### 1. Database Schema

- Create a new migration `src/db/migrations/007_add_analyzer_events.ts` to add the `analyzer_events` table:
  - `id`: UUID (Primary Key)
  - `symbol`: string (e.g., "NIFTY")
  - `reason`: string (e.g., "Price broke Resistance")
  - `price`: real (Price at trigger time)
  - `timestamp`: text (ISO string)
  - `metadata`: text (JSON blob for extra context like recent ticks)

### 2. Database Types & Repository

- Update `src/db/database.ts` to include the `AnalyzerEventsTable` interface and add it to the `Database` type.
- Create `src/db/repositories/event-repo.ts` to handle inserting and fetching analyzer events.

### 3. Execution Handlers

- Update `web/server/routes/_ws.ts` and `src/cli/watch.ts` to persist the event to the database whenever a `breakout` is emitted by the `LiveAnalyzer`.

## Verification Plan

### Automated Tests

- Create a unit test for the new `EventRepository` to ensure events are saved and retrieved correctly.

### Manual Verification

- Start the system in watch mode.
- Trigger a volatility spike or level breakout.
- Verify that a new entry appears in the `analyzer_events` table in the database.
- Verify that the timestamp matches the event time.
