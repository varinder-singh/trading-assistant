<template>
  <div class="bg-slate-950 text-slate-100 font-sans antialiased min-h-screen flex flex-col select-none overflow-x-hidden">
    <!-- 1. Header -->
    <FlightControlHeader
      :symbol="symbol"
      :live-price="livePrice"
      :price-change="priceChange"
      :price-change-pct="priceChangePct"
      :market-state="marketState"
      :flight-mode="flightMode"
      :daily-pnl="dailyPnl"
      :regime="regime"
      :vix="vix"
      :token-expiry-hours="tokenExpiryHours"
      @update:flight-mode="flightMode = $event"
      @update:market-state="marketState = $event"
      @panic-square-off="$emit('panicSquareOff')"
      @symbol-change="$emit('symbolChange', $event)"
    />

    <!-- 2. Agent Pipeline HUD -->
    <AgentPipelineHud
      :market-state="marketState"
      :orchestrator-agent="orchestratorAgent"
      :specialists="specialists"
      :critic-risk="criticRisk"
      :consensus="consensusVerdict"
      :consensus-confidence="consensusConfidence"
      :ratchet-tier="ratchetTier"
      :eod-outcome="eodOutcome"
      @select-agent="handleSelectAgent"
    />

    <!-- 3. Main Workspace Canvas -->
    <main class="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-[500px]">
      <!-- Chart -->
      <CockpitChart
        :market-state="marketState"
        :symbol="symbol"
        :selected-timeframe="selectedTimeframe"
        :overlays="overlays"
        :poc="pocLevel"
        :vwap="vwapLevel"
        :ratchet-floor="ratchetFloor"
        :high="highPrice"
        :low="lowPrice"
        :rsi="rsiValue"
        :atr="atrValue"
        :gti="gtiValue"
        :tick-latency-ms="tickLatencyMs"
        @update:selected-timeframe="selectedTimeframe = $event"
        @update:overlays="overlays = $event"
      />

      <!-- Right Deliberation Drawer -->
      <AgentDeliberationDrawer
        :active-tab="rightPanelTab"
        :market-state="marketState"
        :consensus="consensusObject"
        :specialists="specialistsDetailed"
        :critic="criticDetailed"
        :tomorrow-plan="tomorrowPlan"
        :greeks="greeksData"
        :screener="screenerData"
        @update:active-tab="rightPanelTab = $event"
        @select-stock="$emit('selectStock', $event)"
      />
    </main>

    <!-- 4. Bottom Positions & Forensics Dock -->
    <CockpitDock
      :active-tab="dockTab"
      :market-state="marketState"
      :positions="computedPositions"
      :closed-trades="computedClosedTrades"
      :event-logs="eventLogs"
      @update:active-tab="dockTab = $event"
      @scale-position="$emit('scalePosition', $event)"
      @close-position="$emit('closePosition', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
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
    vix?: number
  }>(),
  {
    symbol: 'NIFTY 50',
    livePrice: 24185.4,
    priceChange: 112.3,
    priceChangePct: 0.47,
    dailyPnl: 4850,
    portfolio: () => [],
    tradeHistory: () => [],
    eventLogs: () => [
      { time: '21:58:12', tag: 'WS_TICK', message: 'KiteTicker heartbeat: 0 dropped frames. Session alive.', tagColor: 'text-indigo-400' },
      { time: '21:58:14', tag: 'RATCHET_EVAL', message: 'Retract Guard active. Noise Floor Gate (6.0%) evaluated OK.', tagColor: 'text-emerald-400' },
      { time: '21:58:16', tag: 'CRITIC_PING', message: 'Red-Team Adversarial check passed with minor note (low theta risk).', tagColor: 'text-amber-400' },
      { time: '21:58:20', tag: 'BROKER_AUTH', message: 'Zerodha Kite Token: VALID (Expires in 7h 14m at 06:00 AM).', tagColor: 'text-purple-400' },
    ],
    isMarketOpen: true,
    vix: 13.24,
  }
)

