<template>
  <aside class="w-full lg:w-[440px] bg-slate-900 flex flex-col border-t lg:border-t-0 border-slate-800 h-full">
    <!-- Right Panel Tab Navigation -->
    <div class="flex items-center border-b border-slate-800 bg-slate-900 text-xs">
      <button
        data-test="tab-primary-btn"
        type="button"
        @click="$emit('update:activeTab', 'primary')"
        class="flex-1 py-2.5 font-bold text-center border-b-2 transition"
        :class="activeTab === 'primary' ? 'border-indigo-500 text-indigo-400 bg-slate-800/40' : 'border-transparent text-slate-400 hover:text-slate-200'"
      >
        Agent Council (MAS)
      </button>
      <button
        data-test="tab-secondary-btn"
        type="button"
        @click="$emit('update:activeTab', 'secondary')"
        class="flex-1 py-2.5 font-medium text-center border-b-2 transition"
        :class="activeTab === 'secondary' ? 'border-indigo-500 text-indigo-400 bg-slate-800/40' : 'border-transparent text-slate-400 hover:text-slate-200'"
      >
        Options & Greeks
      </button>
      <button
        data-test="tab-tertiary-btn"
        type="button"
        @click="$emit('update:activeTab', 'tertiary')"
        class="flex-1 py-2.5 font-medium text-center border-b-2 transition"
        :class="activeTab === 'tertiary' ? 'border-indigo-500 text-indigo-400 bg-slate-800/40' : 'border-transparent text-slate-400 hover:text-slate-200'"
      >
        Market Radar
      </button>
    </div>

    <!-- TAB 1 CONTENT: REAL AGENT COUNCIL STATUS -->
    <div
      v-if="activeTab === 'primary'"
      data-test="tab-primary-content"
      class="flex-1 min-h-0 p-4 overflow-y-auto space-y-4"
    >
      <!-- Consensus Summary Card -->
      <div class="bg-slate-800/60 border border-slate-700/80 rounded-xl p-3.5 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Consensus Status</span>
          <div class="flex items-center gap-2">
            <span v-if="lastAnalysisFormatted" class="text-[10px] text-slate-400 font-mono">
              {{ lastAnalysisFormatted }}
            </span>
            <span
              class="px-2 py-0.5 rounded text-xs font-mono font-bold"
              :class="agents['Consensus Judge']?.status === 'decided' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-300 border border-slate-700'"
            >
              {{ agents['Consensus Judge']?.status?.toUpperCase() || 'IDLE' }}
            </span>
          </div>
        </div>
        <p class="text-xs text-slate-200 leading-relaxed">
          {{ agents['Consensus Judge']?.message || 'Awaiting market data feed...' }}
        </p>
      </div>

      <!-- Real Parallel Specialists Matrix -->
      <div class="space-y-2">
        <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">MAS Specialists Envelope</div>

        <!-- Orchestrator -->
        <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-200">Orchestrator</span>
            <div class="flex items-center gap-2">
              <span v-if="agents['Orchestrator']?.lastUpdate" class="text-[10px] text-slate-500 font-mono">
                {{ formatTime(agents['Orchestrator']?.lastUpdate) }}
              </span>
              <span class="text-indigo-400 font-mono text-[11px]">{{ agents['Orchestrator']?.status?.toUpperCase() || 'IDLE' }}</span>
            </div>
          </div>
          <p class="text-xs text-slate-400 leading-normal">{{ agents['Orchestrator']?.message || 'Awaiting market data...' }}</p>
        </div>

        <!-- Regime Validator -->
        <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-200">Regime Validator</span>
            <div class="flex items-center gap-2">
              <span v-if="agents['Regime Validator']?.lastUpdate" class="text-[10px] text-slate-500 font-mono">
                {{ formatTime(agents['Regime Validator']?.lastUpdate) }}
              </span>
              <span class="text-indigo-400 font-mono text-[11px]">{{ agents['Regime Validator']?.status?.toUpperCase() || 'IDLE' }}</span>
            </div>
          </div>
          <p class="text-xs text-slate-400 leading-normal">{{ agents['Regime Validator']?.message || 'Awaiting orchestrator...' }}</p>
        </div>

        <!-- Structure Specialist -->
        <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-200">Structure Specialist</span>
            <div class="flex items-center gap-2">
              <span v-if="agents['Structure Specialist']?.lastUpdate" class="text-[10px] text-slate-500 font-mono">
                {{ formatTime(agents['Structure Specialist']?.lastUpdate) }}
              </span>
              <span class="text-indigo-400 font-mono text-[11px]">{{ agents['Structure Specialist']?.status?.toUpperCase() || 'IDLE' }}</span>
            </div>
          </div>
          <p class="text-xs text-slate-400 leading-normal">{{ agents['Structure Specialist']?.message || 'Awaiting MTF structure slice...' }}</p>
        </div>

        <!-- Options Specialist -->
        <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-200">Options Specialist</span>
            <div class="flex items-center gap-2">
              <span v-if="agents['Options Specialist']?.lastUpdate" class="text-[10px] text-slate-500 font-mono">
                {{ formatTime(agents['Options Specialist']?.lastUpdate) }}
              </span>
              <span class="text-indigo-400 font-mono text-[11px]">{{ agents['Options Specialist']?.status?.toUpperCase() || 'IDLE' }}</span>
            </div>
          </div>
          <p class="text-xs text-slate-400 leading-normal">{{ agents['Options Specialist']?.message || 'Awaiting OI/Greeks slice...' }}</p>
        </div>

        <!-- Macro & GTI -->
        <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-200">Macro & GTI</span>
            <div class="flex items-center gap-2">
              <span v-if="agents['Macro & GTI']?.lastUpdate" class="text-[10px] text-slate-500 font-mono">
                {{ formatTime(agents['Macro & GTI']?.lastUpdate) }}
              </span>
              <span class="text-indigo-400 font-mono text-[11px]">{{ agents['Macro & GTI']?.status?.toUpperCase() || 'IDLE' }}</span>
            </div>
          </div>
          <p class="text-xs text-slate-400 leading-normal">{{ agents['Macro & GTI']?.message || 'Awaiting VIX & GTI slice...' }}</p>
        </div>
      </div>

      <!-- Adversarial Critic -->
      <div class="bg-amber-950/20 border border-amber-800/40 rounded-xl p-3 space-y-1.5">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-amber-300 flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
            Adversarial Critic (Pre-Mortem)
          </span>
          <div class="flex items-center gap-2">
            <span v-if="agents['Adversarial Critic']?.lastUpdate" class="text-[10px] text-slate-500 font-mono">
              {{ formatTime(agents['Adversarial Critic']?.lastUpdate) }}
            </span>
            <span class="text-amber-400 font-mono text-[11px]">{{ agents['Adversarial Critic']?.status?.toUpperCase() || 'STANDBY' }}</span>
          </div>
        </div>
        <p class="text-xs text-slate-300 leading-normal">
          {{ agents['Adversarial Critic']?.message || 'Standby for pre-mortem check...' }}
        </p>
      </div>

      <!-- Dialectic Deliberation Council (Socratic Debate & Synthesis) -->
      <div class="bg-purple-950/20 border border-purple-800/40 rounded-xl p-3 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-purple-300 flex items-center gap-1.5">
            <span class="text-sm">⚖️</span>
            Dialectic Council (Socratic Debate)
          </span>
          <div class="flex items-center gap-2">
            <span
              class="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
              :class="agents['Dialectic Council']?.data?.wasDebated ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-purple-500/20 text-purple-300 border border-purple-500/40'"
            >
              {{ agents['Dialectic Council']?.data?.wasDebated ? 'ACTIVE DEBATE' : 'FAST-PATH PASS' }}
            </span>
          </div>
        </div>
        <p class="text-xs text-slate-300 leading-normal">
          {{ agents['Dialectic Council']?.message || 'Unanimous specialist alignment. Zero-latency fast path.' }}
        </p>
        <div v-if="agents['Dialectic Council']?.data?.speeches" class="space-y-1.5 pt-1 border-t border-purple-900/50 text-[11px] font-mono">
          <div
            v-for="(speech, idx) in agents['Dialectic Council'].data.speeches"
            :key="idx"
            class="bg-slate-900/80 p-2 rounded border border-purple-900/40 space-y-0.5"
          >
            <div class="flex items-center justify-between font-bold text-purple-300">
              <span>{{ speech.speaker }}:</span>
              <span :class="speech.stance === 'BULLISH' ? 'text-emerald-400' : (speech.stance === 'BEARISH' ? 'text-rose-400' : 'text-amber-400')">{{ speech.stance }}</span>
            </div>
            <p class="text-slate-400">{{ speech.coreArgument }}</p>
          </div>
        </div>
      </div>

      <!-- ReAct Deterministic Investigative Tools Telemetry -->
      <div class="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300 flex items-center gap-1.5">
            <span class="text-sm">🔍</span>
            Investigative ReAct Tools
          </span>
          <span class="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
            DETERMINISTIC
          </span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div class="bg-slate-900/70 p-2 rounded border border-slate-800">
            <div class="text-[10px] text-slate-500">SESSION RUNWAY</div>
            <div class="text-slate-200 font-bold flex items-center gap-1 mt-0.5">
              <span>⏱️</span>
              <span>{{ agents['Structure Specialist']?.data?.runwayMins ? `${agents['Structure Specialist'].data.runwayMins}m` : 'Unconstrained' }}</span>
            </div>
          </div>
          <div class="bg-slate-900/70 p-2 rounded border border-slate-800">
            <div class="text-[10px] text-slate-500">OPTION VELOCITY</div>
            <div class="text-slate-200 font-bold flex items-center gap-1 mt-0.5">
              <span>📐</span>
              <span>{{ agents['Options Specialist']?.data?.velocityStatus || 'Stable Flow' }}</span>
            </div>
          </div>
          <div class="bg-slate-900/70 p-2 rounded border border-slate-800">
            <div class="text-[10px] text-slate-500">GREEKS SURFACE</div>
            <div class="text-slate-200 font-bold flex items-center gap-1 mt-0.5">
              <span>📊</span>
              <span>{{ agents['Options Specialist']?.data?.deltaEfficiency || 'ATM Delta Opt' }}</span>
            </div>
          </div>
          <div class="bg-slate-900/70 p-2 rounded border border-slate-800">
            <div class="text-[10px] text-slate-500">SECTOR BETA</div>
            <div class="text-slate-200 font-bold flex items-center gap-1 mt-0.5">
              <span>📈</span>
              <span>{{ agents['Macro & GTI']?.data?.betaAlignment || 'Risk-On Sync' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Position Guardian & Thesis Guardianship -->
      <div class="bg-cyan-950/20 border border-cyan-800/40 rounded-xl p-3 space-y-1.5">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-cyan-300 flex items-center gap-1.5">
            <span class="text-sm">🛡️</span>
            Position Guardian
          </span>
          <span class="text-cyan-400 font-mono text-[11px] font-bold">
            {{ agents['Position Guardian']?.status?.toUpperCase() || 'ACTIVE' }}
          </span>
        </div>
        <p class="text-xs text-slate-300 leading-normal">
          {{ agents['Position Guardian']?.message || 'Continuous thesis guardianship active. 5m VWAP breakeven lock armed.' }}
        </p>
      </div>
    </div>

    <!-- TAB 2 CONTENT: OPTIONS & GREEKS -->
    <div
      v-else-if="activeTab === 'secondary'"
      data-test="tab-secondary-content"
      class="flex-1 p-4 overflow-y-auto space-y-4"
    >
      <div v-if="optionsAnalysis" class="space-y-4 font-mono text-xs">
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-slate-800/50 border border-slate-700/60 p-3 rounded-xl">
            <div class="text-[11px] text-slate-400">PCR RATIO</div>
            <div class="text-lg font-bold text-emerald-400">{{ optionsAnalysis.pcr?.toFixed(2) || '—' }}</div>
          </div>
          <div class="bg-slate-800/50 border border-slate-700/60 p-3 rounded-xl">
            <div class="text-[11px] text-slate-400">MAX PAIN</div>
            <div class="text-lg font-bold text-amber-400">{{ optionsAnalysis.maxPain || '—' }}</div>
          </div>
        </div>
      </div>
      <div v-else class="py-12 text-center text-slate-500 text-xs">
        Options chain and Greeks telemetry will compute dynamically during live market hours.
      </div>
    </div>

    <!-- TAB 3 CONTENT: RADAR & SCREENER -->
    <div
      v-else-if="activeTab === 'tertiary'"
      data-test="tab-tertiary-content"
      class="flex-1 p-4 overflow-y-auto space-y-4"
    >
      <div class="text-xs font-bold text-slate-400 uppercase tracking-wider">
        Market Surges & Candidate Radar
      </div>

      <div v-if="screenerList.length > 0" class="space-y-2 text-xs">
        <button
          v-for="stock in screenerList"
          :key="stock.symbol"
          data-test="screener-item"
          type="button"
          @click="$emit('selectStock', stock.symbol)"
          class="w-full text-left p-2.5 bg-slate-800/60 border border-slate-700/60 rounded-lg flex items-center justify-between hover:bg-slate-800 transition"
        >
          <div>
            <div class="font-bold text-white font-mono">{{ stock.symbol }}</div>
            <div class="text-slate-400 text-[11px]">Last: ₹{{ stock.lastPrice?.toFixed(2) }}</div>
          </div>
          <div class="text-right font-mono">
            <div
              class="font-bold"
              :class="stock.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'"
            >
              {{ stock.changePct >= 0 ? '+' : '' }}{{ stock.changePct?.toFixed(2) }}%
            </div>
          </div>
        </button>
      </div>

      <div v-else class="py-12 text-center text-slate-500 text-xs">
        Awaiting live market ticker feed...
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    activeTab?: 'primary' | 'secondary' | 'tertiary'
    marketState?: 'open' | 'closed'
    agents?: Record<string, any>
    activeSpecialist?: string
    optionsAnalysis?: any
    screenerData?: { topGainers?: any[]; topSurges?: any[]; activeCandidates?: any[] }
    lastAnalysisTime?: number | null
  }>(),
  {
    activeTab: 'primary',
    marketState: 'closed',
    agents: () => ({}),
    activeSpecialist: 'SCALPER',
    optionsAnalysis: null,
    screenerData: () => ({ topGainers: [], topSurges: [] }),
    lastAnalysisTime: null,
  }
)

defineEmits<{
  (e: 'update:activeTab', tab: 'primary' | 'secondary' | 'tertiary'): void
  (e: 'selectStock', symbol: string): void
}>()

function formatTime(timestamp?: number | string) {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

const lastAnalysisFormatted = computed(() => {
  if (!props.lastAnalysisTime) return null
  return formatTime(props.lastAnalysisTime)
})

const screenerList = computed(() => {
  return [
    ...(props.screenerData?.topGainers || []),
    ...(props.screenerData?.topSurges || []),
  ].slice(0, 10)
})
</script>
