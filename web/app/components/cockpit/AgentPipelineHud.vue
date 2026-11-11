<template>
  <div>
    <!-- 1. LIVE AGENT HUD -->
    <section
      v-if="marketState === 'open'"
      data-test="hud-live-section"
      class="bg-slate-900 border-b border-slate-800/80 px-4 py-2 flex items-center justify-between text-xs overflow-x-auto"
    >
      <div class="flex items-center gap-2 min-w-max">
        <span class="text-slate-400 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1">
          <svg class="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
          MAS PIPELINE:
        </span>

        <!-- 1. Orchestrator Node -->
        <button
          data-test="hud-orchestrator-btn"
          type="button"
          @click="$emit('selectAgent', 'Orchestrator')"
          class="cursor-pointer group flex items-center gap-2 px-2.5 py-1 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-md transition hover:border-indigo-500/50"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="getAgentDotColor(agents['Orchestrator']?.status)"
          ></span>
          <span class="text-slate-400 group-hover:text-slate-200">1. Orchestrator:</span>
          <span class="font-bold text-indigo-300">{{ agents['Orchestrator']?.status?.toUpperCase() || 'IDLE' }}</span>
        </button>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 2. Active Specialist -->
        <button
          data-test="hud-specialists-btn"
          type="button"
          @click="$emit('selectAgent', activeSpecialist)"
          class="cursor-pointer group flex items-center gap-2 px-2.5 py-1 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-md transition hover:border-indigo-500/50"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="getAgentDotColor(agents[activeSpecialist]?.status)"
          ></span>
          <span class="text-slate-400 group-hover:text-slate-200">2. Active Specialist:</span>
          <span class="font-bold text-slate-200">{{ activeSpecialist }}</span>
        </button>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 3. Adversarial Red-Team Critic -->
        <button
          data-test="hud-critic-btn"
          type="button"
          @click="$emit('selectAgent', 'Adversarial Critic')"
          class="cursor-pointer group flex items-center gap-2 px-2.5 py-1 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-md transition hover:border-amber-500/60"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="getAgentDotColor(agents['Adversarial Critic']?.status)"
          ></span>
          <span class="text-slate-400 group-hover:text-slate-200">3. Critic:</span>
          <span class="font-bold text-slate-200">{{ agents['Adversarial Critic']?.status?.toUpperCase() || 'STANDBY' }}</span>
        </button>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 4. Consensus Judge -->
        <button
          data-test="hud-consensus-btn"
          type="button"
          @click="$emit('selectAgent', 'Consensus Judge')"
          class="cursor-pointer group flex items-center gap-2 px-2.5 py-1 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-md transition hover:border-emerald-500"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="getAgentDotColor(agents['Consensus Judge']?.status)"
          ></span>
          <span class="text-slate-400 group-hover:text-slate-200">4. Consensus:</span>
          <span class="font-bold text-slate-200">{{ agents['Consensus Judge']?.status?.toUpperCase() || 'AWAITING' }}</span>
        </button>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 5. Risk Manager -->
        <button
          data-test="hud-risk-btn"
          type="button"
          @click="$emit('selectAgent', 'Risk Manager')"
          class="cursor-pointer group flex items-center gap-2 px-2.5 py-1 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-md transition hover:border-indigo-400"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="getAgentDotColor(agents['Risk Manager']?.status)"
          ></span>
          <span class="text-slate-400 group-hover:text-slate-200">5. Risk:</span>
          <span class="font-bold text-slate-200">{{ agents['Risk Manager']?.status?.toUpperCase() || 'ACTIVE' }}</span>
        </button>
      </div>

      <!-- Telemetry Pulse & Last Run Indicator -->
      <div class="flex items-center gap-3 text-[11px] font-mono pl-4 border-l border-slate-800 shrink-0">
        <div class="flex items-center gap-1.5">
          <span
            class="w-2 h-2 rounded-full"
            :class="isEvaluating ? 'bg-amber-400 animate-ping' : (lastRunIST ? 'bg-emerald-400' : 'bg-slate-500')"
          ></span>
          <span v-if="isEvaluating" class="text-amber-400 font-bold animate-pulse">
            EVALUATING NOW...
          </span>
          <span v-else class="text-slate-400">
            LAST ANALYSIS:
            <span class="font-bold text-slate-200">{{ lastRunIST || 'Standing by' }}</span>
            <span v-if="timeAgoText" class="text-slate-500 text-[10px] ml-1">({{ timeAgoText }})</span>
          </span>
        </div>
      </div>
    </section>

    <!-- 2. MARKET CLOSED: EOD FORENSIC & OVERNIGHT STRATEGY HUD -->
    <section
      v-else
      data-test="hud-closed-section"
      class="bg-slate-900 border-b border-indigo-900/40 px-4 py-2 flex items-center justify-between text-xs overflow-x-auto"
    >
      <div class="flex items-center gap-2.5 min-w-max">
        <span class="text-indigo-400 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
          <span>🌙</span> EOD MISSION DEBRIEF:
        </span>

        <!-- 1. Real Day Result -->
        <div class="flex items-center gap-2 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-md font-mono">
          <span class="text-slate-400">TODAY EXECUTIONS:</span>
          <span class="font-bold text-white">
            {{ calculatedEod.totalTrades }} TRADES ({{ calculatedEod.wins }}W / {{ calculatedEod.losses }}L)
          </span>
        </div>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 2. Real Win Rate -->
        <div class="flex items-center gap-2 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-md font-mono">
          <span class="text-slate-400">WIN RATE:</span>
          <span
            class="font-bold"
            :class="calculatedEod.winRate >= 50 ? 'text-emerald-400' : 'text-slate-300'"
          >
            {{ calculatedEod.totalTrades > 0 ? calculatedEod.winRate.toFixed(1) + '%' : '—' }}
          </span>
        </div>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 3. Real Realized Net -->
        <div class="flex items-center gap-2 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-md font-mono">
          <span class="text-slate-400">TODAY NET:</span>
          <span
            class="font-bold"
            :class="calculatedEod.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'"
          >
            {{ calculatedEod.netPnl >= 0 ? '+' : '' }}₹{{ calculatedEod.netPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 }) }}
          </span>
        </div>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 4. Next Session Readiness -->
        <div class="flex items-center gap-2 px-2.5 py-1 bg-purple-950/40 border border-purple-800/50 rounded-md font-mono">
          <span class="text-purple-300">OVERNIGHT STATUS:</span>
          <span class="font-bold text-purple-200">AWAITING 09:15 IST OPEN</span>
        </div>
      </div>

      <!-- Market Status & Last Analysis -->
      <div class="text-[11px] text-slate-400 font-mono pl-4 border-l border-slate-800 shrink-0 flex items-center gap-2">
        <span v-if="lastRunIST">Last Eval: <span class="text-slate-200 font-bold">{{ lastRunIST }}</span> •</span>
        <span>Status: <span class="text-indigo-400 font-bold">{{ marketStatusMessage || 'Market is Closed' }}</span></span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = withDefaults(
  defineProps<{
    marketState?: 'open' | 'closed'
    agents?: Record<string, any>
    activeSpecialist?: string
    tradeHistory?: Array<any>
    marketStatusMessage?: string
    lastAnalysisTime?: number | null
  }>(),
  {
    marketState: 'closed',
    agents: () => ({}),
    activeSpecialist: 'SCALPER',
    tradeHistory: () => [],
    marketStatusMessage: 'Market is Closed',
    lastAnalysisTime: null,
  }
)