defineEmits<{
  (e: 'panicSquareOff'): void
  (e: 'symbolChange', symbol: string): void
  (e: 'selectStock', symbol: string): void
  (e: 'scalePosition', payload: { id: string; pct: number }): void
  (e: 'closePosition', id: string): void
}>()

// UI state
const marketState = ref<'open' | 'closed'>(props.isMarketOpen ? 'open' : 'closed')
const flightMode = ref<'auto' | 'supervised' | 'halt'>('auto')
const selectedTimeframe = ref('3m')
const rightPanelTab = ref<'primary' | 'secondary' | 'tertiary'>('primary')
const dockTab = ref<'positions' | 'history' | 'events'>('positions')

const overlays = ref({
  ratchetBands: true,
  pocVah: true,
  vwapEma: true,
})

// Autonomous state defaults
const regime = ref('Bullish Trend Expansion')
const tokenExpiryHours = ref(7)
const orchestratorAgent = ref('TREND AGENT')
const criticRisk = ref('1 Pre-Mortem Risk Flag')
const consensusVerdict = ref('BUY 24200 CE')
const consensusConfidence = ref(92)
const ratchetTier = ref('Tier-2 Lock (+55% MFE)')

const specialists = ref({
  structure: 'POC',
  options: 'PE Build',
  gti: 78,
})

const pocLevel = ref(24150.0)
const vwapLevel = ref(24142.15)
const ratchetFloor = ref(24168.0)
const highPrice = ref(24210.8)
const lowPrice = ref(24095.1)
const rsiValue = ref(64.2)
const atrValue = ref(14.5)
const gtiValue = ref(78)
const tickLatencyMs = ref(18)

const eodOutcome = ref({
  wins: 4,
  losses: 1,
  winRate: 80,
  mfeCapturedPct: 68.4,
  savedCapital: 3175,
  scenariosCount: 3,
  nextOpenText: 'Tomorrow 09:15 IST (in 10h 42m)',
})

const consensusObject = computed(() => ({
  verdict: consensusVerdict.value,
  confidence: consensusConfidence.value,
  summary:
    'Consensus Judge confirmed trend alignment with Volume Profile POC defense at 24,150 and heavy PE put-writing buildup at 24,100 strike. Sizing calibrated to target 0.50 Delta notional.',
}))

const specialistsDetailed = ref({
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
})

const criticDetailed = ref({
  riskLevel: 'LOW/MODERATE',
  pitfall: '0DTE Expiry Theta burn accelerates after 14:15 IST.',
  mitigation: 'Enforced strict Retract Guard (Near DTE) and locked Profit Ratchet at Tier-1 immediately upon +8% MFE gain.',
})

const tomorrowPlan = ref({
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
})

const greeksData = ref({
  delta: 0.52,
  theta: 140,
  gamma: 0.0028,
  ivRank: 28.4,
  strikeBuildup: [
    { strike: '24,300 CE', ceOi: 70, peOi: 0, totalText: '42.1L' },
    { strike: '24,200 ATM', ceOi: 45, peOi: 55, totalText: '58.4L' },
    { strike: '24,100 PE', ceOi: 0, peOi: 85, totalText: '81.2L' },
  ],
})

const screenerData = ref([
  { symbol: 'RELIANCE', trigger: 'VWAP Cross + High Volume Surge', change: '+1.85%', gti: 84 },
  { symbol: 'HDFCBANK', trigger: 'Consolidation Breakout (15m POC)', change: '+0.94%', gti: 79 },
])

