<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, watchEffect, nextTick, computed } from "vue"

const user = useSupabaseUser()
watchEffect(() => {
  if (!user.value) {
    navigateTo("/login")
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
} from "@lucide/vue"
import { createChart, CandlestickSeries, CrosshairMode } from "lightweight-charts"
import type { IChartApi, ISeriesApi } from "lightweight-charts"

const symbol = ref("NIFTY")
const mode = ref<"intraday" | "swing">("intraday")
const loading = ref(false)
const analysisResult = ref<any>(null)
const error = ref<string | null>(null)
const livePrice = ref<number | null>(null)
const breakouts = ref<any[]>([])
const portfolio = ref<any[]>([])
const tradeHistory = ref<any[]>([])
const analyzerEvents = ref<any[]>([])
const currentView = ref<"live" | "history" | "events" | "logs">("live")
const expandedTradeId = ref<string | null>(null)
const supabase = useSupabaseClient()
const isLoggingOut = ref(false)

const handleLogout = async () => {
  try {
    isLoggingOut.value = true
    await supabase.auth.signOut()
    navigateTo("/login")
  } catch (error) {
    console.error("Error logging out:", error)
  } finally {
    isLoggingOut.value = false
  }
}

const notifications = ref<any[]>([])
const serverLogs = ref<string[]>([])
const logsContainer = ref<HTMLElement | null>(null)
const lastInstitutionalAlertAt = ref(0)
const isMarketOpen = ref<boolean>(true)
const marketStatusMessage = ref<string>("Checking market status...")

const agents = ref<Record<string, any>>({
  Orchestrator: { status: "idle", message: "Awaiting market data...", lastUpdate: Date.now() },
  "Regime Validator": { status: "idle", message: "Awaiting orchestrator...", lastUpdate: Date.now() },
  SCALPER: { status: "idle", message: "Awaiting signal...", lastUpdate: Date.now() },
  TREND: { status: "idle", message: "Awaiting trend...", lastUpdate: Date.now() },
  "Risk Manager": { status: "idle", message: "No active positions.", lastUpdate: Date.now() },
})

const activeSpecialist = computed(() => {
  if (agents.value["TREND"] && agents.value["TREND"].status !== "idle") return "TREND"
  if (agents.value["SCALPER"] && agents.value["SCALPER"].status !== "idle") return "SCALPER"
  if (
    agents.value["TREND"] &&
    agents.value["SCALPER"] &&
    agents.value["TREND"].lastUpdate > agents.value["SCALPER"].lastUpdate
  )
    return "TREND"
  return "SCALPER"
})

const selectedAgentForDetail = ref<string | null>(null)

const dailyPnl = computed(() => {
  const realized = tradeHistory.value
    .filter((t) => {
      const today = new Date().toISOString().split("T")[0]
      return t.status === "CLOSED" && t.closedAt?.startsWith(today)
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
    const data = await $fetch("/api/history")
    tradeHistory.value = data as any[]
  } catch (err: any) {
    console.error("Failed to fetch history:", err)
  }
}

async function fetchEvents() {
  try {
    const data = await $fetch("/api/events", {
      params: { symbol: symbol.value },
    })
    analyzerEvents.value = data as any[]
  } catch (err: any) {
    console.error("Failed to fetch analyzer events:", err)
  }
}

const isPanicSelling = ref(false)
async function panicSell() {
  if (!confirm("Are you sure you want to SQUARE OFF ALL positions?")) return
  
  try {
    isPanicSelling.value = true
    await $fetch("/api/square-off", { method: "POST" })
    // The websocket will automatically update the portfolio state
    alert("Panic sell command sent successfully.")
  } catch (err: any) {
    console.error("Failed to panic sell:", err)
    alert("Failed to panic sell: " + err.message)
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

function toggleView(view: "live" | "history" | "events") {
  currentView.value = view
  if (view === "history") {
    fetchHistory()
  } else if (view === "events") {
    fetchEvents()
  } else if (view === "live") {
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
  if (!dateStr) return "—"
  const date = new Date(dateStr + (dateStr.includes("T") && !dateStr.endsWith("Z") ? "Z" : ""))
  return date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })
}

function formatTimeIST(dateStr: string) {
  if (!dateStr) return "—"
  const date = new Date(dateStr + (dateStr.includes("T") && !dateStr.endsWith("Z") ? "Z" : ""))
  return date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: true })
}

// Chart Refs
const chartContainer = ref<HTMLElement | null>(null)
let chart: IChartApi | null = null
let candleSeries: ISeriesApi<"Candlestick"> | null = null
let resistanceLine: any = null
let supportLine: any = null

// Current candle state for tick updates
const currentCandle = ref<any>(null)
const chartTimeframeStr = ref<string>("15m") // 3m, 15m, 30m, 1h

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

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  ws = new WebSocket(`${protocol}//${window.location.host}/websocket`)

  ws.onopen = () => {
    console.log("WS Connected, authenticating...")
    if (session.value?.access_token) {
      ws!.send(JSON.stringify({ type: "auth", token: session.value.access_token }))
    } else {
      console.error("No Supabase session found for WebSocket auth")
    }

    // Keep connection alive
    clearInterval(pingInterval)
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }))
      }
    }, 30000)
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.type === "authenticated") {
      console.log("WS Authenticated successfully.")
      startWatching()
    } else if (msg.type === "tick") {
      const price = msg.data.last_price
      livePrice.value = price
      updateChartFromTick(price, msg.data.gtiScore, msg.data.exchange_timestamp)
    } else if (msg.type === "log") {
      serverLogs.value.push(msg.data)
      if (serverLogs.value.length > 1000) serverLogs.value.shift()
      if (currentView.value === "logs") {
        scrollToBottom()
      }
    } else if (msg.type === "analysis") {
      analysisResult.value = msg.data
      if (!chart) {
        initChart()
      }

      if (!resistanceLine && !supportLine && candleSeries && analysisResult.value) {
        const { resistance, support } = analysisResult.value.tf15m
        resistanceLine = candleSeries.createPriceLine({
          price: resistance,
          color: "#ef4444",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "RESISTANCE",
        })
        supportLine = candleSeries.createPriceLine({
          price: support,
          color: "#22c55e",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "SUPPORT",
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
    } else if (msg.type === "agent_update") {
      const { agent, status, message, data } = msg.data
      agents.value[agent] = {
        status,
        message,
        data,
        lastUpdate: Date.now(),
      }
    } else if (msg.type === "breakout") {
      breakouts.value.unshift(msg.data)
      if (breakouts.value.length > 5) breakouts.value.pop()
      addNotification({
        title: "⚠️ Breakout Detected",
        message: msg.data.reason,
        type: "warning",
      })
    } else if (msg.type === "portfolio") {
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
            title: "🔥 Institutional Action",
            message: `Aggressive Short Covering on ${best.strike} ${best.type} detected!`,
            type: "warning",
          })
        }
      }
    } else if (msg.type === "notification") {
      addNotification(msg.data)

      // Add marker to chart if it's a trade execution
      if (msg.data.details && candleSeries) {
        const { side, price } = msg.data.details
        const markers = candleSeries.getMarkers() || []
        markers.push({
          time: Math.floor(Date.now() / 1000) as any,
          position: side === "BUY" ? "belowBar" : "aboveBar",
          color: side === "BUY" ? "#22c55e" : "#ef4444",
          shape: side === "BUY" ? "arrowUp" : "arrowDown",
          text: side === "BUY" ? "BUY" : "SELL",
        })
        candleSeries.setMarkers(markers)

        // Refresh history safely ONLY when a trade opens or closes
        fetchHistory()
      }
    } else if (msg.type === "market_closed") {
      addNotification({
        title: "🏁 Market Closed",
        message: msg.message,
        type: "info",
      })
    }
  }

  ws.onclose = () => {
    clearInterval(pingInterval)
    console.log("WS Closed.")
    if (!isIntentionalClose) {
      console.log("Attempting to reconnect in 3 seconds...")
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
        type: "watch",
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
    const data: any = await $fetch("/api/chart-data", { params: { symbol: symbol.value } })
    isMarketOpen.value = data.isMarketOpen
    marketStatusMessage.value = data.marketStatusMessage

    const last15m = data.candles15m[data.candles15m.length - 1]

    analysisResult.value = {
      tf15m: { price: last15m?.close || 0 }, // fake levels so it doesn't crash but allows drawing
      candles1h: data.candles1h,
      candles30m: data.candles30m,
      candles15m: data.candles15m,
      candles3m: data.candles3m,
    }

    if (!chart) initChart()
    updateChartDataForTimeframe()

    fetchHistory()
    fetchEvents()
  } catch (err: any) {
    console.error("Failed to load initial data", err)
  }
}

