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
            {{ livePrice !== null && livePrice !== undefined ? livePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—' }}
          </span>
          <span
            v-if="priceChange !== null && priceChange !== undefined"
            class="text-xs font-medium"
            :class="(priceChange || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
          >
            {{ (priceChange || 0) >= 0 ? '+' : '' }}{{ priceChange.toFixed(2) }}
            ({{ (priceChangePct || 0) >= 0 ? '+' : '' }}{{ (priceChangePct || 0).toFixed(2) }}%)
          </span>
        </div>
      </div>

      <!-- Active Trade Pill (if any position open) -->
      <div
        v-if="positions && positions.length > 0"
        data-test="header-active-position-pill"
        class="flex items-center gap-2.5 bg-indigo-950/90 border border-indigo-500/60 px-3 py-1.5 rounded-lg shadow-sm"
      >
        <span class="relative flex h-2.5 w-2.5">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>
        <div class="flex items-center gap-2 font-mono text-xs">
          <span class="font-bold text-white">{{ positions[0].symbol }}</span>
          <span class="text-slate-300">
            {{ positions[0].quantity }}x @ ₹{{ Number(positions[0].avgEntryPrice || positions[0].buyPrice || 0).toFixed(2) }}
          </span>
          <span
            class="font-bold"
            :class="(positions[0].unrealizedPnL || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
          >
            {{ (positions[0].unrealizedPnL || 0) >= 0 ? '+' : '' }}₹{{ Number(positions[0].unrealizedPnL || 0).toFixed(2) }}
          </span>
          <span
            v-if="positions[0].t1Hit"
            class="px-1.5 py-0.2 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-[10px] font-bold"
          >
            T1 LOCKED 🥇 (SL ₹{{ Number(positions[0].trailingSlLocked || positions[0].aiStopLoss || 0).toFixed(2) }})
          </span>
          <span
            v-else-if="positions[0].trailingSlLocked || positions[0].aiStopLoss"
            class="text-[10px] text-slate-400"
          >
            SL: ₹{{ Number(positions[0].trailingSlLocked || positions[0].aiStopLoss).toFixed(2) }}
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
        <span class="font-bold text-blue-400 uppercase tracking-wide">{{ regime || 'EVALUATING' }}</span>
        <span v-if="vix" class="text-slate-400 border-l border-slate-700 pl-2">VIX: <span class="font-mono text-slate-200">{{ vix.toFixed(2) }}</span></span>
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
          {{ marketState === 'open' ? "TODAY'S P&L (NET)" : 'TODAY REALIZED NET' }}
        </div>
        <div
          class="text-sm font-bold leading-tight"
          :class="(dailyPnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
        >
          {{ (dailyPnl || 0) >= 0 ? '+' : '' }}₹{{ (dailyPnl || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }) }}
        </div>
      </div>

      <!-- Action Button: Emergency Square Off, Kite Token Refresh, Settings -->
      <div class="flex items-center gap-2">
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

        <!-- Zerodha Kite Token Refresh Button -->
        <a
          href="/api/auth/kite/login"
          data-test="token-status-btn"
          class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-600 text-slate-300 rounded-lg text-xs font-mono font-medium transition flex items-center gap-1.5 cursor-pointer shadow-sm"
          title="Login to Zerodha & Refresh Daily Kite Session Token"
        >
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>KITE AUTH: ACTIVE (REFRESH)</span>
          <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </a>

        <!-- Settings & Broker Connections Link -->
        <a
          href="/profile"
          class="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition flex items-center justify-center"
          title="Settings & Broker Connections"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </a>
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
    vix?: number | null
    tokenExpiryHours?: number
    positions?: any[]
  }>(),
  {
    symbol: 'NIFTY',
    livePrice: null,
    priceChange: null,
    priceChangePct: null,
    marketState: 'closed',
    flightMode: 'auto',
    dailyPnl: 0,
    regime: '',
    vix: null,
    tokenExpiryHours: 7,
    positions: () => [],
  }
)

defineEmits<{
  (e: 'update:flightMode', mode: 'auto' | 'supervised' | 'halt'): void
  (e: 'update:marketState', state: 'open' | 'closed'): void
  (e: 'panicSquareOff'): void
  (e: 'symbolChange', symbol: string): void
}>()
</script>
