<template>
  <div class="bg-slate-950 text-slate-100 font-sans antialiased h-screen max-h-screen flex flex-col select-none overflow-hidden fixed inset-0">
    <!-- 1. Header (Anchored permanently across desktop and mobile) -->
    <FlightControlHeader
      class="shrink-0 z-30"
      :symbol="symbol"
      :live-price="livePrice"
      :price-change="priceChange"
      :price-change-pct="priceChangePct"
      :market-state="marketState"
      :flight-mode="flightMode"
      :daily-pnl="dailyPnl"
      :regime="currentRegime"
      :vix="currentVix"
      :positions="portfolio"
      @update:flight-mode="flightMode = $event"
      @update:market-state="marketState = $event"
      @panic-square-off="$emit('panicSquareOff')"
      @symbol-change="$emit('symbolChange', $event)"
    />

    <!-- ============================================================== -->
    <!-- DESKTOP MULTI-PANE COCKPIT (Visible ONLY on lg: >= 1024px)     -->
    <!-- 100% UNCHANGED MULTI-COLUMN COMMAND CENTER LAYOUT               -->
    <!-- ============================================================== -->
    <div class="hidden lg:flex flex-col flex-1 min-h-0 overflow-hidden">
      <!-- 2. Agent Pipeline HUD (Anchored below header) -->
      <AgentPipelineHud
        class="shrink-0"
        :market-state="marketState"
        :agents="agents"
        :active-specialist="activeSpecialist"
        :trade-history="tradeHistory"
        :market-status-message="marketStatusMessage"
        :last-analysis-time="effectiveLastRun"
        @select-agent="handleSelectAgent"
      />

      <!-- 3. Main Workspace Canvas -->
      <main class="flex-1 min-h-0 flex flex-row overflow-hidden">
        <!-- Real Lightweight Candlestick Chart -->
        <CockpitChart
          class="flex-1 min-w-0 h-full"
          :market-state="marketState"
          :symbol="symbol"
          :selected-timeframe="chartTimeframe"
          :candles="candles"
          :gti-history="gtiHistory"
          :resistance="resistanceLevel"
          :support="supportLevel"
          :vwap="vwapLevel"
          :high="highPrice"
          :low="lowPrice"
          :live-price="livePrice"
          :rsi="currentRsi"
          :atr="currentAtr"
          :gti="currentGti"
          :overlays="overlays"
          :positions="portfolio"
          @update:selected-timeframe="$emit('timeframeChange', $event)"
          @update:overlays="overlays = $event"
        />

        <!-- Right Deliberation Drawer -->
        <AgentDeliberationDrawer
          class="w-full lg:w-[420px] shrink-0 h-full flex flex-col overflow-hidden"
          :active-tab="rightPanelTab"
          :market-state="marketState"
          :agents="agents"
          :active-specialist="activeSpecialist"
          :options-analysis="analysisResult?.optionsAnalysis"
          :screener-data="screenerData"
          :last-analysis-time="effectiveLastRun"
          @update:active-tab="rightPanelTab = $event"
          @select-stock="$emit('selectStock', $event)"
        />
      </main>

      <!-- 4. Bottom Positions & Forensics Dock -->
      <CockpitDock
        class="shrink-0 max-h-[220px] flex flex-col overflow-hidden"
        :active-tab="dockTab"
        :market-state="marketState"
        :positions="portfolio"
        :trade-history="tradeHistory"
        :event-logs="eventLogs"
        :mobile-view="false"
        @update:active-tab="dockTab = $event"
        @close-position="$emit('closePosition', $event)"
      />
    </div>

    <!-- ============================================================== -->
    <!-- MOBILE-ADAPTIVE COCKPIT (Visible ONLY on < 1024px / lg:hidden) -->
    <!-- FOCUSED FULL-HEIGHT TABBED NAVIGATION                          -->
    <!-- ============================================================== -->
    <div class="flex-1 min-h-0 flex flex-col overflow-hidden lg:hidden">
      <!-- Active Mobile View Container -->
      <div class="flex-1 min-h-0 overflow-hidden relative flex flex-col">
        <!-- Mobile Tab 1: Chart View (preserved via v-show for lightweight-charts canvas performance) -->
        <div v-show="mobileTab === 'chart'" class="flex-1 min-h-0 flex flex-col h-full">
          <CockpitChart
            class="flex-1 min-w-0 h-full"
            :market-state="marketState"
            :symbol="symbol"
            :selected-timeframe="chartTimeframe"
            :candles="candles"
            :gti-history="gtiHistory"
            :resistance="resistanceLevel"
            :support="supportLevel"
            :vwap="vwapLevel"
            :high="highPrice"
            :low="lowPrice"
            :live-price="livePrice"
            :rsi="currentRsi"
            :atr="currentAtr"
            :gti="currentGti"
            :overlays="overlays"
            :positions="portfolio"
            @update:selected-timeframe="$emit('timeframeChange', $event)"
            @update:overlays="overlays = $event"
          />
        </div>

        <!-- Mobile Tab 2: Positions View -->
        <div v-show="mobileTab === 'positions'" class="flex-1 min-h-0 flex flex-col h-full">
          <CockpitDock
            class="flex-1 min-h-0 flex flex-col overflow-hidden h-full"
            active-tab="positions"
            :market-state="marketState"
            :positions="portfolio"
            :trade-history="tradeHistory"
            :event-logs="eventLogs"
            :mobile-view="true"
            @close-position="$emit('closePosition', $event)"
          />
        </div>

        <!-- Mobile Tab 3: Today's Closed Trades & Forensic Logs View -->
        <div v-show="mobileTab === 'history'" class="flex-1 min-h-0 flex flex-col h-full">
          <CockpitDock
            class="flex-1 min-h-0 flex flex-col overflow-hidden h-full"
            active-tab="history"
            :market-state="marketState"
            :positions="portfolio"
            :trade-history="tradeHistory"
            :event-logs="eventLogs"
            :mobile-view="true"
          />
        </div>

        <!-- Mobile Tab 4: AI Agents & Deliberation View -->
        <div v-show="mobileTab === 'agents'" class="flex-1 min-h-0 flex flex-col h-full overflow-hidden">
          <AgentPipelineHud
            class="shrink-0"
            :market-state="marketState"
            :agents="agents"
            :active-specialist="activeSpecialist"
            :trade-history="tradeHistory"
            :market-status-message="marketStatusMessage"
            :last-analysis-time="effectiveLastRun"
            @select-agent="handleSelectAgent"
          />
          <AgentDeliberationDrawer
            class="flex-1 min-h-0 w-full flex flex-col overflow-hidden"
            :active-tab="rightPanelTab"
            :market-state="marketState"
            :agents="agents"
            :active-specialist="activeSpecialist"
            :options-analysis="analysisResult?.optionsAnalysis"
            :screener-data="screenerData"
            :last-analysis-time="effectiveLastRun"
            @update:active-tab="rightPanelTab = $event"
            @select-stock="$emit('selectStock', $event)"
          />
        </div>

        <!-- Mobile Tab 5: System Health & Engine Logs View -->
        <div v-show="mobileTab === 'events'" class="flex-1 min-h-0 flex flex-col h-full">
          <CockpitDock
            class="flex-1 min-h-0 flex flex-col overflow-hidden h-full"
            active-tab="events"
            :market-state="marketState"
            :positions="portfolio"
            :trade-history="tradeHistory"
            :event-logs="eventLogs"
            :mobile-view="true"
          />
        </div>
      </div>

      <!-- Mobile Bottom Navigation Bar (Thumb-reachable 5-tab bar) -->
      <nav
        data-test="mobile-bottom-nav"
        class="shrink-0 bg-slate-900 border-t border-slate-800 px-1 py-1.5 grid grid-cols-5 gap-1 z-40 select-none"
      >
        <!-- 1. Positions -->
        <button
          data-test="mobile-tab-positions"
          type="button"
          @click="mobileTab = 'positions'"
          class="flex flex-col items-center justify-center py-1 px-1 rounded-lg transition relative"
          :class="mobileTab === 'positions' ? 'text-indigo-400 bg-slate-800/80 font-bold' : 'text-slate-400 hover:text-white'"
        >
          <div class="relative">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7h-4V4a1 1 0 00-1-1h-6a1 1 0 00-1 1v3H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/>
            </svg>
            <span
              v-if="portfolio.length > 0"
              class="absolute -top-1 -right-2 px-1 py-0.2 bg-emerald-500 text-slate-950 font-black text-[9px] rounded-full min-w-[14px] text-center"
            >
              {{ portfolio.length }}
            </span>
          </div>
          <span class="text-[10px] mt-0.5 tracking-tight">Positions</span>
        </button>

        <!-- 2. Closed Trades & Forensics -->
        <button
          data-test="mobile-tab-history"
          type="button"
          @click="mobileTab = 'history'"
          class="flex flex-col items-center justify-center py-1 px-1 rounded-lg transition relative"
          :class="mobileTab === 'history' ? 'text-indigo-400 bg-slate-800/80 font-bold' : 'text-slate-400 hover:text-white'"
        >
          <div class="relative">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>
            </svg>
            <span
              v-if="todaysTradesCount > 0"
              class="absolute -top-1 -right-2 px-1 py-0.2 bg-indigo-500 text-white font-bold text-[9px] rounded-full min-w-[14px] text-center"
            >
              {{ todaysTradesCount }}
            </span>
          </div>
          <span class="text-[10px] mt-0.5 tracking-tight">Forensics</span>
        </button>

        <!-- 3. Chart -->
        <button
          data-test="mobile-tab-chart"
          type="button"
          @click="mobileTab = 'chart'"
          class="flex flex-col items-center justify-center py-1 px-1 rounded-lg transition"
          :class="mobileTab === 'chart' ? 'text-indigo-400 bg-slate-800/80 font-bold' : 'text-slate-400 hover:text-white'"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"/>
          </svg>
          <span class="text-[10px] mt-0.5 tracking-tight">Chart</span>
        </button>

        <!-- 4. AI Agents -->
        <button
          data-test="mobile-tab-agents"
          type="button"
          @click="mobileTab = 'agents'"
          class="flex flex-col items-center justify-center py-1 px-1 rounded-lg transition"
          :class="mobileTab === 'agents' ? 'text-indigo-400 bg-slate-800/80 font-bold' : 'text-slate-400 hover:text-white'"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
          </svg>
          <span class="text-[10px] mt-0.5 tracking-tight">AI Agents</span>
        </button>

        <!-- 5. System Logs -->
        <button
          data-test="mobile-tab-events"
          type="button"
          @click="mobileTab = 'events'"
          class="flex flex-col items-center justify-center py-1 px-1 rounded-lg transition"
          :class="mobileTab === 'events' ? 'text-indigo-400 bg-slate-800/80 font-bold' : 'text-slate-400 hover:text-white'"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/>
          </svg>
          <span class="text-[10px] mt-0.5 tracking-tight">Logs</span>
        </button>
      </nav>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import FlightControlHeader from './FlightControlHeader.vue'
