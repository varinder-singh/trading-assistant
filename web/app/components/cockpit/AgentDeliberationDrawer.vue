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
        {{ marketState === 'open' ? 'Agent Council (MAS)' : "Tomorrow's Plan" }}
      </button>
      <button
        data-test="tab-secondary-btn"
        type="button"
        @click="$emit('update:activeTab', 'secondary')"
        class="flex-1 py-2.5 font-medium text-center border-b-2 transition"
        :class="activeTab === 'secondary' ? 'border-indigo-500 text-indigo-400 bg-slate-800/40' : 'border-transparent text-slate-400 hover:text-slate-200'"
      >
        Greeks & OI Chain
      </button>
      <button
        data-test="tab-tertiary-btn"
        type="button"
        @click="$emit('update:activeTab', 'tertiary')"
        class="flex-1 py-2.5 font-medium text-center border-b-2 transition"
        :class="activeTab === 'tertiary' ? 'border-indigo-500 text-indigo-400 bg-slate-800/40' : 'border-transparent text-slate-400 hover:text-slate-200'"
      >
        {{ marketState === 'open' ? 'Market Radar' : 'Overnight Radar' }}
      </button>
    </div>

    <!-- TAB 1 CONTENT: LIVE COUNCIL OR TOMORROW'S PLAN -->
    <div
      v-if="activeTab === 'primary'"
      data-test="tab-primary-content"
      class="flex-1 p-4 overflow-y-auto space-y-4"
    >
      <!-- LIVE MODE DELIBERATION -->
      <div v-if="marketState === 'open'" class="space-y-4">
        <!-- Consensus Summary Card -->
        <div class="bg-slate-800/60 border border-slate-700/80 rounded-xl p-3.5 space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Consensus Verdict</span>
            <span class="px-2 py-0.5 rounded text-xs font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
              {{ consensus.verdict }} ({{ consensus.confidence }}%)
            </span>
          </div>
          <p class="text-xs text-slate-200 leading-relaxed">
            {{ consensus.summary }}
          </p>
        </div>

        <!-- Parallel Specialists Accordion / Matrix -->
        <div class="space-y-2">
          <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Parallel Specialists Synthesis</div>
          
          <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 space-y-1">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-slate-200">{{ specialists.structure.title }}</span>
              <span class="text-emerald-400 font-mono text-[11px]">{{ specialists.structure.tag }}</span>
            </div>
            <p class="text-xs text-slate-400 leading-normal">{{ specialists.structure.description }}</p>
          </div>

          <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 space-y-1">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-slate-200">{{ specialists.options.title }}</span>
              <span class="text-emerald-400 font-mono text-[11px]">{{ specialists.options.tag }}</span>
            </div>
            <p class="text-xs text-slate-400 leading-normal">{{ specialists.options.description }}</p>
          </div>

          <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 space-y-1">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-slate-200">{{ specialists.macro.title }}</span>
              <span class="text-emerald-400 font-mono text-[11px]">{{ specialists.macro.tag }}</span>
            </div>
            <p class="text-xs text-slate-400 leading-normal">{{ specialists.macro.description }}</p>
          </div>
        </div>

        <!-- Red-Team Adversarial Critic Pre-Mortem -->
        <div class="bg-amber-950/20 border border-amber-800/40 rounded-xl p-3 space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-amber-300 flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              Adversarial Pre-Mortem Audit
            </span>
            <span class="text-amber-400 font-mono text-[11px]">RISK: {{ critic.riskLevel }}</span>
          </div>
          <div class="text-xs text-slate-300 space-y-1 leading-normal">
            <p><strong class="text-amber-200">Potential Pitfall:</strong> {{ critic.pitfall }}</p>
            <p><strong class="text-emerald-300">Critic Mitigation:</strong> {{ critic.mitigation }}</p>
          </div>
        </div>
      </div>

      <!-- MARKET CLOSED: TOMORROW'S PLAN -->
      <div v-else class="space-y-4">
        <!-- Mission Debrief Status Card -->
        <div class="bg-indigo-950/40 border border-indigo-800/60 rounded-xl p-3.5 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
              <span>🤖</span> Autonomous Strategy Pre-Computation
            </span>
            <span class="px-2 py-0.5 rounded text-xs font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">READY FOR 09:15</span>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed">
            Multi-Agent System completed post-market session reconciliation. Key structural levels, overnight institutional flow (GTI), and 3 conditional opening trade scenarios computed.
          </p>
        </div>

        <!-- Reference Levels Matrix -->
        <div class="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3 space-y-2">
          <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tomorrow's Reference Levels (NIFTY)</div>
          <div class="grid grid-cols-3 gap-2 font-mono text-xs">
            <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
              <div class="text-slate-500 text-[10px]">VAL (SUPPORT)</div>
              <div class="text-emerald-400 font-bold">{{ tomorrowPlan.levels.val.toFixed(2) }}</div>
            </div>
            <div class="bg-slate-900/60 p-2 rounded border border-amber-500/30">
              <div class="text-amber-400 text-[10px]">SESSION POC</div>
              <div class="text-amber-300 font-bold">{{ tomorrowPlan.levels.poc.toFixed(2) }}</div>
            </div>
            <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
              <div class="text-slate-500 text-[10px]">VAH (RESIST)</div>
              <div class="text-rose-400 font-bold">{{ tomorrowPlan.levels.vah.toFixed(2) }}</div>
            </div>
          </div>
        </div>

        <!-- Conditional Scenarios -->
        <div class="space-y-2">
          <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tomorrow's Automated Scenarios</div>

          <div
            v-for="scenario in tomorrowPlan.scenarios"
            :key="scenario.code"
            class="bg-slate-800/40 border-l-4 p-2.5 rounded-r-lg space-y-1"
            :class="scenario.borderColor"
          >
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-slate-200">{{ scenario.title }}</span>
              <span class="text-slate-400 text-[11px] font-mono">{{ scenario.agent }}</span>
            </div>
            <p class="text-xs text-slate-300 leading-normal">{{ scenario.description }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2 CONTENT: GREEKS & OI CHAIN -->
    <div
      v-else-if="activeTab === 'secondary'"
      data-test="tab-secondary-content"
      class="flex-1 p-4 overflow-y-auto space-y-4"
    >
      <!-- Greeks Gauges -->
      <div class="grid grid-cols-2 gap-3 font-mono">
        <div class="bg-slate-800/50 border border-slate-700/60 p-3 rounded-xl">
          <div class="text-[11px] text-slate-400">NORMALIZED DELTA</div>
          <div class="text-lg font-bold text-emerald-400">{{ (greeks.delta >= 0 ? '+' : '') + greeks.delta.toFixed(2) }} Δ</div>
          <div class="text-xs text-slate-500 mt-0.5">Sizing Target: 0.50 Δ</div>
        </div>
        <div class="bg-slate-800/50 border border-slate-700/60 p-3 rounded-xl">
          <div class="text-[11px] text-slate-400">THETA BURN</div>
          <div class="text-lg font-bold text-rose-400">-₹{{ Math.abs(greeks.theta).toFixed(2) }} / hr</div>
          <div class="text-xs text-slate-500 mt-0.5">Decay safe until 14:30</div>
        </div>
        <div class="bg-slate-800/50 border border-slate-700/60 p-3 rounded-xl">
          <div class="text-[11px] text-slate-400">GAMMA RISK</div>
          <div class="text-lg font-bold text-indigo-300">{{ greeks.gamma.toFixed(4) }}</div>
          <div class="text-xs text-slate-500 mt-0.5">Stable near ATM</div>
        </div>
        <div class="bg-slate-800/50 border border-slate-700/60 p-3 rounded-xl">
          <div class="text-[11px] text-slate-400">IV RANK (30-DAY)</div>
          <div class="text-lg font-bold text-amber-400">{{ greeks.ivRank.toFixed(1) }}%</div>
          <div class="text-xs text-slate-500 mt-0.5">No IV Crush risk</div>
        </div>
      </div>

      <!-- Strike Buildup Heatmap -->
      <div class="space-y-2">
        <div class="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Strike OI Buildup</div>
        <div class="space-y-1.5 font-mono text-xs">
          <div
            v-for="item in greeks.strikeBuildup"
            :key="item.strike"
            class="flex items-center justify-between text-slate-300 p-1 rounded"
          >
            <span class="w-20 font-bold" :class="item.strike.includes('CE') ? 'text-rose-400' : 'text-emerald-400'">
              {{ item.strike }}
            </span>
            <div class="flex-1 mx-3 bg-slate-800 h-2.5 rounded-full overflow-hidden flex">
              <div class="bg-rose-500" :style="{ width: item.ceOi + '%' }"></div>
              <div class="bg-emerald-500" :style="{ width: item.peOi + '%' }"></div>
            </div>
            <span class="w-12 text-right text-slate-400">{{ item.totalText }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 3 CONTENT: RADAR & SCREENER -->
    <div
      v-else-if="activeTab === 'tertiary'"
      data-test="tab-tertiary-content"
      class="flex-1 p-4 overflow-y-auto space-y-4"
    >
      <div class="text-xs font-bold text-slate-400 uppercase tracking-wider">
        {{ marketState === 'open' ? 'Candidate Breakout Radar' : 'Overnight Radar & Pre-Screen' }}
      </div>

      <div class="space-y-2 text-xs">
        <button
          v-for="stock in screener"
          :key="stock.symbol"
          data-test="screener-item"
          type="button"
          @click="$emit('selectStock', stock.symbol)"
          class="w-full text-left p-2.5 bg-slate-800/60 border border-slate-700/60 rounded-lg flex items-center justify-between hover:bg-slate-800 transition"
        >
          <div>
            <div class="font-bold text-white font-mono">{{ stock.symbol }}</div>
            <div class="text-slate-400 text-[11px]">{{ stock.trigger }}</div>
          </div>
          <div class="text-right font-mono">
            <div class="text-emerald-400 font-bold">{{ stock.change }}</div>
            <div class="text-slate-500 text-[11px]">GTI: {{ stock.gti }}</div>
          </div>
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    activeTab?: 'primary' | 'secondary' | 'tertiary'
    marketState?: 'open' | 'closed'
    consensus?: { verdict: string; confidence: number; summary: string }
    specialists?: {
      structure: { title: string; tag: string; description: string }
      options: { title: string; tag: string; description: string }
      macro: { title: string; tag: string; description: string }
    }
    critic?: { riskLevel: string; pitfall: string; mitigation: string }
    tomorrowPlan?: {
      scenarios: Array<{ code: string; title: string; agent: string; description: string; borderColor: string }>
      levels: { val: number; poc: number; vah: number }
    }
    greeks?: {
      delta: number
      theta: number
      gamma: number
      ivRank: number
      strikeBuildup: Array<{ strike: string; ceOi: number; peOi: number; totalText: string }>
    }
    screener?: Array<{ symbol: string; trigger: string; change: string; gti: number }>
  }>(),
  {
    activeTab: 'primary',
    marketState: 'open',
    consensus: () => ({
      verdict: 'STRONG BUY CE',
      confidence: 92,
      summary:
        'Consensus Judge confirmed trend alignment with Volume Profile POC defense at 24,150 and heavy PE put-writing buildup at 24,100 strike. Sizing calibrated to target 0.50 Delta notional.',
    }),
    specialists: () => ({
      structure: {
        title: '1. Structure Specialist',
        tag: 'BULLISH POC HOLD',
        description: 'Price bounced off 5m VWAP with higher low above 24,140 POC. VAH target opened at 24,240.',
      },
      options: {
        title: '2. Options Specialist',
        tag: 'PCR: 1.28 (+0.14)',
        description: 'Aggressive Put addition at 24,100 & 24,150 PE. Call unwinding noted at 24,200 CE.',
      },
      macro: {
        title: '3. Macro & GTI Specialist',
        tag: 'GTI: 78 (INSTITUTIONAL)',
        description: 'India VIX cooled -2.1% to 13.24. Banking index (HDFC, ICICI) leading breadth expansion.',
      },
    }),
    critic: () => ({
      riskLevel: 'LOW/MODERATE',
      pitfall: '0DTE Expiry Theta burn accelerates after 14:15 IST.',
      mitigation: 'Enforced strict Retract Guard (Near DTE) and locked Profit Ratchet at Tier-1 upon +8% MFE gain.',
    }),
    tomorrowPlan: () => ({
      levels: { val: 24080, poc: 24150, vah: 24240 },
      scenarios: [
        {
          code: 'A',
          title: 'SCENARIO A: Gap-Up (>24,240 VAH)',
          agent: 'TREND AGENT',
          description: 'If Gift Nifty holds above 24,240 on 5m opening bar with Positive GTI, initialize Trend Bullish breakout. Target: 24,350.',
          borderColor: 'border-emerald-500',
        },
        {
          code: 'B',
          title: 'SCENARIO B: Range Open (24,100 - 24,200)',
          agent: 'SCALPER AGENT',
          description: 'Mean reversion between Value Area boundaries. High-frequency scalping activated targeting POC 24,150 retests.',
          borderColor: 'border-indigo-500',
        },
        {
          code: 'C',
          title: 'SCENARIO C: Breakdown (<24,080 VAL)',
          agent: 'DEFENSIVE / STANDBY',
          description: 'Critic requires 15m consolidation before allowing PE buys. Strict Max Loss limit capped at ₹3,000.',
          borderColor: 'border-rose-500',
        },
      ],
    }),
    greeks: () => ({
      delta: 0.52,
      theta: 140,
      gamma: 0.0028,
      ivRank: 28.4,
      strikeBuildup: [
        { strike: '24,300 CE', ceOi: 70, peOi: 0, totalText: '42.1L' },
        { strike: '24,200 ATM', ceOi: 45, peOi: 55, totalText: '58.4L' },
        { strike: '24,100 PE', ceOi: 0, peOi: 85, totalText: '81.2L' },
      ],
    }),
    screener: () => [
      { symbol: 'RELIANCE', trigger: 'VWAP Cross + High Volume Surge', change: '+1.85%', gti: 84 },
      { symbol: 'HDFCBANK', trigger: 'Consolidation Breakout (15m POC)', change: '+0.94%', gti: 79 },
    ],
  }
)

defineEmits<{
  (e: 'update:activeTab', tab: 'primary' | 'secondary' | 'tertiary'): void
  (e: 'selectStock', symbol: string): void
}>()
</script>
