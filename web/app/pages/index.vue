<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, watchEffect, nextTick, computed } from 'vue'
import AutonomousCockpit from '~/components/cockpit/AutonomousCockpit.vue'

const user = useSupabaseUser()
watchEffect(() => {
  if (!user.value) {
    navigateTo('/login')
  }
})
import {
  Search,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Info,
  Activity,
  ShieldCheck,
  Target,
  Zap,
  X,
  LogOut,
  Settings,
  BarChart2,
  ChevronRight,
  RefreshCcw,
  Radar,
  Flame,
} from '@lucide/vue'
import { createChart, CandlestickSeries, CrosshairMode } from 'lightweight-charts'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'

const symbol = ref('NIFTY')
const mode = ref<'intraday' | 'swing'>('intraday')
const loading = ref(false)
const analysisResult = ref<any>(null)
const error = ref<string | null>(null)
const livePrice = ref<number | null>(null)
const breakouts = ref<any[]>([])
const portfolio = ref<any[]>([])
const tradeHistory = ref<any[]>([])
const analyzerEvents = ref<any[]>([])
const currentView = ref<'live' | 'history' | 'events' | 'logs'>('live')
const expandedTradeId = ref<string | null>(null)
const supabase = useSupabaseClient()
const isLoggingOut = ref(false)

const handleLogout = async () => {
  try {
    isLoggingOut.value = true
    await supabase.auth.signOut()
    navigateTo('/login')
  } catch (error) {
    console.error('Error logging out:', error)
  } finally {
    isLoggingOut.value = false
  }
}

const notifications = ref<any[]>([])
const serverLogs = ref<string[]>([])
const logsContainer = ref<HTMLElement | null>(null)
const lastInstitutionalAlertAt = ref(0)
const isMarketOpen = ref<boolean>(true)
const marketStatusMessage = ref<string>('Checking market status...')

const screenerData = ref<any>({ topGainers: [], topSurges: [], activeCandidates: [] })
const candidateAlerts = ref<any[]>([])
const showScreener = ref(false)

function focusStock(sym: string) {
  symbol.value = sym.toUpperCase()
  startWatching()
  runAnalysis()
}

const agents = ref<Record<string, any>>({
  Orchestrator: { status: 'idle', message: 'Awaiting market data...', lastUpdate: Date.now() },
  'Regime Validator': { status: 'idle', message: 'Awaiting orchestrator...', lastUpdate: Date.now() },
  SCALPER: { status: 'idle', message: 'Awaiting signal...', lastUpdate: Date.now() },
  TREND: { status: 'idle', message: 'Awaiting trend...', lastUpdate: Date.now() },
  'Structure Specialist': { status: 'idle', message: 'Awaiting MTF structure slice...', lastUpdate: Date.now() },
  'Options Specialist': { status: 'idle', message: 'Awaiting OI/Greeks slice...', lastUpdate: Date.now() },
  'Macro & GTI': { status: 'idle', message: 'Awaiting VIX & GTI slice...', lastUpdate: Date.now() },
  'Adversarial Critic': { status: 'idle', message: 'Standby for pre-mortem check...', lastUpdate: Date.now() },
  'Consensus Judge': { status: 'idle', message: 'Awaiting specialist envelopes...', lastUpdate: Date.now() },
  'Risk Manager': { status: 'idle', message: 'No active positions.', lastUpdate: Date.now() },
})

const activeSpecialist = computed(() => {
  if (agents.value['TREND'] && agents.value['TREND'].status !== 'idle') return 'TREND'
  if (agents.value['SCALPER'] && agents.value['SCALPER'].status !== 'idle') return 'SCALPER'
  if (
    agents.value['TREND'] &&
    agents.value['SCALPER'] &&
    agents.value['TREND'].lastUpdate > agents.value['SCALPER'].lastUpdate
  )
    return 'TREND'
  return 'SCALPER'
})

const selectedAgentForDetail = ref<string | null>(null)