import AgentPipelineHud from './AgentPipelineHud.vue'
import AgentDeliberationDrawer from './AgentDeliberationDrawer.vue'
import CockpitChart from './CockpitChart.vue'
import CockpitDock from './CockpitDock.vue'

const props = withDefaults(
  defineProps<{
    symbol?: string
    livePrice?: number | null
    priceChange?: number | null
    priceChangePct?: number | null
    dailyPnl?: number
    portfolio?: any[]
    tradeHistory?: any[]
    eventLogs?: any[]
    isMarketOpen?: boolean
    marketStatusMessage?: string
    agents?: Record<string, any>
    analysisResult?: any
    screenerData?: any
    chartTimeframe?: string
    lastAnalysisTime?: number | null
  }>(),
  {
    symbol: 'NIFTY',
    livePrice: null,
    priceChange: null,
    priceChangePct: null,
    dailyPnl: 0,
    portfolio: () => [],
    tradeHistory: () => [],
    eventLogs: () => [],
    isMarketOpen: false,
    marketStatusMessage: 'Market is Closed',
    agents: () => ({}),
    analysisResult: null,
    screenerData: () => ({ topGainers: [], topSurges: [] }),
    chartTimeframe: '15m',
    lastAnalysisTime: null,
  }
)

const emit = defineEmits<{
  (e: 'panicSquareOff'): void
  (e: 'symbolChange', symbol: string): void
  (e: 'selectStock', symbol: string): void
  (e: 'timeframeChange', tf: string): void
  (e: 'closePosition', id: string): void
}>()

