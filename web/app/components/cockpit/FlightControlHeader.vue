<template>
  <header class="bg-slate-900/90 backdrop-blur border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30">
    <div class="flex items-center gap-4">
      <!-- App Brand & Pulse -->
      <div class="flex items-center gap-2.5 pr-3 border-r border-slate-800">
        <div class="relative flex h-3 w-3">
          <span
            v-if="marketState === 'open'"
            class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
          ></span>
          <span
            class="relative inline-flex rounded-full h-3 w-3"
            :class="marketState === 'open' ? 'bg-emerald-500' : 'bg-indigo-400'"
          ></span>
        </div>
        <div class="leading-tight">
          <div class="font-bold text-sm tracking-wide text-white flex items-center gap-1.5">
            AEGIS <span class="text-xs px-1.5 py-0.2 bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 rounded font-mono">MAS-V2</span>
          </div>
          <div class="text-xs text-slate-400">Autonomous Trading Cockpit</div>
        </div>
      </div>

      <!-- Asset Symbol & Price Ticker -->
      <div class="flex items-center gap-3 bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-700/60">
        <div class="flex items-center gap-2">
          <span class="font-mono font-bold text-sm text-white">{{ symbol }}</span>
          <span class="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded font-mono">INDEX</span>
        </div>
        <div class="flex items-baseline gap-2 font-mono">
          <span
            class="text-base font-bold"
            :class="(priceChange || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
          >
            {{ livePrice ? livePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '24,185.40' }}
          </span>
          <span
            class="text-xs font-medium"
            :class="(priceChange || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
          >
            {{ (priceChange || 0) >= 0 ? '+' : '' }}{{ priceChange ? priceChange.toFixed(2) : '+112.30' }}
            ({{ (priceChangePct || 0) >= 0 ? '+' : '' }}{{ priceChangePct ? priceChangePct.toFixed(2) : '+0.47' }}%)
          </span>
        </div>
      </div>

      <!-- Market State Indicator & Toggle -->
      <div class="flex items-center gap-1.5 bg-slate-800/90 p-1 rounded-lg border border-slate-700 text-xs font-mono">
        <span class="text-slate-400 pl-1 text-[11px] font-bold">STATE:</span>
        <button
          data-test="state-open-btn"
          type="button"
          @click="$emit('update:marketState', 'open')"
          class="px-2.5 py-1 rounded transition flex items-center gap-1"
          :class="marketState === 'open' ? 'font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm' : 'font-medium text-slate-400 hover:text-white'"
        >
          <span v-if="marketState === 'open'" class="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          MARKET OPEN
        </button>
        <button
          data-test="state-closed-btn"
          type="button"
          @click="$emit('update:marketState', 'closed')"
          class="px-2.5 py-1 rounded transition flex items-center gap-1"
          :class="marketState === 'closed' ? 'font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm' : 'font-medium text-slate-400 hover:text-white'"
        >
          <span>🌙</span>
          MARKET CLOSED (DEBRIEF)
        </button>
      </div>

      <!-- Regime / Market Hours Badge -->
      <div class="hidden xl:flex items-center gap-2 px-3 py-1.5 bg-blue-950/40 border border-blue-800/40 rounded-lg text-xs">
        <span class="text-slate-400">Regime:</span>
        <span class="font-bold text-blue-400 uppercase tracking-wide">{{ regime || 'Bullish Trend Expansion' }}</span>
        <span class="text-slate-400 border-l border-slate-700 pl-2">VIX: <span class="font-mono text-slate-200">{{ vix || '13.24' }}</span></span>
      </div>
    </div>

    <!-- Right Controls: Autonomy Mode & Risk Telemetry -->
    <div class="flex items-center gap-3">
      <!-- Flight Autonomy Mode Pill -->
      <div class="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-xs">
        <button
          data-test="mode-auto-btn"
          type="button"
          @click="$emit('update:flightMode', 'auto')"
          class="px-3 py-1 rounded transition"
          :class="flightMode === 'auto' ? 'font-semibold bg-emerald-600 text-white shadow-sm flex items-center gap-1.5' : 'font-medium text-slate-300 hover:text-white'"
        >
          <span v-if="flightMode === 'auto'" class="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
          AUTONOMOUS
        </button>
        <button
          data-test="mode-supervised-btn"
          type="button"
          @click="$emit('update:flightMode', 'supervised')"
          class="px-3 py-1 rounded transition"
          :class="flightMode === 'supervised' ? 'font-semibold bg-blue-600 text-white shadow-sm' : 'font-medium text-slate-300 hover:text-white'"
        >
          SUPERVISED
        </button>
        <button
          data-test="mode-halt-btn"
          type="button"
          @click="$emit('update:flightMode', 'halt')"
          class="px-3 py-1 rounded transition"
          :class="flightMode === 'halt' ? 'font-semibold bg-rose-600 text-white shadow-sm' : 'font-medium text-slate-300 hover:text-white'"
        >
          PAUSED
        </button>
      </div>

      <!-- Daily PnL Telemetry -->
      <div class="bg-slate-800/80 border border-slate-700 px-3 py-1 rounded-lg text-right font-mono">
        <div class="text-[11px] text-slate-400 leading-none">
          {{ marketState === 'open' ? "TODAY'S P&L (NET)" : 'FINAL REALIZED NET' }}
        </div>
        <div
          class="text-sm font-bold leading-tight"
          :class="dailyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'"
        >
          {{ dailyPnl >= 0 ? '+' : '' }}₹{{ dailyPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 }) }}
        </div>
      </div>

      <!-- Action Button: Emergency Square Off or Auth Token Status -->
      <div>
        <button
          v-if="marketState === 'open'"
          data-test="panic-btn"
          type="button"
          @click="$emit('panicSquareOff')"
          class="px-3 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-700/70 text-rose-200 hover:text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95"
        >
          <svg class="w-3.5 h-3.5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          SQUARE OFF ALL
        </button>
        <button
          v-else
          data-test="token-status-btn"
          type="button"
          class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 rounded-lg text-xs font-mono font-medium transition flex items-center gap-1.5"
        >
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          KITE AUTH: VALID ({{ tokenExpiryHours || 7 }}h)
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    symbol?: string
    livePrice?: number | null
    priceChange?: number | null
    priceChangePct?: number | null
    marketState?: 'open' | 'closed'
    flightMode?: 'auto' | 'supervised' | 'halt'
    dailyPnl?: number
    regime?: string
    vix?: number
    tokenExpiryHours?: number
  }>(),
  {
    symbol: 'NIFTY 50',
    livePrice: 24185.4,
    priceChange: 112.3,
    priceChangePct: 0.47,
    marketState: 'open',
    flightMode: 'auto',
    dailyPnl: 4850,
    regime: 'Bullish Trend Expansion',
    vix: 13.24,
    tokenExpiryHours: 7,
  }
)

defineEmits<{
  (e: 'update:flightMode', mode: 'auto' | 'supervised' | 'halt'): void
  (e: 'update:marketState', state: 'open' | 'closed'): void
  (e: 'panicSquareOff'): void
  (e: 'symbolChange', symbol: string): void
}>()
</script>