const dailyPnl = computed(() => {
  const realized = tradeHistory.value
    .filter((t) => {
      const today = new Date().toISOString().split('T')[0]
      return t.status === 'CLOSED' && t.closedAt?.startsWith(today)
    })
    .reduce((acc, t) => acc + (t.pnl || 0), 0)

  const unrealized = portfolio.value.reduce((acc, p) => acc + (p.unrealizedPnL || 0), 0)
  return realized + unrealized
})

function addNotification(notif: any) {
  // Prevent duplicate notifications
  const exists = notifications.value.some((n) => n.title === notif.title && n.message === notif.message)
  if (exists) return

  const id = Math.random().toString(36).substr(2, 9)
  notifications.value.push({ id, ...notif })
  setTimeout(() => {
    notifications.value = notifications.value.filter((n) => n.id !== id)
  }, 8000) // 8 seconds for important trade info
}

async function fetchHistory() {
  try {
    const data = await $fetch('/api/history')
    tradeHistory.value = data as any[]
  } catch (err: any) {
    console.error('Failed to fetch history:', err)
  }
}

async function fetchEvents() {
  try {
    const data = await $fetch('/api/events', {
      params: { symbol: symbol.value },
    })
    analyzerEvents.value = data as any[]
  } catch (err: any) {
    console.error('Failed to fetch analyzer events:', err)
  }
}

const isPanicSelling = ref(false)
async function panicSell() {
  if (!confirm('Are you sure you want to SQUARE OFF ALL positions?')) return

  try {
    isPanicSelling.value = true
    await $fetch('/api/square-off', { method: 'POST' })
    // The websocket will automatically update the portfolio state
    alert('Panic sell command sent successfully.')
  } catch (err: any) {
    console.error('Failed to panic sell:', err)
    alert('Failed to panic sell: ' + err.message)
  } finally {
    isPanicSelling.value = false
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (logsContainer.value) {
      logsContainer.value.scrollTop = logsContainer.value.scrollHeight
    }
  })
}

function toggleView(view: 'live' | 'history' | 'events') {
  currentView.value = view
  if (view === 'history') {
    fetchHistory()
  } else if (view === 'events') {
    fetchEvents()
  } else if (view === 'live') {
    nextTick(() => {
      if (chart && chartContainer.value) {
        chart.applyOptions({ width: chartContainer.value.clientWidth })
      }
    })
  }
}

function toggleTradeExpand(id: string) {
  expandedTradeId.value = expandedTradeId.value === id ? null : id
}

function formatDateIST(dateStr: string) {
  if (!dateStr) return '—'
  const date = new Date(dateStr + (dateStr.includes('T') && !dateStr.endsWith('Z') ? 'Z' : ''))
  return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
}

function formatTimeIST(dateStr: string) {
  if (!dateStr) return '—'
  const date = new Date(dateStr + (dateStr.includes('T') && !dateStr.endsWith('Z') ? 'Z' : ''))
  return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })
}

// Chart Refs
const chartContainer = ref<HTMLElement | null>(null)
let chart: IChartApi | null = null
let candleSeries: ISeriesApi<'Candlestick'> | null = null
let resistanceLine: any = null
let supportLine: any = null

// Current candle state for tick updates
const currentCandle = ref<any>(null)
const chartTimeframeStr = ref<string>('15m') // 5m, 15m, 30m, 1h

const activeTfStats = computed(() => {
  if (!analysisResult.value) return null
  return analysisResult.value[`tf${chartTimeframeStr.value}`] || null
})

// WebSocket
let ws: WebSocket | null = null
let reconnectTimer: any = null
let pingInterval: any = null
let isIntentionalClose = false

const session = useSupabaseSession()