// UI state
const marketState = ref<'open' | 'closed'>(props.isMarketOpen ? 'open' : 'closed')
watch(() => props.isMarketOpen, (val) => {
  marketState.value = val ? 'open' : 'closed'
})

const flightMode = ref<'auto' | 'supervised' | 'halt'>('auto')
const rightPanelTab = ref<'primary' | 'secondary' | 'tertiary'>('primary')
const dockTab = ref<'positions' | 'history' | 'events'>(
  props.portfolio && props.portfolio.length > 0 ? 'positions' : (props.isMarketOpen ? 'positions' : 'history')
)

// Mobile Navigation State
const mobileTab = ref<'positions' | 'history' | 'chart' | 'agents' | 'events'>('positions')

onMounted(() => {
  window.scrollTo(0, 0)
  if (props.portfolio && props.portfolio.length > 0) {
    mobileTab.value = 'positions'
  } else if (props.isMarketOpen) {
    mobileTab.value = 'chart'
  } else {
    mobileTab.value = 'history'
  }
})

function getISTDateStr(dateInput: any): string {
  if (!dateInput) return ''
  const date = new Date(typeof dateInput === 'string' && dateInput.includes('T') && !dateInput.endsWith('Z') ? dateInput + 'Z' : dateInput)
  if (isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date)
}

