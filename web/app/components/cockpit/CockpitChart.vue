<template>
  <div class="flex-1 flex flex-col bg-slate-950 border-r border-slate-800">
    <!-- Top Chart Controls / Debrief Mode Switcher Bar -->
    <div class="px-4 py-2 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 bg-slate-900/40 text-xs">
      <!-- Left Title & Toggles -->
      <div class="flex items-center gap-3">
        <div data-test="chart-mode-title" class="font-bold text-slate-300 font-mono">
          {{ marketState === 'open' ? 'INTRADAY LIVE EXECUTION' : 'EOD FULL-DAY TRAJECTORY REPLAY' }}
        </div>

        <div class="flex items-center gap-1 font-mono">
          <button
            v-for="tf in ['1m', '3m', '5m', '15m']"
            :key="tf"
            data-test="timeframe-btn"
            type="button"
            @click="$emit('update:selectedTimeframe', tf)"
            class="px-2 py-0.5 rounded transition"
            :class="selectedTimeframe === tf ? 'bg-slate-800 font-bold text-indigo-400 border border-slate-700' : 'text-slate-400 hover:text-white'"
          >
            {{ tf }}
          </button>
        </div>
      </div>

      <!-- Overlays Toggle -->
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
          <input
            type="checkbox"
            :checked="overlays.ratchetBands"
            @change="$emit('update:overlays', { ...overlays, ratchetBands: !overlays.ratchetBands })"
            class="rounded border-slate-700 text-indigo-600 focus:ring-0"
          >
          <span>AI Ratchet Bands</span>
        </label>
        <label class="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
          <input
            type="checkbox"
            :checked="overlays.pocVah"
            @change="$emit('update:overlays', { ...overlays, pocVah: !overlays.pocVah })"
            class="rounded border-slate-700 text-indigo-600 focus:ring-0"
          >
          <span>Structural POC/VAH</span>
        </label>
        <label class="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
          <input
            type="checkbox"
            :checked="overlays.vwapEma"
            @change="$emit('update:overlays', { ...overlays, vwapEma: !overlays.vwapEma })"
            class="rounded border-slate-700 text-indigo-600 focus:ring-0"
          >
          <span>VWAP / EMA-9</span>
        </label>
      </div>

      <!-- Session Levels -->
      <div class="flex items-center gap-2 font-mono text-[11px] text-slate-400">
        <span>HIGH: <span class="text-slate-200">{{ high.toFixed(2) }}</span></span>
        <span>LOW: <span class="text-slate-200">{{ low.toFixed(2) }}</span></span>
        <span>POC: <span class="text-amber-400 font-bold">{{ poc.toFixed(2) }}</span></span>
      </div>
    </div>

    <!-- MAIN CANVAS CONTAINER -->
    <div class="relative flex-1 bg-slate-950 p-4 min-h-[380px] flex flex-col justify-between overflow-hidden">
      <!-- Legend Overlay in Top Left of Chart -->
      <div class="absolute top-4 left-4 z-10 bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 backdrop-blur font-mono text-xs space-y-1">
        <div v-if="overlays.pocVah" class="flex items-center gap-2">
          <span class="w-3 h-0.5 bg-amber-400 inline-block"></span>
          <span class="text-slate-400">POC (Institutional Volume):</span>
          <span class="text-amber-400 font-bold">{{ poc.toFixed(2) }}</span>
        </div>
        <div v-if="overlays.vwapEma" class="flex items-center gap-2">
          <span class="w-3 h-0.5 bg-blue-400 inline-block"></span>
          <span class="text-slate-400">Anchored VWAP:</span>
          <span class="text-blue-400">{{ vwap.toFixed(2) }}</span>
        </div>
        <div v-if="overlays.ratchetBands" class="flex items-center gap-2">
          <span class="w-3 h-0.5 bg-emerald-400 inline-block"></span>
          <span class="text-slate-400">Ratchet Locked Floor (Tier 2):</span>
          <span class="text-emerald-400 font-bold">{{ ratchetFloor.toFixed(2) }}</span>
        </div>
      </div>

      <!-- Simulated Candlestick Canvas -->
      <div class="relative w-full h-full flex items-center justify-center">
        <svg viewBox="0 0 800 320" class="w-full h-full text-slate-800 overflow-visible" preserveAspectRatio="none">
          <!-- Grid Lines -->
          <line x1="0" y1="60" x2="800" y2="60" stroke="rgba(255,255,255,0.04)" stroke-dasharray="4"/>
          <line x1="0" y1="120" x2="800" y2="120" stroke="rgba(255,255,255,0.04)" stroke-dasharray="4"/>
          <line x1="0" y1="180" x2="800" y2="180" stroke="rgba(255,255,255,0.04)" stroke-dasharray="4"/>
          <line x1="0" y1="240" x2="800" y2="240" stroke="rgba(255,255,255,0.04)" stroke-dasharray="4"/>

          <!-- Structural POC Level -->
          <line v-if="overlays.pocVah" x1="0" y1="180" x2="800" y2="180" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="6"/>

          <!-- Anchored VWAP -->
          <path v-if="overlays.vwapEma" d="M 0 230 Q 200 210, 400 190 T 800 160" fill="none" stroke="#60a5fa" stroke-width="2"/>

          <!-- Ratchet Trailing Floor Band -->
          <path v-if="overlays.ratchetBands" d="M 460 210 L 520 200 L 600 160 L 700 130 L 800 120" fill="none" stroke="#10b981" stroke-width="2" stroke-dasharray="3"/>

          <!-- Candlesticks Series -->
          <line x1="60" y1="210" x2="60" y2="255" stroke="#ef4444" stroke-width="1"/>
          <rect x="54" y="220" width="12" height="25" fill="#ef4444"/>
          <line x1="110" y1="205" x2="110" y2="245" stroke="#ef4444" stroke-width="1"/>
          <rect x="104" y="215" width="12" height="20" fill="#ef4444"/>
          <line x1="160" y1="185" x2="160" y2="260" stroke="#10b981" stroke-width="1"/>
          <rect x="154" y="190" width="12" height="20" fill="#10b981"/>
          <line x1="210" y1="175" x2="210" y2="215" stroke="#10b981" stroke-width="1"/>
          <rect x="204" y="180" width="12" height="22" fill="#10b981"/>
          <line x1="260" y1="180" x2="260" y2="210" stroke="#ef4444" stroke-width="1"/>
          <rect x="254" y="188" width="12" height="14" fill="#ef4444"/>
          <line x1="310" y1="170" x2="310" y2="200" stroke="#10b981" stroke-width="1"/>
          <rect x="304" y="172" width="12" height="18" fill="#10b981"/>
          <line x1="360" y1="155" x2="360" y2="190" stroke="#10b981" stroke-width="1"/>
          <rect x="354" y="160" width="12" height="24" fill="#10b981"/>
          
          <!-- AI ENTRY TRIGGER CANDLE -->
          <line x1="410" y1="140" x2="410" y2="180" stroke="#10b981" stroke-width="1"/>
          <rect x="404" y="145" width="12" height="28" fill="#10b981"/>

          <line x1="460" y1="130" x2="460" y2="165" stroke="#10b981" stroke-width="1"/>
          <rect x="454" y="132" width="12" height="22" fill="#10b981"/>
          <line x1="510" y1="135" x2="510" y2="160" stroke="#ef4444" stroke-width="1"/>
          <rect x="504" y="140" width="12" height="12" fill="#ef4444"/>
          <line x1="560" y1="110" x2="560" y2="148" stroke="#10b981" stroke-width="1"/>
          <rect x="554" y="115" width="12" height="28" fill="#10b981"/>
          <line x1="610" y1="95" x2="610" y2="135" stroke="#10b981" stroke-width="1"/>
          <rect x="604" y="100" width="12" height="26" fill="#10b981"/>
          <line x1="660" y1="85" x2="660" y2="120" stroke="#10b981" stroke-width="1"/>
          <rect x="654" y="90" width="12" height="22" fill="#10b981"/>
          <line x1="710" y1="75" x2="710" y2="110" stroke="#10b981" stroke-width="1"/>
          <rect x="704" y="78" width="12" height="18" fill="#10b981"/>

          <!-- AI Entry Marker Beacon -->
          <g transform="translate(410, 195)">
            <circle cx="0" cy="0" r="14" fill="rgba(99, 102, 241, 0.25)" class="animate-ping"/>
            <circle cx="0" cy="0" r="7" fill="#6366f1"/>
            <path d="M 0 -2 L -4 4 L 4 4 Z" fill="#ffffff"/>
          </g>

          <!-- Exit Marker in Closed Mode -->
          <g v-if="marketState === 'closed'" transform="translate(710, 60)">
            <circle cx="0" cy="0" r="8" fill="#10b981"/>
            <text x="0" y="3" text-anchor="middle" fill="#ffffff" font-size="9" font-weight="bold">✓</text>
          </g>
        </svg>

        <!-- Floating AI Entry Tooltip -->
        <div
          v-if="marketState === 'open'"
          data-test="chart-entry-tooltip"
          class="absolute top-[62%] left-[48%] bg-indigo-950/90 border border-indigo-500/80 rounded-lg p-2 backdrop-blur shadow-xl font-mono text-xs z-20 pointer-events-none"
        >
          <div class="text-indigo-300 font-bold flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            MAS AUTONOMOUS ENTRY: BUY CE
          </div>
          <div class="text-slate-300 text-[11px]">
            Strike: 24200 CE @ ₹142.00 | Conf: 92%
          </div>
        </div>
      </div>

      <!-- Chart Bottom Status Strip -->
      <div class="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono">
        <div class="flex items-center gap-4">
          <span>RSI(14): <span class="text-slate-200">{{ rsi }}</span></span>
          <span>ATR(1m): <span class="text-slate-200">{{ atr.toFixed(2) }}</span></span>
          <span>GTI Flow: <span class="text-emerald-400 font-bold">{{ gti }} / 100</span> (Strong Inflow)</span>
        </div>
        <div>
          {{ marketState === 'open' ? `Tick Latency: ${tickLatencyMs}ms` : 'Market Status: CLOSED (EOD DB Replay)' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    marketState?: 'open' | 'closed'
    symbol?: string
    selectedTimeframe?: string
    overlays?: { ratchetBands: boolean; pocVah: boolean; vwapEma: boolean }
    poc?: number
    vwap?: number
    ratchetFloor?: number
    high?: number
    low?: number
    rsi?: number
    atr?: number
    gti?: number
    tickLatencyMs?: number
  }>(),
  {
    marketState: 'open',
    symbol: 'NIFTY 50',
    selectedTimeframe: '3m',
    overlays: () => ({ ratchetBands: true, pocVah: true, vwapEma: true }),
    poc: 24150.0,
    vwap: 24142.15,
    ratchetFloor: 24168.0,
    high: 24210.8,
    low: 24095.1,
    rsi: 64.2,
    atr: 14.5,
    gti: 78,
    tickLatencyMs: 18,
  }
)

defineEmits<{
  (e: 'update:selectedTimeframe', tf: string): void
  (e: 'update:overlays', overlays: { ratchetBands: boolean; pocVah: boolean; vwapEma: boolean }): void
}>()
</script>