const computedPositions = computed(() => {
  if (props.portfolio && props.portfolio.length > 0) {
    return props.portfolio.map((p, idx) => ({
      id: p.id || `pos-${idx}`,
      symbol: p.symbol || 'NIFTY 24200 CE',
      type: (p.symbol && p.symbol.endsWith('PE') ? 'PE' : 'CE') as 'CE' | 'PE',
      mode: 'AUTONOMOUS',
      quantity: p.quantity || 50,
      entryPrice: p.buyPrice || 142.0,
      currentPrice: p.lastPrice || 174.5,
      peakPrice: p.highestPrice || 178.0,
      peakPct: p.highestPrice && p.buyPrice ? ((p.highestPrice - p.buyPrice) / p.buyPrice) * 100 : 25.3,
      ratchetTierText: 'Tier 2: Locked +55% MFE',
      stopLoss: p.stopLoss || 161.8,
      unrealizedPnl: p.unrealizedPnL || 1625.0,
      unrealizedPnlPct: p.unrealizedPnL && p.buyPrice && p.quantity ? (p.unrealizedPnL / (p.buyPrice * p.quantity)) * 100 : 22.8,
    }))
  }
  return [
    {
      id: 'pos-1',
      symbol: 'NIFTY 24200 CE',
      type: 'CE' as const,
      mode: 'AUTONOMOUS',
      quantity: 50,
      entryPrice: 142.0,
      currentPrice: 174.5,
      peakPrice: 178.0,
      peakPct: 25.3,
      ratchetTierText: 'Tier 2: Locked +55% MFE',
      stopLoss: 161.8,
      unrealizedPnl: 1625.0,
      unrealizedPnlPct: 22.8,
    },
  ]
})

const computedClosedTrades = computed(() => {
  if (props.tradeHistory && props.tradeHistory.length > 0) {
    return props.tradeHistory.slice(0, 10).map((t, idx) => ({
      id: t.id ? `TRD-${t.id.slice(0, 6)}` : `TRD-2410-0${idx + 1}`,
      symbol: t.symbol || 'NIFTY 24150 CE',
      entryPrice: t.entry_price || t.entryPrice || 110.0,
      exitPrice: t.exit_price || t.exitPrice || 148.5,
      exitAttribution: t.exit_reason || 'Ratchet Tier 3 Lock',
      peakMfePct: 38.5,
      mfeCapturePct: 74.2,
      netPnl: t.pnl || 1925.0,
      forensicVerdict: 'Protected Runner Against Sudden Pullback',
    }))
  }
  return [
    {
      id: 'TRD-2410-01',
      symbol: 'NIFTY 24150 CE',
      entryPrice: 110.0,
      exitPrice: 148.5,
      exitAttribution: 'Ratchet Tier 3 Lock',
      peakMfePct: 38.5,
      mfeCapturePct: 74.2,
      netPnl: 1925.0,
      forensicVerdict: 'Protected Runner Against Sudden Pullback',
    },
    {
      id: 'TRD-2410-02',
      symbol: 'NIFTY 24200 PE',
      entryPrice: 95.0,
      exitPrice: 104.2,
      exitAttribution: 'Retract Guard (Near DTE)',
      peakMfePct: 16.8,
      mfeCapturePct: 58.0,
      netPnl: 460.0,
      forensicVerdict: 'Reversal Save (+₹3,175 Capital Preserved)',
    },
    {
      id: 'TRD-2410-03',
      symbol: 'NIFTY 24200 CE',
      entryPrice: 135.0,
      exitPrice: 172.0,
      exitAttribution: 'Ratchet Tier 2 Lock',
      peakMfePct: 31.2,
      mfeCapturePct: 71.5,
      netPnl: 1850.0,
      forensicVerdict: 'Captured Trend Expansion to VAH',
    },
    {
      id: 'TRD-2410-04',
      symbol: 'NIFTY 24100 PE',
      entryPrice: 88.0,
      exitPrice: 79.0,
      exitAttribution: 'Strict SL Cut',
      peakMfePct: 3.2,
      mfeCapturePct: 0,
      netPnl: -450.0,
      forensicVerdict: 'Fast Exit on Invalidation at POC',
    },
    {
      id: 'TRD-2410-05',
      symbol: 'NIFTY 24200 CE',
      entryPrice: 142.0,
      exitPrice: 163.3,
      exitAttribution: 'EOD Auto Square-off',
      peakMfePct: 25.3,
      mfeCapturePct: 69.8,
      netPnl: 1065.0,
      forensicVerdict: 'Market Close Zero-Overnight Mandate',
    },
  ]
})

function handleSelectAgent(agentId: string) {
  rightPanelTab.value = 'primary'
}
</script>