const todayIST = computed(() => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
})

const todaysTradesCount = computed(() => {
  return (props.tradeHistory || []).filter((t: any) => {
    const d = t.closedAt || t.openedAt || ''
    return getISTDateStr(d) === todayIST.value
  }).length
})

watch(
  () => props.portfolio,
  (newVal) => {
    if (newVal && newVal.length > 0) {
      if (dockTab.value === 'history') dockTab.value = 'positions'
      if (mobileTab.value === 'history') mobileTab.value = 'positions'
    }
  },
  { deep: true }
)

const overlays = ref({
  ratchetBands: true,
  pocVah: true,
  vwapEma: true,
})

const effectiveLastRun = computed(() => {
  if (props.lastAnalysisTime) return props.lastAnalysisTime
  const agentTimes = Object.values(props.agents || {}).map((a: any) => a?.lastUpdate || 0)
  const maxAgent = Math.max(0, ...agentTimes)
  return maxAgent > 0 ? maxAgent : null
})

const activeSpecialist = computed(() => {
  if (props.agents['TREND'] && props.agents['TREND'].status !== 'idle') return 'TREND'
  if (props.agents['SCALPER'] && props.agents['SCALPER'].status !== 'idle') return 'SCALPER'
  return 'SCALPER'
})

const currentRegime = computed(() => {
  return props.analysisResult?.regime || props.agents['Regime Validator']?.message || 'EVALUATING'
})

const currentVix = computed(() => {
  return props.analysisResult?.vix || props.analysisResult?.indiaVix || null
})

const candles = computed(() => {
  if (!props.analysisResult) return []
  const key = `candles${props.chartTimeframe}`
  return props.analysisResult[key] || props.analysisResult.candles15m || []
})

const gtiHistory = computed(() => {
  return props.analysisResult?.gtiHistory || []
})

const currentStats = computed(() => {
  if (!props.analysisResult) return null
  const key = `tf${props.chartTimeframe}`
  return props.analysisResult[key] || props.analysisResult.tf15m || null
})

const resistanceLevel = computed(() => currentStats.value?.resistance || null)
const supportLevel = computed(() => currentStats.value?.support || null)
const vwapLevel = computed(() => currentStats.value?.vwap || null)
const currentRsi = computed(() => currentStats.value?.rsi || null)
const currentAtr = computed(() => currentStats.value?.atr || null)
const currentGti = computed(() => currentStats.value?.gtiScore?.composite ? Math.round(currentStats.value.gtiScore.composite * 100) : null)

const highPrice = computed(() => {
  if (candles.value.length === 0) return null
  return Math.max(...candles.value.map((c: any) => c.high))
})

const lowPrice = computed(() => {
  if (candles.value.length === 0) return null
  return Math.min(...candles.value.map((c: any) => c.low))
})

function handleSelectAgent(agentId: string) {
  rightPanelTab.value = 'primary'
}
</script>