async function runAnalysis() {
  if (!symbol.value) return

  loading.value = true
  error.value = null
  breakouts.value = []

  try {
    const data = await $fetch("/api/analyze", {
      method: "POST",
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
    if (currentView.value === "history") fetchHistory()
  } catch (err: any) {
    error.value = err.statusMessage || "Failed to run analysis"
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
        return date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })
      },
    },
    layout: {
      background: { color: "#ffffff" },
      textColor: "#333",
    },
    grid: {
      vertLines: { color: "#f0f0f0" },
      horzLines: { color: "#f0f0f0" },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: "#f0f0f0",
      autoScale: true,
    },
    timeScale: {
      borderColor: "#f0f0f0",
      timeVisible: true,
      secondsVisible: true,
      tickMarkFormatter: (time: number) => {
        const date = new Date(time * 1000)
        return date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })
      },
    },
    width: chartContainer.value.clientWidth,
    height: 400,
  })

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: "#22c55e",
    downColor: "#ef4444",
    borderVisible: false,
    wickUpColor: "#22c55e",
    wickDownColor: "#ef4444",
    priceFormat: {
      type: "price",
      precision: 2,
      minMove: 0.05,
    },
  })

  if (analysisResult.value && analysisResult.value.tf15m && analysisResult.value.tf15m.resistance) {
    const { resistance, support } = analysisResult.value.tf15m

    // Custom price lines for levels
    resistanceLine = candleSeries.createPriceLine({
      price: resistance,
      color: "#ef4444",
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: "RESISTANCE",
    })

    supportLine = candleSeries.createPriceLine({
      price: support,
      color: "#22c55e",
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: "SUPPORT",
    })
  }
}

