<template>
  <div class="bg-slate-950 text-slate-100 font-sans antialiased h-screen max-h-screen flex flex-col select-none overflow-hidden fixed inset-0">
    <!-- 1. Header (Anchored permanently) -->
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
    <main class="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
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
      @update:active-tab="dockTab = $event"
      @close-position="$emit('closePosition', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import FlightControlHeader from './FlightControlHeader.vue'
import AgentPipelineHud from './AgentPipelineHud.vue'
import AgentDeliberationDrawer from './AgentDeliberationDrawer.vue'
import CockpitChart from './CockpitChart.vue'
import CockpitDock from './CockpitDock.vue'

onMounted(() => {
  window.scrollTo(0, 0)
})

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

watch(
  () => props.portfolio,
  (newVal) => {
    if (newVal && newVal.length > 0 && dockTab.value === 'history') {
      dockTab.value = 'positions'
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