defineEmits<{
  (e: 'selectAgent', agentId: string): void
}>()

const nowTick = ref(Date.now())
let timer: any = null

onMounted(() => {
  timer = setInterval(() => {
    nowTick.value = Date.now()
  }, 5000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const isEvaluating = computed(() => {
  return Object.values(props.agents || {}).some((a: any) => a?.status === 'thinking')
})

const lastRunIST = computed(() => {
  if (!props.lastAnalysisTime) return null
  const d = new Date(props.lastAnalysisTime)
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
})

const timeAgoText = computed(() => {
  if (!props.lastAnalysisTime) return ''
  const diffSec = Math.max(0, Math.floor((nowTick.value - props.lastAnalysisTime) / 1000))
  if (diffSec < 15) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const mins = Math.floor(diffSec / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `${hours}h ago`
})

function getAgentDotColor(status?: string) {
  if (status === 'thinking') return 'bg-indigo-400 animate-ping'
  if (status === 'decided' || status === 'active') return 'bg-emerald-400'
  if (status === 'error') return 'bg-rose-400'
  return 'bg-slate-500'
}

function getISTDateStr(dateInput: any): string {
  if (!dateInput) return ''
  const date = new Date(typeof dateInput === 'string' && dateInput.includes('T') && !dateInput.endsWith('Z') ? dateInput + 'Z' : dateInput)
  if (isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date)
}

const calculatedEod = computed(() => {
  const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const todayTrades = props.tradeHistory.filter((t) => {
    const d = t.closedAt || t.openedAt || ''
    return getISTDateStr(d) === todayIST
  })

  const wins = todayTrades.filter((t) => (Number(t.pnl) || 0) > 0).length
  const losses = todayTrades.filter((t) => (Number(t.pnl) || 0) < 0).length
  const totalTrades = todayTrades.length
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0
  const netPnl = todayTrades.reduce((acc, t) => acc + (Number(t.pnl) || 0), 0)

  return {
    wins,
    losses,
    totalTrades,
    winRate,
    netPnl,
  }
})
</script>