function getGtiColors(gtiScore: any | undefined, isUp: boolean) {
  // Default colors
  let color = isUp ? "#22c55e" : "#ef4444"

  if (!gtiScore) return { color, wickColor: color }

  // Apply GTI institutional coloring
  const score = gtiScore.composite || 0

  if (score > 0.6) {
    color = "#3b82f6" // Strong Institutional Buy (Blue)
  } else if (score > 0.2) {
    color = "#10b981" // Institutional Buy (Emerald)
  } else if (score < -0.6) {
    color = "#9333ea" // Strong Institutional Sell (Purple)
  } else if (score < -0.2) {
    color = "#f43f5e" // Institutional Sell (Rose)
  } else {
    color = isUp ? "#22c55e" : "#ef4444" // Standard colors for Neutral
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

  const tfMap: Record<string, number> = { "3m": 180, "15m": 900, "30m": 1800, "1h": 3600 }
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
    const tfMap: Record<string, number> = { "3m": 3, "15m": 15, "30m": 30, "1h": 60 }
    ws.send(
      JSON.stringify({
        type: "watch",
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
    case "BUY":
      return "text-green-500 bg-green-50"
    case "SELL":
      return "text-red-500 bg-red-50"
    default:
      return "text-gray-500 bg-gray-50"
  }
}

onMounted(() => {
  nextTick(() => {
    initChart()
  })
  fetchInitialData()
  connectWebSocket()

  window.addEventListener("resize", () => {
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
  <div class="min-h-screen bg-gray-50 text-gray-900 font-sans">
    <!-- Header -->
    <header class="bg-white border-b border-gray-200 sticky top-0 z-20">
      <div
        class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div class="flex items-center gap-2">
          <div class="bg-indigo-600 p-2 rounded-lg">
            <Activity class="w-6 h-6 text-white" />
          </div>
          <div class="flex flex-col">
            <h1 class="text-xl font-bold tracking-tight text-gray-900">Trading Assistant</h1>
            <span class="text-xs font-medium" :class="isMarketOpen ? 'text-green-600' : 'text-amber-600'">{{
              marketStatusMessage
            }}</span>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <nav class="flex p-1 bg-gray-100 rounded-xl">
          <button
            @click="toggleView('live')"
            class="px-4 py-2 text-sm font-bold rounded-lg transition-all"
            :class="currentView === 'live' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
          >
            Live Analysis
          </button>
          <button
            @click="toggleView('history')"
            class="px-4 py-2 text-sm font-bold rounded-lg transition-all"
            :class="
              currentView === 'history' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            "
          >
            Trade History
          </button>
          <button
            @click="toggleView('events')"
            class="px-4 py-2 text-sm font-bold rounded-lg transition-all"
            :class="
              currentView === 'events' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            "
          >
            Analyzer Events
          </button>
        </nav>

        <div class="flex items-center gap-3">
          <div class="relative flex-1 md:w-64">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              v-model="symbol"
              type="text"
              placeholder="Enter Symbol (e.g. NIFTY)"
              class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              @keyup.enter="runAnalysis"
            />
          </div>

          <select
            v-model="mode"
            class="px-4 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          >
            <option value="intraday">Intraday</option>
            <option value="swing">Swing</option>
          </select>

          <button
            @click="runAnalysis"
            :disabled="loading || !isMarketOpen"
            :title="isMarketOpen ? '' : 'Analysis unavailable during market close hours.'"
            class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <span
              v-if="loading"
              class="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"
            ></span>
            {{ loading ? "Analyzing..." : "Analyze" }}
          </button>
          
          <div class="h-8 w-px bg-gray-200 mx-1"></div>

          <a
            href="/api/auth/kite/login"
            class="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
            title="Refresh Kite Token"
          >
            <RefreshCcw class="w-5 h-5" />
          </a>

          <NuxtLink
            to="/profile"
            class="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Settings & Profile"
          >
            <Settings class="w-5 h-5" />
          </NuxtLink>

          <button
            @click="handleLogout"
            :disabled="isLoggingOut"
            class="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Logout"
          >
            <LogOut class="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Error Message -->
      <div v-if="error" class="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700">
        <AlertCircle class="w-5 h-5 shrink-0 mt-0.5" />
        <div class="flex-1 flex items-center justify-between">
          <div>
            <h3 class="font-semibold">Analysis Failed</h3>
            <p class="text-sm opacity-90">{{ error }}</p>
          </div>
          <a
            v-if="error.toLowerCase().includes('token') || error.toLowerCase().includes('linked')"
            href="/api/auth/kite/login"
            class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Zap class="w-4 h-4" />
            Reconnect Zerodha
          </a>
        </div>
      </div>

      <!-- Live View -->
      <div v-show="currentView === 'live'">
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <!-- Main Content -->
          <div class="lg:col-span-2 space-y-8">
            <!-- Chart Card -->
            <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div class="p-4 border-b border-gray-100 flex items-center justify-between">
                <div class="flex items-center gap-4">
                  <h3 class="text-sm font-bold text-gray-500 uppercase flex items-center gap-2">
                    <BarChart2 class="w-4 h-4 text-indigo-500" />
                    Live Chart
                  </h3>
                  <!-- Timeframe selector -->
                  <div class="flex bg-gray-100 rounded-lg p-0.5">
                    <button
                      v-for="tf in ['3m', '15m', '30m', '1h']"
                      :key="tf"
                      @click="changeTimeframe(tf)"
                      class="px-2 py-1 text-xs font-bold rounded-md transition-colors"
                      :class="
                        chartTimeframeStr === tf
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      "
                    >
                      {{ tf }}
                    </button>
                  </div>
                </div>
                <div v-if="livePrice" class="flex items-center gap-2">
                  <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  <span class="text-sm font-mono font-bold">{{ livePrice.toFixed(2) }}</span>
                </div>
              </div>

              <!-- GTI Legend -->
              <div class="px-4 py-2 bg-gray-50/50 border-b border-gray-100 flex items-center gap-4 overflow-x-auto">
                <span class="text-[10px] font-black uppercase text-gray-400 tracking-widest flex items-center gap-1">
                  <ShieldCheck class="w-3 h-3" /> GTI Flow:
                </span>
                <div class="flex items-center gap-3 text-[10px] font-bold text-gray-600 whitespace-nowrap">
                  <span class="flex items-center gap-1"
                    ><div class="w-2 h-2 rounded bg-blue-500"></div>
                    Strong Buy</span
                  >
                  <span class="flex items-center gap-1"
                    ><div class="w-2 h-2 rounded bg-emerald-500"></div>
                    Buy</span
                  >
                  <span class="flex items-center gap-1"
                    ><div class="w-2 h-2 rounded bg-rose-500"></div>
                    Sell</span
                  >
                  <span class="flex items-center gap-1"
                    ><div class="w-2 h-2 rounded bg-purple-600"></div>
                    Strong Sell</span
                  >
                </div>
              </div>

              <div ref="chartContainer" class="w-full"></div>
            </div>

            <!-- Agent Status Branching Pipeline Map -->
            <div class="bg-gray-50/50 rounded-2xl p-4 border border-gray-100 overflow-x-auto custom-scrollbar">
              <div class="flex items-center min-w-max justify-center">
                <!-- 1. Orchestrator -->
                <AgentCard
                  name="Orchestrator"
                  :agent="agents['Orchestrator']"
                  :isActive="true"
                  @click="selectedAgentForDetail = 'Orchestrator'"
                />

                <!-- Wire -->
                <div class="flex items-center justify-center shrink-0 w-6 relative">
                  <div class="h-[2px] w-full bg-indigo-200"></div>
                  <ChevronRight class="absolute -right-2 w-3 h-3 text-indigo-300" />
                </div>

                <!-- 2. Regime Validator -->
                <AgentCard
                  name="Regime Validator"
                  :agent="agents['Regime Validator']"
                  :isActive="true"
                  @click="selectedAgentForDetail = 'Regime Validator'"
                />

                <!-- Split to Scalper/Trend -->
                <div class="flex items-center shrink-0 w-8 h-28 relative">
                  <!-- Top branch -->
                  <div
                    class="absolute top-1/4 left-0 w-full h-[50%] border-t-2 border-l-2 rounded-tl-xl transition-colors duration-300"
                    :class="activeSpecialist === 'SCALPER' ? 'border-indigo-400' : 'border-gray-200'"
                  ></div>
                  <!-- Bottom branch -->
                  <div
                    class="absolute bottom-1/4 left-0 w-full h-[50%] border-b-2 border-l-2 rounded-bl-xl transition-colors duration-300"
                    :class="activeSpecialist === 'TREND' ? 'border-indigo-400' : 'border-gray-200'"
                  ></div>

                  <ChevronRight
                    class="absolute right-0 top-1/4 -mt-1.5 -mr-1 w-3 h-3 transition-colors duration-300 bg-gray-50/50"
                    :class="activeSpecialist === 'SCALPER' ? 'text-indigo-500' : 'text-gray-300'"
                  />
                  <ChevronRight
                    class="absolute right-0 bottom-1/4 -mb-1.5 -mr-1 w-3 h-3 transition-colors duration-300 bg-gray-50/50"
                    :class="activeSpecialist === 'TREND' ? 'text-indigo-500' : 'text-gray-300'"
                  />
                </div>

                <!-- 3. Parallel Agents (Scalper & Trend) -->
                <div class="flex flex-col gap-2 shrink-0 z-10">
                  <AgentCard
                    name="SCALPER"
                    :agent="agents['SCALPER']"
                    :isActive="activeSpecialist === 'SCALPER'"
                    @click="selectedAgentForDetail = 'SCALPER'"
                  />
                  <AgentCard
                    name="TREND"
                    :agent="agents['TREND']"
                    :isActive="activeSpecialist === 'TREND'"
                    @click="selectedAgentForDetail = 'TREND'"
                  />
                </div>

                <!-- Merge back -->
                <div class="flex items-center shrink-0 w-8 h-28 relative">
                  <!-- Top branch -->
                  <div
                    class="absolute top-1/4 right-0 w-full h-[50%] border-t-2 border-r-2 rounded-tr-xl transition-colors duration-300"
                    :class="activeSpecialist === 'SCALPER' ? 'border-indigo-400' : 'border-gray-200'"
                  ></div>
                  <!-- Bottom branch -->
                  <div
                    class="absolute bottom-1/4 right-0 w-full h-[50%] border-b-2 border-r-2 rounded-br-xl transition-colors duration-300"
                    :class="activeSpecialist === 'TREND' ? 'border-indigo-400' : 'border-gray-200'"
                  ></div>

                  <!-- Center merge wire -->
                  <div
                    class="absolute top-1/2 left-0 w-full h-[2px] -mt-[1px]"
                    :class="
                      activeSpecialist === 'SCALPER' || activeSpecialist === 'TREND' ? 'bg-indigo-300' : 'bg-gray-200'
                    "
                  ></div>
                  <ChevronRight
                    class="absolute -right-1.5 top-1/2 -mt-1.5 w-3 h-3"
                    :class="
                      activeSpecialist === 'SCALPER' || activeSpecialist === 'TREND'
                        ? 'text-indigo-400'
                        : 'text-gray-300'
                    "
                  />
                </div>

                <!-- 4. Risk Manager -->
                <AgentCard
                  name="Risk Manager"
                  :agent="agents['Risk Manager']"
                  :isActive="true"
                  @click="selectedAgentForDetail = 'Risk Manager'"
                />
              </div>
            </div>
          </div>

          <!-- Sidebar Details -->
          <div v-if="analysisResult" class="space-y-8">
            <!-- Paper Portfolio -->
            <div
              v-if="portfolio.length > 0"
              class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
            >
              <div class="p-4 bg-indigo-50 border-b border-indigo-100">
                <div class="flex items-center justify-between">
                  <h3 class="text-sm font-bold text-indigo-700 uppercase flex items-center gap-2">
                    <ShieldCheck class="w-4 h-4" />
                    Paper Portfolio
                  </h3>
                  <button
                    @click="panicSell"
                    :disabled="isPanicSelling"
                    class="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded shadow-sm disabled:opacity-50 transition-colors flex items-center gap-1"
                  >
                    <span v-if="isPanicSelling">Squaring Off...</span>
                    <span v-else>PANIC SELL ALL</span>
                  </button>
                </div>
              </div>
              <div class="p-4 space-y-4">
                <div
                  v-for="pos in portfolio"
                  :key="pos.symbol"
                  class="p-4 bg-gray-50 rounded-xl border border-gray-100"
                >
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-black text-gray-900">{{ pos.symbol }}</span>
                    <span
                      class="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
                      :class="pos.unrealizedPnL >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'"
                    >
                      {{ pos.unrealizedPnL >= 0 ? "+" : "" }}{{ pos.unrealizedPnL.toFixed(2) }}
                    </span>
                  </div>
                  <div class="grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <div class="text-gray-400 uppercase font-bold">Qty</div>
                      <div class="font-bold">{{ pos.quantity }}</div>
                    </div>
                    <div>
                      <div class="text-gray-400 uppercase font-bold">Avg Entry</div>
                      <div class="font-bold">
                        {{ pos.avgEntryPrice.toFixed(2) }}
                      </div>
                    </div>
                    <div>
                      <div class="text-gray-400 uppercase font-bold">LTP</div>
                      <div class="font-bold">
                        {{ pos.currentPrice.toFixed(2) }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Breakout Alerts -->
            <div
              v-if="breakouts.length > 0"
              class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
            >
              <div class="p-4 bg-orange-50 border-b border-orange-100">
                <h3 class="text-sm font-bold text-orange-700 uppercase flex items-center gap-2">
                  <Zap class="w-4 h-4" />
                  Live Alerts
                </h3>
              </div>
              <div class="p-4 space-y-4">
                <div
                  v-for="(b, i) in breakouts"
                  :key="i"
                  class="p-3 bg-gray-50 rounded-lg border-l-4 border-orange-500 animate-in fade-in slide-in-from-right duration-500"
                >
                  <div class="text-xs font-bold text-gray-900 mb-1">
                    {{ b.reason }}
                  </div>
                  <div class="text-[10px] text-gray-500">Price: {{ b.tick.last_price }}</div>
                </div>
              </div>
            </div>

            <!-- Price Card (if no live price) -->
            <div v-if="!livePrice" class="bg-indigo-600 rounded-2xl p-6 text-white shadow-lg shadow-indigo-200">
              <div class="flex items-center justify-between mb-4">
                <span class="text-indigo-100 font-medium">Last Price</span>
                <Activity class="w-5 h-5 text-indigo-200" />
              </div>
              <div class="text-4xl font-black mb-1">
                {{ analysisResult.tf15m.price.toFixed(2) }}
              </div>
              <div class="text-sm text-indigo-100 italic">Awaiting live feed...</div>
            </div>

            <!-- Technicals & Context (Condensed) -->
            <div
              class="bg-white p-6 rounded-2xl shadow-sm border border-gray-200"
              v-if="activeTfStats && activeTfStats.trend"
            >
              <div class="flex items-center justify-between mb-6">
                <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp class="w-4 h-4" />
                  Technical Stats ({{ chartTimeframeStr }})
                </h3>
              </div>

              <div class="space-y-4 text-sm">
                <!-- Trend & RSI -->
                <div class="grid grid-cols-2 gap-4">
                  <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <div class="text-xs text-gray-500 mb-1">Trend</div>
                    <div
                      class="font-bold text-lg"
                      :class="
                        activeTfStats.trend === 'up'
                          ? 'text-green-600'
                          : activeTfStats.trend === 'down'
                            ? 'text-red-600'
                            : 'text-gray-600'
                      "
                    >
                      {{ (activeTfStats.trend || "").toUpperCase() }}
                    </div>
                  </div>
                  <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <div class="text-xs text-gray-500 mb-1">RSI</div>
                    <div
                      class="font-bold text-lg"
                      :class="
                        activeTfStats.rsi > 70
                          ? 'text-red-600'
                          : activeTfStats.rsi < 30
                            ? 'text-green-600'
                            : 'text-gray-900'
                      "
                    >
                      {{ activeTfStats.rsi.toFixed(2) }}
                    </div>
                  </div>
                </div>

                <!-- VWAP & Levels -->
                <div class="space-y-2 pt-2 border-t border-gray-100">
                  <div class="flex items-center justify-between">
                    <span class="text-gray-500">VWAP</span>
                    <span class="font-mono text-xs">{{ activeTfStats.vwap.toFixed(2) }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-gray-500">VWAP Pos</span>
                    <span
                      class="font-bold text-xs"
                      :class="activeTfStats.vwapPosition === 'above' ? 'text-green-600' : 'text-red-600'"
                      >{{ (activeTfStats.vwapPosition || "").toUpperCase() }}</span
                    >
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-gray-500">Resistance</span>
                    <span class="font-mono text-red-600 text-xs">{{ activeTfStats.resistance.toFixed(2) }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-gray-500">Support</span>
                    <span class="font-mono text-green-600 text-xs">{{ activeTfStats.support.toFixed(2) }}</span>
                  </div>
                </div>
                <!-- Elliott Wave Context -->
                <div v-if="activeTfStats.waveContext" class="pt-3 border-t border-gray-100">
                  <div class="text-xs font-bold text-indigo-600 uppercase mb-2 flex items-center gap-1">
                    <Activity class="w-3 h-3" /> Wave Context
                  </div>
                  <div class="text-sm font-medium text-gray-700 bg-indigo-50 p-2 rounded-lg border border-indigo-100">
                    Current Wave:
                    <span class="font-bold text-indigo-900">{{
                      (activeTfStats.waveContext.currentPhase || "").replace("_", " ")
                    }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- AI Decision Card (Moved from Main content) -->
            <div
              v-if="analysisResult?.aiDecision"
              class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
            >
              <div class="p-4 border-b border-gray-100 flex items-center justify-between">
                <h2 class="text-sm font-bold text-gray-600 uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck class="w-4 h-4 text-indigo-500" />
                  AI Decision
                </h2>
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider"
                  :class="getDecisionColor(analysisResult.aiDecision.decision)"
                >
                  {{ analysisResult.aiDecision.decision }}
                </span>
              </div>

              <div class="p-4 space-y-4">
                <div class="grid grid-cols-2 gap-4">
                  <div class="bg-gray-50 rounded-xl p-3 border border-gray-100">
                    <span class="text-xs text-gray-500 block mb-1">Confidence</span>
                    <span class="font-black text-indigo-900">{{ analysisResult.aiDecision.confidence }}</span>
                  </div>
                  <div class="bg-gray-50 rounded-xl p-3 border border-gray-100">
                    <span class="text-xs text-gray-500 block mb-1">Setup</span>
                    <span class="font-black text-indigo-900">{{ analysisResult.aiDecision.setup || "N/A" }}</span>
                  </div>
                </div>

                <div class="bg-indigo-50/50 rounded-xl p-4 border border-indigo-100">
                  <h3 class="text-xs font-bold text-indigo-900 mb-2 flex items-center gap-1 uppercase tracking-wider">
                    <Info class="w-3 h-3 text-indigo-500" />
                    Rationale
                  </h3>
                  <p class="text-xs text-indigo-800 leading-relaxed italic">"{{ analysisResult.aiDecision.reason }}"</p>
                </div>

                <div class="space-y-2 pt-2">
                  <div class="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div class="text-[10px] text-gray-500 font-bold uppercase">Entry</div>
                    <div class="text-sm font-bold text-gray-900">
                      {{ Math.floor(analysisResult.aiDecision.entry || 0) || "N/A" }}
                    </div>
                  </div>
                  <div class="flex items-center justify-between p-2 bg-red-50 rounded-lg">
                    <div class="text-[10px] text-red-500 font-bold uppercase">Stop Loss</div>
                    <div class="text-sm font-bold text-red-700">
                      {{ Math.floor(analysisResult.aiDecision.stopLoss || 0) || "N/A" }}
                    </div>
                  </div>
                  <div class="flex items-center justify-between p-2 bg-green-50 rounded-lg">
                    <div class="text-[10px] text-green-600 font-bold uppercase">Target(s)</div>
                    <div class="text-sm font-bold text-green-700">
                      {{ analysisResult.aiDecision.targets?.map((t: number) => Math.floor(t)).join(", ") || "N/A" }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- GTI Real-Time Dashboard Panel -->
            <div
              v-if="analysisResult.gtiHistory && analysisResult.gtiHistory.length > 0"
              class="bg-white p-6 rounded-2xl shadow-sm border border-gray-200"
            >
              <div class="flex items-center justify-between mb-6">
                <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck class="w-4 h-4 text-indigo-500" />
                  Institutional Flow (GTI)
                </h3>
              </div>

              <div v-if="analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1]?.gtiScore" class="space-y-4">
                <div
                  class="p-4 rounded-xl flex flex-col gap-1"
                  :class="{
                    'bg-blue-50 border border-blue-100 text-blue-800':
                      analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.composite > 0.6,
                    'bg-emerald-50 border border-emerald-100 text-emerald-800':
                      analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.composite > 0.2 &&
                      analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.composite <= 0.6,
                    'bg-gray-50 border border-gray-200 text-gray-700':
                      analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.composite >= -0.2 &&
                      analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.composite <= 0.2,
                    'bg-rose-50 border border-rose-100 text-rose-800':
                      analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.composite < -0.2 &&
                      analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.composite >= -0.6,
                    'bg-purple-50 border border-purple-100 text-purple-800':
                      analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.composite < -0.6,
                  }"
                >
                  <div class="text-[10px] font-black uppercase tracking-widest opacity-60">Composite Score</div>
                  <div class="text-2xl font-black">
                    {{
                      analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.composite > 0 ? "+" : ""
                    }}{{
                      analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.composite.toFixed(2)
                    }}
                  </div>
                  <div class="text-xs font-bold mt-1">
                    {{
                      analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.classification.replace(
                        /_/g,
                        " "
                      )
                    }}
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2 text-xs">
                  <div class="p-2 bg-gray-50 rounded-lg border border-gray-100 flex justify-between">
                    <span class="text-gray-500 font-medium">Volume</span>
                    <span
                      class="font-mono font-bold"
                      :class="
                        analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.components
                          .volumeAnomaly > 0
                          ? 'text-green-600'
                          : 'text-red-600'
                      "
                    >
                      {{
                        analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.components
                          .volumeAnomaly > 0
                          ? "+"
                          : ""
                      }}{{
                        analysisResult.gtiHistory[
                          analysisResult.gtiHistory.length - 1
                        ].gtiScore.components.volumeAnomaly.toFixed(2)
                      }}
                    </span>
                  </div>
                  <div class="p-2 bg-gray-50 rounded-lg border border-gray-100 flex justify-between">
                    <span class="text-gray-500 font-medium">CVD</span>
                    <span
                      class="font-mono font-bold"
                      :class="
                        analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.components.cvd > 0
                          ? 'text-green-600'
                          : 'text-red-600'
                      "
                    >
                      {{
                        analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.components.cvd > 0
                          ? "+"
                          : ""
                      }}{{
                        analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.components.cvd.toFixed(
                          2
                        )
                      }}
                    </span>
                  </div>
                  <div class="p-2 bg-gray-50 rounded-lg border border-gray-100 flex justify-between">
                    <span class="text-gray-500 font-medium">VWAP Dev</span>
                    <span
                      class="font-mono font-bold"
                      :class="
                        analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.components
                          .vwapDeviation > 0
                          ? 'text-green-600'
                          : 'text-red-600'
                      "
                    >
                      {{
                        analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.components
                          .vwapDeviation > 0
                          ? "+"
                          : ""
                      }}{{
                        analysisResult.gtiHistory[
                          analysisResult.gtiHistory.length - 1
                        ].gtiScore.components.vwapDeviation.toFixed(2)
                      }}
                    </span>
                  </div>
                  <div class="p-2 bg-gray-50 rounded-lg border border-gray-100 flex justify-between">
                    <span class="text-gray-500 font-medium">OI Signal</span>
                    <span
                      class="font-mono font-bold"
                      :class="
                        analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.components.oiSignal > 0
                          ? 'text-green-600'
                          : analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.components
                                .oiSignal < 0
                            ? 'text-red-600'
                            : 'text-gray-600'
                      "
                    >
                      {{
                        analysisResult.gtiHistory[analysisResult.gtiHistory.length - 1].gtiScore.components.oiSignal > 0
                          ? "+"
                          : ""
                      }}{{
                        analysisResult.gtiHistory[
                          analysisResult.gtiHistory.length - 1
                        ].gtiScore.components.oiSignal.toFixed(2)
                      }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="!analysisResult && !loading" class="text-center py-20">
          <div
            class="bg-white w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-gray-100"
          >
            <Activity class="w-10 h-10 text-gray-300" />
          </div>
          <h2 class="text-xl font-bold text-gray-900 mb-2">Ready to Analyze</h2>
          <p class="text-gray-500 max-w-sm mx-auto">
            Enter a symbol and click analyze to get AI-driven insights and technical levels for your next trade.
          </p>
        </div>
      </div>

      <!-- History View -->
      <div v-show="currentView === 'history'" class="space-y-8 animate-in fade-in slide-in-from-bottom duration-500">
        <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <h2 class="text-lg font-semibold flex items-center gap-2">
              <Activity class="w-5 h-5 text-indigo-600" />
              Paper Trade History
            </h2>
            <button @click="fetchHistory" class="text-sm font-medium text-indigo-600 hover:text-indigo-700">
              Refresh
            </button>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr
                  class="bg-gray-50/50 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100"
                >
                  <th class="px-6 py-4">Opened At</th>
                  <th class="px-6 py-4">Closed At</th>
                  <th class="px-6 py-4">Symbol</th>
                  <th class="px-6 py-4">Side</th>
                  <th class="px-6 py-4 text-right">Entry</th>
                  <th class="px-6 py-4 text-right">Target</th>
                  <th class="px-6 py-4 text-right">SL</th>
                  <th class="px-6 py-4 text-right">Exit</th>
                  <th class="px-6 py-4 text-right">PnL</th>
                  <th class="px-6 py-4 text-center">Status</th>
                  <th class="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <template v-for="trade in tradeHistory" :key="trade.id">
                  <tr
                    class="hover:bg-gray-50/50 transition-colors group cursor-pointer"
                    @click="toggleTradeExpand(trade.id)"
                  >
                    <td class="px-6 py-4 text-xs text-gray-500 font-medium">
                      <div class="whitespace-nowrap">
                        {{ formatDateIST(trade.openedAt) }}
                        <span v-if="trade.openedAt" class="text-[10px] opacity-50 ml-1">{{
                          formatTimeIST(trade.openedAt)
                        }}</span>
                      </div>
                    </td>
                    <td class="px-6 py-4 text-xs text-gray-500 font-medium">
                      <div v-if="trade.closedAt" class="whitespace-nowrap">
                        {{ formatDateIST(trade.closedAt) }}
                        <span class="text-[10px] opacity-50 ml-1">{{ formatTimeIST(trade.closedAt) }}</span>
                      </div>
                      <span v-else class="text-gray-300">—</span>
                    </td>
                    <td class="px-6 py-4">
                      <span class="text-sm font-black text-gray-900">{{ trade.symbol }}</span>
                    </td>
                    <td class="px-6 py-4">
                      <span
                        class="px-2 py-0.5 rounded text-[10px] font-black uppercase"
                        :class="trade.side === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'"
                      >
                        {{ trade.side }}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-bold text-gray-600">
                      {{ Number(trade.entryPrice).toFixed(2) }}
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-bold text-green-600">
                      {{ trade.aiTarget ? Number(trade.aiTarget).toFixed(2) : "—" }}
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-bold text-red-600">
                      {{ trade.aiStopLoss ? Number(trade.aiStopLoss).toFixed(2) : "—" }}
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-bold text-gray-600">
                      {{ trade.exitPrice ? Number(trade.exitPrice).toFixed(2) : "—" }}
                    </td>
                    <td class="px-6 py-4 text-right">
                      <span
                        v-if="trade.pnl !== null"
                        class="font-mono text-sm font-black"
                        :class="Number(trade.pnl) >= 0 ? 'text-green-600' : 'text-red-600'"
                      >
                        {{ Number(trade.pnl) >= 0 ? "+" : "" }}{{ Number(trade.pnl).toFixed(2) }}
                      </span>
                      <span v-else class="text-gray-300">—</span>
                    </td>
                    <td class="px-6 py-4 text-center">
                      <span
                        class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter"
                        :class="
                          trade.status === 'CLOSED'
                            ? 'bg-gray-100 text-gray-500'
                            : 'bg-indigo-100 text-indigo-700 animate-pulse'
                        "
                      >
                        {{ trade.status }}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-right">
                      <Info class="w-4 h-4 text-gray-300 group-hover:text-indigo-500 transition-colors" />
                    </td>
                  </tr>
                  <!-- Expandable AI Rationale Row -->
                  <tr v-if="expandedTradeId === trade.id" class="bg-indigo-50/30">
                    <td colspan="11" class="px-8 py-6">
                      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div class="md:col-span-2 space-y-6">
                          <div>
                            <h4
                              class="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2 mb-2"
                            >
                              <ShieldCheck class="w-3 h-3" />
                              AI Reasoning at Entry
                            </h4>
                            <p
                              class="text-sm text-gray-700 leading-relaxed italic border-l-2 border-indigo-200 pl-4 bg-white/50 p-3 rounded-r-lg"
                            >
                              "{{ trade.aiReasoning || "No reasoning recorded." }}"
                            </p>
                          </div>

                          <div v-if="trade.status === 'CLOSED'" class="pt-2 border-t border-indigo-100/50">
                            <h4
                              class="text-[10px] font-black text-red-400 uppercase tracking-widest flex items-center gap-2 mb-2"
                            >
                              <LogOut class="w-3 h-3" />
                              Exit Reason
                            </h4>
                            <p
                              class="text-sm font-bold text-gray-900 bg-white/50 p-3 rounded-lg inline-block border border-red-100/50"
                            >
                              {{ trade.exitReason || "Manual Exit or unknown" }}
                            </p>
                          </div>
                        </div>

                        <!-- Strategy Context & Setup Type -->
                        <div class="space-y-4">
                          <h4
                            class="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2"
                          >
                            <Activity class="w-3 h-3" />
                            NCLS Strategy Context
                          </h4>
                          <div class="space-y-3">
                            <div class="bg-white/80 p-3 rounded-lg border border-indigo-100/50">
                              <div class="text-[9px] text-gray-400 font-bold uppercase">Setup Type</div>
                              <span class="text-xs font-black uppercase tracking-tight text-indigo-600">
                                {{ trade.setup?.replace("_", " ") || "STANDARD MTF" }}
                              </span>
                            </div>

                            <div
                              v-if="trade.strategyContext"
                              class="bg-gray-900 p-3 rounded-lg border border-gray-800 shadow-inner"
                            >
                              <div class="text-[9px] text-gray-500 font-bold uppercase mb-2">
                                Market Snapshot (JSON)
                              </div>
                              <pre
                                class="text-[10px] text-indigo-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed"
                              >
                                {{
                                  typeof trade.strategyContext === "string"
                                    ? JSON.parse(trade.strategyContext)
                                    : trade.strategyContext
                                }}
                              </pre>
                            </div>
                          </div>
                        </div>

                        <div class="space-y-4">
                          <h4
                            class="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2"
                          >
                            <Target class="w-3 h-3" />
                            Market State
                          </h4>
                          <div class="grid grid-cols-2 gap-4">
                            <div class="bg-white/80 p-3 rounded-lg border border-indigo-100/50">
                              <div class="text-[9px] text-gray-400 font-bold uppercase">Confidence</div>
                              <div class="text-sm font-black text-indigo-900">
                                {{ trade.aiConfidence ? (trade.aiConfidence * 100).toFixed(0) : "—" }}%
                              </div>
                            </div>
                            <div class="bg-white/80 p-3 rounded-lg border border-indigo-100/50">
                              <div class="text-[9px] text-gray-400 font-bold uppercase">India VIX</div>
                              <div class="text-sm font-black text-indigo-900">
                                {{ trade.vixLevel ? Number(trade.vixLevel).toFixed(2) : "—" }}
                              </div>
                            </div>
                            <div class="bg-white/80 p-3 rounded-lg border border-indigo-100/50">
                              <div class="text-[9px] text-gray-400 font-bold uppercase">RSI (15m)</div>
                              <div class="text-sm font-black text-indigo-900">
                                {{ trade.rsiLevel ? Number(trade.rsiLevel).toFixed(2) : "—" }}
                              </div>
                            </div>
                            <div class="bg-white/80 p-3 rounded-lg border border-indigo-100/50">
                              <div class="text-[9px] text-gray-400 font-bold uppercase">Trend</div>
                              <div class="text-sm font-black text-indigo-900 capitalize">
                                {{ trade.trend15m || "—" }}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>
                <tr v-if="tradeHistory.length === 0">
                  <td colspan="8" class="px-6 py-20 text-center text-gray-400">
                    <Activity class="w-8 h-8 mx-auto mb-4 opacity-20" />
                    <div class="text-sm font-bold">No trades found in memory</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Events View -->
      <div v-show="currentView === 'events'" class="space-y-8 animate-in fade-in slide-in-from-bottom duration-500">
        <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <h2 class="text-lg font-semibold flex items-center gap-2">
              <Zap class="w-5 h-5 text-indigo-600" />
              Analyzer Trigger History
            </h2>
            <button @click="fetchEvents" class="text-sm font-medium text-indigo-600 hover:text-indigo-700">
              Refresh
            </button>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr
                  class="bg-gray-50/50 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100"
                >
                  <th class="px-6 py-4">Timestamp</th>
                  <th class="px-6 py-4">Symbol</th>
                  <th class="px-6 py-4">Reason</th>
                  <th class="px-6 py-4 text-right">Price</th>
                  <th class="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                <template v-for="event in analyzerEvents" :key="event.id">
                  <tr
                    class="hover:bg-gray-50/50 transition-colors group cursor-pointer"
                    @click="toggleTradeExpand(event.id)"
                  >
                    <td class="px-6 py-4 text-xs text-gray-500 font-medium">
                      <div class="whitespace-nowrap">
                        {{ formatDateIST(event.createdAt) }}
                        <span class="text-[10px] opacity-50 ml-1">{{ formatTimeIST(event.createdAt) }}</span>
                      </div>
                    </td>
                    <td class="px-6 py-4">
                      <span class="text-sm font-black text-gray-900">{{ event.symbol }}</span>
                    </td>
                    <td class="px-6 py-4">
                      <span class="text-sm text-gray-700 font-medium">{{ event.reason }}</span>
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-bold text-gray-600">
                      {{ Number(event.price).toFixed(2) }}
                    </td>
                    <td class="px-6 py-4 text-right">
                      <Info class="w-4 h-4 text-gray-300 group-hover:text-indigo-500 transition-colors" />
                    </td>
                  </tr>
                  <!-- Expandable Metadata Row -->
                  <tr v-if="expandedTradeId === event.id" class="bg-indigo-50/30">
                    <td colspan="5" class="px-8 py-6">
                      <div class="space-y-3">
                        <h4
                          class="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2"
                        >
                          <Activity class="w-3 h-3" />
                          Event Metadata (JSON)
                        </h4>
                        <div class="bg-gray-900 p-4 rounded-xl border border-gray-800 shadow-inner">
                          <pre
                            class="text-[10px] text-indigo-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed"
                          >
                            {{ typeof event.metadata === "string" ? JSON.parse(event.metadata) : event.metadata }}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>
                <tr v-if="analyzerEvents.length === 0">
                  <td colspan="5" class="px-6 py-20 text-center text-gray-400">
                    <Zap class="w-8 h-8 mx-auto mb-4 opacity-20" />
                    <div class="text-sm font-bold">No analyzer events found</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>

    <!-- Notifications Toast -->
    <div class="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
      <div
        v-for="n in notifications"
        :key="n.id"
        class="pointer-events-auto bg-white border rounded-2xl shadow-2xl p-4 min-w-[320px] max-w-md animate-in slide-in-from-right duration-300 border-l-4"
        :class="{
          'border-l-green-500': n.type === 'success',
          'border-l-red-500': n.type === 'error',
          'border-l-orange-500': n.type === 'warning',
          'border-l-indigo-500': n.type === 'info',
        }"
      >
        <div class="flex items-start gap-3">
          <div
            :class="{
              'text-green-500': n.type === 'success',
              'text-red-500': n.type === 'error',
              'text-orange-500': n.type === 'warning',
              'text-indigo-500': n.type === 'info',
            }"
          >
            <Zap v-if="n.type === 'warning'" class="w-5 h-5" />
            <ShieldCheck v-else-if="n.type === 'success'" class="w-5 h-5" />
            <AlertCircle v-else-if="n.type === 'error'" class="w-5 h-5" />
            <Info v-else class="w-5 h-5" />
          </div>
          <div class="flex-1">
            <h4 class="text-sm font-bold text-gray-900">{{ n.title }}</h4>
            <p class="text-xs text-gray-500 mt-1 leading-relaxed">{{ n.message }}</p>

            <div v-if="n.details" class="mt-3 grid grid-cols-2 gap-2 p-2 bg-gray-50 rounded-lg border border-gray-100">
              <div v-if="n.details.price">
                <div class="text-[9px] text-gray-400 font-bold uppercase">Price</div>
                <div class="text-[11px] font-black text-gray-900">
                  {{ n.details.price.toFixed(2) }}
                </div>
              </div>
              <div v-if="n.details.stopLoss">
                <div class="text-[9px] text-red-400 font-bold uppercase">Stop Loss</div>
                <div class="text-[11px] font-black text-red-600">
                  {{ n.details.stopLoss.toFixed(2) }}
                </div>
              </div>
              <div v-if="n.details.target">
                <div class="text-[9px] text-green-400 font-bold uppercase">Target</div>
                <div class="text-[11px] font-black text-green-600">
                  {{ n.details.target.toFixed(2) }}
                </div>
              </div>
            </div>
          </div>
          <button
            @click="notifications = notifications.filter((x) => x.id !== n.id)"
            class="text-gray-300 hover:text-gray-500"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Agent Detail Slide-over -->
    <div
      v-if="selectedAgentForDetail"
      class="fixed inset-0 z-[60] overflow-hidden"
      @keydown.esc="selectedAgentForDetail = null"
    >
      <!-- Overlay -->
      <div
        class="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-300"
        @click="selectedAgentForDetail = null"
      ></div>

      <!-- Slide-over -->
      <div
        class="absolute inset-y-0 right-0 max-w-2xl w-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-500"
      >
        <div class="p-6 border-b border-gray-100 flex items-center justify-between bg-indigo-600 text-white">
          <div class="flex items-center gap-3">
            <div class="bg-white/20 p-2 rounded-lg">
              <Zap class="w-5 h-5" />
            </div>
            <div>
              <h2 class="text-lg font-bold uppercase tracking-tight">{{ selectedAgentForDetail }}</h2>
              <div class="text-xs text-indigo-100 opacity-80">
                Last update: {{ new Date(agents[selectedAgentForDetail].lastUpdate).toLocaleTimeString() }}
              </div>
            </div>
          </div>
          <button @click="selectedAgentForDetail = null" class="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X class="w-6 h-6" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-8 space-y-8">
          <!-- Status Banner -->
          <div
            class="p-4 rounded-xl border flex items-center gap-3"
            :class="{
              'bg-indigo-50 border-indigo-100 text-indigo-700': agents[selectedAgentForDetail].status === 'thinking',
              'bg-green-50 border-green-100 text-green-700': agents[selectedAgentForDetail].status === 'decided',
              'bg-red-50 border-red-100 text-red-700': agents[selectedAgentForDetail].status === 'error',
              'bg-gray-50 border-gray-100 text-gray-700': agents[selectedAgentForDetail].status === 'idle',
            }"
          >
            <div
              class="w-3 h-3 rounded-full"
              :class="{
                'bg-indigo-500 animate-ping': agents[selectedAgentForDetail].status === 'thinking',
                'bg-indigo-500': agents[selectedAgentForDetail].status === 'thinking',
                'bg-green-500': agents[selectedAgentForDetail].status === 'decided',
                'bg-red-500': agents[selectedAgentForDetail].status === 'error',
                'bg-gray-400': agents[selectedAgentForDetail].status === 'idle',
              }"
            ></div>
            <span class="text-sm font-bold uppercase tracking-widest">{{ agents[selectedAgentForDetail].status }}</span>
            <div class="h-4 w-px bg-current opacity-20 mx-2"></div>
            <p class="text-sm font-medium leading-relaxed">{{ agents[selectedAgentForDetail].message }}</p>
          </div>

          <!-- Deep Dive Data -->
          <div v-if="agents[selectedAgentForDetail].data" class="space-y-6">
            <div v-if="agents[selectedAgentForDetail].data.rationale" class="space-y-3">
              <h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Info class="w-3 h-3" />
                Strategic Rationale
              </h3>
              <p class="text-sm text-gray-700 leading-relaxed italic border-l-4 border-indigo-500 pl-4 py-1">
                "{{ agents[selectedAgentForDetail].data.rationale }}"
              </p>
            </div>

            <div v-if="agents[selectedAgentForDetail].data.reason" class="space-y-3">
              <h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck class="w-3 h-3" />
                Agent Reasoning
              </h3>
              <p class="text-sm text-gray-700 leading-relaxed italic border-l-4 border-indigo-500 pl-4 py-1">
                "{{ agents[selectedAgentForDetail].data.reason }}"
              </p>
            </div>

            <!-- Full JSON Explorer -->
            <div class="space-y-3">
              <h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Activity class="w-3 h-3" />
                Raw Intelligence Payload
              </h3>
              <div class="bg-gray-900 rounded-2xl p-6 shadow-inner border border-gray-800 overflow-hidden">
                <pre
                  class="text-[11px] text-indigo-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed"
                  >{{ JSON.stringify(agents[selectedAgentForDetail].data, null, 2) }}</pre
                >
              </div>
            </div>
          </div>

          <div v-else class="text-center py-20 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            <Activity class="w-12 h-12 text-gray-300 mx-auto mb-4 opacity-50" />
            <div class="text-sm font-bold text-gray-500">Waiting for live intelligence payload...</div>
            <p class="text-xs text-gray-400 mt-1">Deep dive data will appear here once the agent makes a decision.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap");

body {
  font-family: "Inter", sans-serif;
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
