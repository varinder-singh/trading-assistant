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
          @click="$emit('selectAgent', 'orchestrator')"
          class="cursor-pointer group flex items-center gap-2 px-2.5 py-1 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-md transition hover:border-indigo-500/50"
        >
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span class="text-slate-400 group-hover:text-slate-200">1. Orchestrator:</span>
          <span class="font-bold text-indigo-300">{{ orchestratorAgent }}</span>
        </button>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 2. Parallel Specialists Triad -->
        <button
          data-test="hud-specialists-btn"
          type="button"
          @click="$emit('selectAgent', 'specialists')"
          class="cursor-pointer group flex items-center gap-2 px-2.5 py-1 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-md transition hover:border-indigo-500/50"
        >
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span class="text-slate-400 group-hover:text-slate-200">2. Specialists (3):</span>
          <span class="font-medium text-slate-200">
            Struct (<span class="text-emerald-400 font-bold">{{ specialists.structure }}</span>) • 
            Opt (<span class="text-emerald-400 font-bold">{{ specialists.options }}</span>) • 
            GTI (<span class="text-emerald-400 font-bold">{{ specialists.gti }}</span>)
          </span>
        </button>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 3. Adversarial Red-Team Critic -->
        <button
          data-test="hud-critic-btn"
          type="button"
          @click="$emit('selectAgent', 'critic')"
          class="cursor-pointer group flex items-center gap-2 px-2.5 py-1 bg-amber-950/30 hover:bg-amber-950/50 border border-amber-800/40 rounded-md transition hover:border-amber-500/60"
        >
          <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
          <span class="text-amber-300/80 group-hover:text-amber-200">3. Red-Team Critic:</span>
          <span class="font-bold text-amber-300">{{ criticRisk }}</span>
        </button>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 4. Consensus Judge -->
        <button
          data-test="hud-consensus-btn"
          type="button"
          @click="$emit('selectAgent', 'consensus')"
          class="cursor-pointer group flex items-center gap-2 px-2.5 py-1 bg-emerald-950/40 hover:bg-emerald-950/60 border border-emerald-700/60 rounded-md transition hover:border-emerald-500"
        >
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span class="text-emerald-300/80 group-hover:text-emerald-200">4. Consensus:</span>
          <span class="font-bold text-emerald-300 font-mono">{{ consensus }} ({{ consensusConfidence }}%)</span>
        </button>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 5. Risk & Retract Guard -->
        <button
          data-test="hud-risk-btn"
          type="button"
          @click="$emit('selectAgent', 'risk')"
          class="cursor-pointer group flex items-center gap-2 px-2.5 py-1 bg-indigo-950/40 hover:bg-indigo-950/60 border border-indigo-700/50 rounded-md transition hover:border-indigo-400"
        >
          <span class="w-2 h-2 rounded-full bg-indigo-400"></span>
          <span class="text-indigo-300/80 group-hover:text-indigo-200">5. Risk & Ratchet:</span>
          <span class="font-bold text-indigo-300">{{ ratchetTier }}</span>
        </button>
      </div>

      <!-- Telemetry Pulse -->
      <div class="text-[11px] text-slate-500 font-mono pl-4 border-l border-slate-800 shrink-0">
        Cycle: <span class="text-slate-300">Active (1.2s)</span>
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

        <!-- 1. Day Result -->
        <div class="flex items-center gap-2 px-2.5 py-1 bg-emerald-950/40 border border-emerald-700/60 rounded-md font-mono">
          <span class="text-slate-400">SESSION OUTCOME:</span>
          <span class="font-bold text-emerald-300">
            {{ eodOutcome.wins }} WINS / {{ eodOutcome.losses }} LOSS ({{ eodOutcome.winRate }}% WIN RATE)
          </span>
        </div>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 2. Ratchet Efficiency -->
        <div class="flex items-center gap-2 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-md font-mono">
          <span class="text-slate-400">RATCHET EFFICIENCY:</span>
          <span class="font-bold text-indigo-300">{{ eodOutcome.mfeCapturedPct }}% PEAK MFE CAPTURED</span>
        </div>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 3. Reversal Save Audit -->
        <div class="flex items-center gap-2 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-md font-mono">
          <span class="text-slate-400">PROTECTED CAPITAL:</span>
          <span class="font-bold text-emerald-400">+₹{{ eodOutcome.savedCapital.toLocaleString('en-IN') }} REVERSAL SAVE</span>
        </div>

        <svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>

        <!-- 4. Next Session Readiness -->
        <div class="flex items-center gap-2 px-2.5 py-1 bg-purple-950/40 border border-purple-800/50 rounded-md font-mono">
          <span class="text-purple-300">TOMORROW'S PLAN:</span>
          <span class="font-bold text-purple-200">{{ eodOutcome.scenariosCount }} SCENARIOS SYNTHESIZED</span>
        </div>
      </div>

      <!-- Countdown -->
      <div class="text-[11px] text-slate-400 font-mono pl-4 border-l border-slate-800 shrink-0">
        Next Open: <span class="text-indigo-400 font-bold">{{ eodOutcome.nextOpenText }}</span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    marketState?: 'open' | 'closed'
    orchestratorAgent?: string
    specialists?: { structure: string; options: string; gti: number }
    criticRisk?: string
    consensus?: string
    consensusConfidence?: number
    ratchetTier?: string
    eodOutcome?: {
      wins: number
      losses: number
      winRate: number
      mfeCapturedPct: number
      savedCapital: number
      scenariosCount: number
      nextOpenText: string
    }
  }>(),
  {
    marketState: 'open',
    orchestratorAgent: 'TREND AGENT',
    specialists: () => ({ structure: 'POC', options: 'PE Build', gti: 78 }),
    criticRisk: '1 Pre-Mortem Risk Flag',
    consensus: 'BUY 24200 CE',
    consensusConfidence: 92,
    ratchetTier: 'Tier-2 Lock (+55% MFE)',
    eodOutcome: () => ({
      wins: 4,
      losses: 1,
      winRate: 80,
      mfeCapturedPct: 68.4,
      savedCapital: 3175,
      scenariosCount: 3,
      nextOpenText: 'Tomorrow 09:15 IST (in 10h 42m)',
    }),
  }
)

defineEmits<{
  (e: 'selectAgent', agentId: string): void
}>()
</script>