function connectWebSocket() {
  if (ws) {
    isIntentionalClose = true
    ws.close()
  }
  isIntentionalClose = false

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${window.location.host}/websocket`)

  ws.onopen = () => {
    console.log('WS Connected, authenticating...')
    if (session.value?.access_token) {
      ws!.send(JSON.stringify({ type: 'auth', token: session.value.access_token }))
    } else {
      console.error('No Supabase session found for WebSocket auth')
    }

    // Keep connection alive
    clearInterval(pingInterval)
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.type === 'authenticated') {
      console.log('WS Authenticated successfully.')
      startWatching()
    } else if (msg.type === 'tick') {
      const price = msg.data.last_price
      livePrice.value = price
      updateChartFromTick(price, msg.data.gtiScore, msg.data.exchange_timestamp)
    } else if (msg.type === 'screener_update') {
      screenerData.value = msg.data
    } else if (msg.type === 'candidate_alert') {
      candidateAlerts.value.unshift(msg.data)
      if (candidateAlerts.value.length > 10) candidateAlerts.value.pop()
    } else if (msg.type === 'log') {
      serverLogs.value.push(msg.data)
      if (serverLogs.value.length > 1000) serverLogs.value.shift()
      if (currentView.value === 'logs') {
        scrollToBottom()
      }
    } else if (msg.type === 'analysis') {
      analysisResult.value = msg.data
      if (!chart) {
        initChart()
      }

      if (!resistanceLine && !supportLine && candleSeries && analysisResult.value) {
        const { resistance, support } = analysisResult.value.tf15m
        resistanceLine = candleSeries.createPriceLine({
          price: resistance,
          color: '#ef4444',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'RESISTANCE',
        })
        supportLine = candleSeries.createPriceLine({
          price: support,
          color: '#22c55e',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'SUPPORT',
        })
      }

      updateChartDataForTimeframe()

      // Update resistance and support lines dynamically
      if (analysisResult.value && candleSeries) {
        const { resistance, support } = analysisResult.value.tf15m
        if (resistanceLine) {
          resistanceLine.applyOptions({ price: resistance })
        }
        if (supportLine) {
          supportLine.applyOptions({ price: support })
        }
      }
    } else if (msg.type === 'agent_update') {
      const { agent, status, message, data } = msg.data
      agents.value[agent] = {
        status,
        message,
        data,
        lastUpdate: Date.now(),
      }
    } else if (msg.type === 'breakout') {
      breakouts.value.unshift(msg.data)
      if (breakouts.value.length > 5) breakouts.value.pop()
      addNotification({
        title: '⚠️ Breakout Detected',
        message: msg.data.reason,
        type: 'warning',
      })
    } else if (msg.type === 'portfolio') {
      portfolio.value = msg.data
      // We removed fetchHistory() here because portfolio updates on every tick (PnL update),
      // which causes an infinite loop of network requests and freezes the UI!

      // Auto-alert for aggressive institutional flow from last analysis
      const topSC = analysisResult.value?.optionsAnalysis?.windowStats?.topShortCovering
      const analysisTime = analysisResult.value?.optionsAnalysis?.windowSnapshot?.timestamp || Date.now()

      if (topSC && topSC.length > 0 && analysisTime > lastInstitutionalAlertAt.value) {
        const best = topSC[0]
        if (Math.abs(best.intervalOi) > 50000) {
          lastInstitutionalAlertAt.value = analysisTime
          addNotification({
            title: '🔥 Institutional Action',
            message: `Aggressive Short Covering on ${best.strike} ${best.type} detected!`,
            type: 'warning',
          })
        }
      }
    } else if (msg.type === 'notification') {
      addNotification(msg.data)

      // Add marker to chart if it's a trade execution
      if (msg.data.details && candleSeries) {
        const { side, price } = msg.data.details
        const markers = candleSeries.getMarkers() || []
        markers.push({
          time: Math.floor(Date.now() / 1000) as any,
          position: side === 'BUY' ? 'belowBar' : 'aboveBar',
          color: side === 'BUY' ? '#22c55e' : '#ef4444',
          shape: side === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: side === 'BUY' ? 'BUY' : 'SELL',
        })
        candleSeries.setMarkers(markers)

        // Refresh history safely ONLY when a trade opens or closes
        fetchHistory()
      }
    } else if (msg.type === 'market_closed') {
      addNotification({
        title: '🏁 Market Closed',
        message: msg.message,
        type: 'info',
      })
    }
  }

  ws.onclose = () => {
    clearInterval(pingInterval)
    console.log('WS Closed.')
    if (!isIntentionalClose) {
      console.log('Attempting to reconnect in 3 seconds...')
      clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => {
        connectWebSocket()
      }, 3000)
    }
  }
}

function startWatching() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'watch',
        data: {
          symbol: symbol.value,
          mode: mode.value,
          levels: analysisResult.value
            ? {
                resistance: analysisResult.value.tf15m.resistance,
                support: analysisResult.value.tf15m.support,
                vwap: analysisResult.value.tf15m.vwap,
              }
            : undefined,
        },
      })
    )
  }
}

async function fetchInitialData() {
  try {
    const data: any = await $fetch('/api/chart-data', { params: { symbol: symbol.value } })
    isMarketOpen.value = data.isMarketOpen
    marketStatusMessage.value = data.marketStatusMessage

    const last15m = data.candles15m[data.candles15m.length - 1]

    analysisResult.value = {
      tf15m: { price: last15m?.close || 0 }, // fake levels so it doesn't crash but allows drawing
      candles1h: data.candles1h,
      candles30m: data.candles30m,
      candles15m: data.candles15m,
      candles5m: data.candles5m || data.candles15m,
    }

    if (!chart) initChart()
    updateChartDataForTimeframe()

    fetchHistory()
    fetchEvents()
  } catch (err: any) {
    console.error('Failed to load initial data', err)
  }
}

async function runAnalysis() {
  if (!symbol.value) return

  loading.value = true
  error.value = null
  breakouts.value = []

  try {
    const data = await $fetch('/api/analyze', {
      method: 'POST',
      body: {
        symbol: symbol.value.toUpperCase(),
        mode: mode.value,
      },
    })
    analysisResult.value = data
    if (!chart) {
      initChart()
    }
    startWatching()

    // Setup chart with correct timeframe data
    updateChartDataForTimeframe()

    // Refresh history if we are on that view
    if (currentView.value === 'history') fetchHistory()
  } catch (err: any) {
    error.value = err.statusMessage || 'Failed to run analysis'
    console.error(err)
  } finally {
    loading.value = false
  }
}

function initChart() {
  if (!chartContainer.value) return
  if (chart) {
    chart.remove()
  }

  chart = createChart(chartContainer.value, {
    localization: {
      timeFormatter: (time: number) => {
        const date = new Date(time * 1000)
        return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
      },
    },
    layout: {
      background: { color: '#ffffff' },
      textColor: '#333',
    },
    grid: {
      vertLines: { color: '#f0f0f0' },
      horzLines: { color: '#f0f0f0' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: '#f0f0f0',
      autoScale: true,
    },
    timeScale: {
      borderColor: '#f0f0f0',
      timeVisible: true,
      secondsVisible: true,
      tickMarkFormatter: (time: number) => {
        const date = new Date(time * 1000)
        return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
      },
    },
    width: chartContainer.value.clientWidth,
    height: 400,
  })

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderVisible: false,
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    priceFormat: {
      type: 'price',
      precision: 2,
      minMove: 0.05,
    },
  })

  if (analysisResult.value && analysisResult.value.tf15m && analysisResult.value.tf15m.resistance) {
    const { resistance, support } = analysisResult.value.tf15m

    // Custom price lines for levels
    resistanceLine = candleSeries.createPriceLine({
      price: resistance,
      color: '#ef4444',
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: 'RESISTANCE',
    })

    supportLine = candleSeries.createPriceLine({
      price: support,
      color: '#22c55e',
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: 'SUPPORT',
    })
  }
}

function getGtiColors(gtiScore: any | undefined, isUp: boolean) {
  // Default colors
  let color = isUp ? '#22c55e' : '#ef4444'

  if (!gtiScore) return { color, wickColor: color }

  // Apply GTI institutional coloring
  const score = gtiScore.composite || 0

  if (score > 0.6) {
    color = '#3b82f6' // Strong Institutional Buy (Blue)
  } else if (score > 0.2) {
    color = '#10b981' // Institutional Buy (Emerald)
  } else if (score < -0.6) {
    color = '#9333ea' // Strong Institutional Sell (Purple)
  } else if (score < -0.2) {
    color = '#f43f5e' // Institutional Sell (Rose)
  } else {
    color = isUp ? '#22c55e' : '#ef4444' // Standard colors for Neutral
  }

  return { color, wickColor: color }
}

function updateChartDataForTimeframe() {
  if (!analysisResult.value || !candleSeries) return

  const key = `candles${chartTimeframeStr.value}`
  const candles = analysisResult.value[key]

  if (!candles || candles.length === 0) return

  const gtiHistory = analysisResult.value.gtiHistory || []

  const formattedData = candles.map((c: any) => {
    const isUp = c.close >= c.open
    // Find matching GTI score for this candle time if available
    const gtiMatch = gtiHistory.find((g: any) => g.time === c.time)
    const { color, wickColor } = getGtiColors(gtiMatch?.gtiScore, isUp)

    return {
      time: c.time as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      color,
      wickColor,
    }
  })

  candleSeries.setData(formattedData)

  // Set current candle to the last one
  const last = formattedData[formattedData.length - 1]
  if (last) {
    currentCandle.value = { ...last }
  } else {
    currentCandle.value = null
  }
}

function updateChartFromTick(price: number, gtiScore?: any, tickTimestamp?: string) {
  if (!candleSeries) return

  // Use tick timestamp if available, else fallback to Date.now
  const tickTimeMs = tickTimestamp ? new Date(tickTimestamp).getTime() : Date.now()
  const now = Math.floor(tickTimeMs / 1000)

  const tfMap: Record<string, number> = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600 }
  const bucketSecs = tfMap[chartTimeframeStr.value] || 900

  if (!currentCandle.value) {
    const isUp = true
    const { color, wickColor } = getGtiColors(gtiScore, isUp)
    currentCandle.value = {
      time: (now - (now % bucketSecs)) as any,
      open: price,
      high: price,
      low: price,
      close: price,
      color,
      wickColor,
    }
  }

  // Check if we need to roll over to a new candle
  if (now >= currentCandle.value.time + bucketSecs) {
    const bucketsPassed = Math.floor((now - currentCandle.value.time) / bucketSecs)
    const newCandleTime = currentCandle.value.time + bucketsPassed * bucketSecs

    currentCandle.value = {
      time: newCandleTime as any,
      open: price,
      high: price,
      low: price,
      close: price,
      color: currentCandle.value.color,
      wickColor: currentCandle.value.wickColor,
    }
  } else {
    // Update current candle OHLC
    currentCandle.value.close = price
    if (price > currentCandle.value.high) currentCandle.value.high = price
    if (price < currentCandle.value.low) currentCandle.value.low = price
  }

  // Apply live GTI colors if available
  const isUp = currentCandle.value.close >= currentCandle.value.open
  const { color, wickColor } = getGtiColors(gtiScore, isUp)

  currentCandle.value.color = color
  currentCandle.value.wickColor = wickColor

  candleSeries.update(currentCandle.value)
}

function changeTimeframe(tf: string) {
  chartTimeframeStr.value = tf
  updateChartDataForTimeframe()

  // Update WS subscription for timeframe
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Re-send watch command with new timeframe
    const tfMap: Record<string, number> = { '5m': 5, '15m': 15, '30m': 30, '1h': 60 }
    ws.send(
      JSON.stringify({
        type: 'watch',
        data: {
          symbol: symbol.value,
          mode: mode.value,
          chartTimeframe: tfMap[tf] || 15,
        },
      })
    )
  }
}

function getDecisionColor(decision: string) {
  switch (decision?.toUpperCase()) {
    case 'BUY':
      return 'text-green-500 bg-green-50'
    case 'SELL':
      return 'text-red-500 bg-red-50'
    default:
      return 'text-gray-500 bg-gray-50'
  }
}

const computedLogs = computed(() => {
  if (analyzerEvents.value && analyzerEvents.value.length > 0) {
    return analyzerEvents.value.slice(0, 20).map((e: any) => ({
      time: e.timestamp
        ? new Date(e.timestamp).toLocaleTimeString([], { hour12: false })
        : new Date().toLocaleTimeString([], { hour12: false }),
      tag: e.event_type || 'ENGINE',
      message: e.message || (typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload || '')),
      tagColor:
        e.event_type === 'TRADE_SIGNAL'
          ? 'text-emerald-400'
          : e.event_type === 'RISK_ALERT'
            ? 'text-rose-400'
            : 'text-indigo-400',
    }))
  }
  return [
    {
      time: new Date().toLocaleTimeString([], { hour12: false }),
      tag: 'SYSTEM',
      message: 'WebSocket connected. Engine standing by.',
      tagColor: 'text-indigo-400',
    },
  ]
})

onMounted(() => {
  nextTick(() => {
    initChart()
  })
  fetchInitialData()
  connectWebSocket()

  window.addEventListener('resize', () => {
    if (chart && chartContainer.value) {
      chart.applyOptions({ width: chartContainer.value.clientWidth })
    }
  })
})

onUnmounted(() => {
  isIntentionalClose = true
  if (ws) ws.close()
  clearTimeout(reconnectTimer)
  clearInterval(pingInterval)
})
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 font-sans">
    <AutonomousCockpit
      :symbol="symbol"
      :live-price="livePrice"
      :price-change="analysisResult?.priceChange || 112.30"
      :price-change-pct="analysisResult?.priceChangePct || 0.47"
      :daily-pnl="dailyPnl"
      :portfolio="portfolio"
      :trade-history="tradeHistory"
      :event-logs="computedLogs"
      :is-market-open="isMarketOpen"
      :vix="analysisResult?.vix || 13.24"
      @panic-square-off="panicSell"
      @symbol-change="focusStock"
      @select-stock="focusStock"
    />

    <!-- Notifications Toast -->
    <div class="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
      <div
        v-for="n in notifications"
        :key="n.id"
        class="pointer-events-auto bg-slate-900 border border-slate-700 text-slate-100 rounded-2xl shadow-2xl p-4 min-w-[320px] max-w-md animate-in slide-in-from-right duration-300 border-l-4"
        :class="{
          'border-l-emerald-500': n.type === 'success',
          'border-l-rose-500': n.type === 'error',
          'border-l-amber-500': n.type === 'warning',
          'border-l-indigo-500': n.type === 'info',
        }"
      >
        <div class="flex items-start gap-3">
          <div
            :class="{
              'text-emerald-400': n.type === 'success',
              'text-rose-400': n.type === 'error',
              'text-amber-400': n.type === 'warning',
              'text-indigo-400': n.type === 'info',
            }"
          >
            <Zap v-if="n.type === 'warning'" class="w-5 h-5" />
            <ShieldCheck v-else-if="n.type === 'success'" class="w-5 h-5" />
            <AlertCircle v-else-if="n.type === 'error'" class="w-5 h-5" />
            <Info v-else class="w-5 h-5" />
          </div>
          <div class="flex-1">
            <h4 class="text-sm font-bold text-white">{{ n.title }}</h4>
            <p class="text-xs text-slate-400 mt-1 leading-relaxed">{{ n.message }}</p>

            <div v-if="n.details" class="mt-3 grid grid-cols-2 gap-2 p-2 bg-slate-800/60 rounded-lg border border-slate-700">
              <div v-if="n.details.price">
                <div class="text-[9px] text-slate-400 font-bold uppercase">Price</div>
                <div class="text-[11px] font-mono font-bold text-white">
                  {{ n.details.price.toFixed(2) }}
                </div>
              </div>
              <div v-if="n.details.stopLoss">
                <div class="text-[9px] text-rose-400 font-bold uppercase">Stop Loss</div>
                <div class="text-[11px] font-mono font-bold text-rose-400">
                  {{ n.details.stopLoss.toFixed(2) }}
                </div>
              </div>
              <div v-if="n.details.target">
                <div class="text-[9px] text-emerald-400 font-bold uppercase">Target</div>
                <div class="text-[11px] font-mono font-bold text-emerald-400">
                  {{ n.details.target.toFixed(2) }}
                </div>
              </div>
            </div>
          </div>
          <button
            @click="notifications = notifications.filter((x) => x.id !== n.id)"
            class="text-slate-500 hover:text-slate-300"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

body {
  font-family: 'Inter', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.animate-in {
  animation: animate-in 0.5s ease-out;
}

@keyframes animate-in {
  from {
    opacity: 0;
    transform: translateX(10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
