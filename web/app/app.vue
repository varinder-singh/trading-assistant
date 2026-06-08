<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from "vue"
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
} from "@lucide/vue"
import { createChart, AreaSeries, CrosshairMode } from "lightweight-charts"
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
const notifications = ref<any[]>([])
const serverLogs = ref<string[]>([])
const logsContainer = ref<HTMLElement | null>(null)
const lastInstitutionalAlertAt = ref(0)

const agents = ref<Record<string, any>>({
  Orchestrator: { status: "idle", message: "Awaiting market data...", lastUpdate: Date.now() },
  SCALPER: { status: "idle", message: "Awaiting signal...", lastUpdate: Date.now() },
  TREND: { status: "idle", message: "Awaiting trend...", lastUpdate: Date.now() },
  "Risk Manager": { status: "idle", message: "No active positions.", lastUpdate: Date.now() },
})

const selectedAgentForDetail = ref<string | null>(null)

const dailyPnl = computed(() => {
  const realized = tradeHistory.value
    .filter((t) => {
      const today = new Date().toISOString().split("T")[0]
      return t.status === "CLOSED" && t.closed_at?.startsWith(today)
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

function scrollToBottom() {
  nextTick(() => {
    if (logsContainer.value) {
      logsContainer.value.scrollTop = logsContainer.value.scrollHeight
    }
  })
}

function toggleView(view: "live" | "history" | "events" | "logs") {
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
  } else if (view === "logs") {
    scrollToBottom()
  }
}

function toggleTradeExpand(id: string) {
  expandedTradeId.value = expandedTradeId.value === id ? null : id
}

// Chart Refs
const chartContainer = ref<HTMLElement | null>(null)
let chart: IChartApi | null = null
let areaSeries: ISeriesApi<"Area"> | null = null
let resistanceLine: any = null
let supportLine: any = null

// WebSocket
let ws: WebSocket | null = null

function connectWebSocket() {
  if (ws) ws.close()

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  ws = new WebSocket(`${protocol}//${window.location.host}/_ws`)

  ws.onopen = () => {
    console.log("WS Connected")
    if (analysisResult.value) {
      startWatching()
    }
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.type === "tick") {
      const price = msg.data.last_price
      livePrice.value = price
      updateChart(price)
    } else if (msg.type === "log") {
      serverLogs.value.push(msg.data)
      if (serverLogs.value.length > 1000) serverLogs.value.shift()
      if (currentView.value === "logs") {
        scrollToBottom()
      }
    } else if (msg.type === "analysis") {
      analysisResult.value = msg.data
      initChart()
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
      fetchHistory() // Refresh history to get latest realized PnL

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
      if (msg.data.details && areaSeries) {
        const { side, price } = msg.data.details
        const markers = areaSeries.getMarkers() || []
        markers.push({
          time: Math.floor(Date.now() / 1000) as any,
          position: side === "BUY" ? "belowBar" : "aboveBar",
          color: side === "BUY" ? "#22c55e" : "#ef4444",
          shape: side === "BUY" ? "arrowUp" : "arrowDown",
          text: side === "BUY" ? "BUY" : "SELL",
        })
        areaSeries.setMarkers(markers)
      }
    } else if (msg.type === "market_closed") {
      addNotification({
        title: "🏁 Market Closed",
        message: msg.message,
        type: "info",
      })
    }
  }
}

function startWatching() {
  if (ws && ws.readyState === WebSocket.OPEN && analysisResult.value) {
    ws.send(
      JSON.stringify({
        type: "watch",
        data: {
          symbol: symbol.value,
          mode: mode.value,
          levels: {
            resistance: analysisResult.value.tf15m.resistance,
            support: analysisResult.value.tf15m.support,
            vwap: analysisResult.value.tf15m.vwap,
          },
        },
      })
    )
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
    initChart()
    startWatching()

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
    },
    width: chartContainer.value.clientWidth,
    height: 400,
  })

  areaSeries = chart.addSeries(AreaSeries, {
    lineColor: "#4f46e5",
    topColor: "rgba(79, 70, 229, 0.4)",
    bottomColor: "rgba(79, 70, 229, 0.0)",
    lineWidth: 2,
    priceFormat: {
      type: "price",
      precision: 2,
      minMove: 0.05,
    },
  })

  // Pre-load historical data
  if (analysisResult.value?.candles5m) {
    const historicalData = analysisResult.value.candles5m.map((c: any) => ({
      time: c.time as any,
      value: c.close,
    }))
    areaSeries.setData(historicalData)
  }

  if (analysisResult.value) {
    const { resistance, support } = analysisResult.value.tf15m

    // Custom price lines for levels
    areaSeries.createPriceLine({
      price: resistance,
      color: "#ef4444",
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: "RESISTANCE",
    })

    areaSeries.createPriceLine({
      price: support,
      color: "#22c55e",
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: "SUPPORT",
    })
  }
}

function updateChart(price: number) {
  if (areaSeries) {
    areaSeries.update({
      time: Math.floor(Date.now() / 1000) as any,
      value: price,
    })
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
  runAnalysis()
  connectWebSocket()

  window.addEventListener("resize", () => {
    if (chart && chartContainer.value) {
      chart.applyOptions({ width: chartContainer.value.clientWidth })
    }
  })
})

onUnmounted(() => {
  if (ws) ws.close()
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
          <h1 class="text-xl font-bold tracking-tight text-gray-900">Trading Assistant</h1>
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
          <button
            @click="toggleView('logs')"
            class="px-4 py-2 text-sm font-bold rounded-lg transition-all"
            :class="currentView === 'logs' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
          >
            Server Logs
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
            :disabled="loading"
            class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <span
              v-if="loading"
              class="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"
            ></span>
            {{ loading ? "Analyzing..." : "Analyze" }}
          </button>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Risk Management Stats Bar -->
      <div class="mb-8 flex justify-center">
        <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between min-w-[300px]">
          <div>
            <div class="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">Daily PnL</div>
            <div class="text-xl font-mono font-bold" :class="dailyPnl >= 0 ? 'text-green-600' : 'text-red-600'">
              {{ dailyPnl >= 0 ? "+" : "" }}₹{{ Math.floor(dailyPnl).toLocaleString() }}
            </div>
          </div>
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center"
            :class="dailyPnl >= 0 ? 'bg-green-50' : 'bg-red-50'"
          >
            <TrendingUp v-if="dailyPnl >= 0" class="w-5 h-5 text-green-500" />
            <TrendingDown v-else class="w-5 h-5 text-red-500" />
          </div>
        </div>
      </div>

      <!-- Error Message -->
      <div v-if="error" class="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700">
        <AlertCircle class="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <h3 class="font-semibold">Analysis Failed</h3>
          <p class="text-sm opacity-90">{{ error }}</p>
        </div>
      </div>

      <!-- Live View -->
      <div v-show="currentView === 'live'">
        <div v-if="analysisResult" class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <!-- Main Content -->
          <div class="lg:col-span-2 space-y-8">
            <!-- Chart Card -->
            <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div class="p-4 border-b border-gray-100 flex items-center justify-between">
                <h3 class="text-sm font-bold text-gray-500 uppercase flex items-center gap-2">
                  <Activity class="w-4 h-4 text-indigo-500" />
                  Live Price Chart
                </h3>
                <div v-if="livePrice" class="flex items-center gap-2">
                  <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  <span class="text-sm font-mono font-bold">{{ livePrice.toFixed(2) }}</span>
                </div>
              </div>
              <div ref="chartContainer" class="w-full"></div>
            </div>

            <!-- Agent Status Cards -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div
                v-for="(agent, name) in agents"
                :key="name"
                class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 transition-all duration-300 cursor-pointer hover:shadow-lg hover:-translate-y-1"
                :class="{
                  'border-indigo-500 ring-2 ring-indigo-50 shadow-md': agent.status === 'thinking',
                  'border-green-500 bg-green-50/30': agent.status === 'decided',
                  'border-red-500 bg-red-50/30': agent.status === 'error',
                }"
                @click="selectedAgentForDetail = name"
              >
                <div class="flex items-center justify-between mb-2">
                  <span class="text-[10px] font-black uppercase tracking-widest text-gray-400">{{ name }}</span>
                  <div class="flex items-center gap-1.5">
                    <span
                      v-if="agent.status === 'thinking'"
                      class="w-2 h-2 bg-indigo-500 rounded-full animate-ping"
                    ></span>
                    <span
                      class="w-2 h-2 rounded-full"
                      :class="{
                        'bg-gray-300': agent.status === 'idle',
                        'bg-indigo-500': agent.status === 'thinking',
                        'bg-green-500': agent.status === 'decided',
                        'bg-red-500': agent.status === 'error',
                      }"
                    ></span>
                  </div>
                </div>
                <div class="text-xs font-bold text-gray-900 line-clamp-2 leading-relaxed h-8">
                  {{ agent.message }}
                </div>
                <div class="mt-2 text-[9px] text-gray-400 flex items-center justify-between">
                  <span>{{ agent.status.toUpperCase() }}</span>
                  <span>{{ new Date(agent.lastUpdate).toLocaleTimeString() }}</span>
                </div>
              </div>
            </div>

            <!-- AI Decision Card -->
            <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div class="p-6 border-b border-gray-100 flex items-center justify-between">
                <h2 class="text-lg font-semibold flex items-center gap-2">
                  <ShieldCheck class="w-5 h-5 text-indigo-600" />
                  AI Decision
                </h2>
                <span
                  class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider"
                  :class="getDecisionColor(analysisResult.aiDecision.decision)"
                >
                  {{ analysisResult.aiDecision.decision }}
                </span>
              </div>

              <div class="p-8">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <div class="text-sm text-gray-500 mb-1">Recommended Action</div>
                    <div
                      class="text-3xl font-bold"
                      :class="
                        analysisResult.aiDecision.decision === 'BUY'
                          ? 'text-green-600'
                          : analysisResult.aiDecision.decision === 'SELL'
                            ? 'text-red-600'
                            : 'text-gray-900'
                      "
                    >
                      {{ analysisResult.aiDecision.decision }}
                    </div>

                    <div class="mt-6 space-y-4">
                      <div class="flex items-center justify-between py-2 border-b border-gray-50">
                        <span class="text-sm text-gray-500">Confidence</span>
                        <span class="font-semibold">{{ analysisResult.aiDecision.confidence }}</span>
                      </div>
                      <div class="flex items-center justify-between py-2 border-b border-gray-50">
                        <span class="text-sm text-gray-500">Setup</span>
                        <span class="font-semibold">{{ analysisResult.aiDecision.setup || "N/A" }}</span>
                      </div>
                    </div>
                  </div>

                  <div class="bg-gray-50 rounded-xl p-6">
                    <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <Info class="w-4 h-4 text-indigo-500" />
                      Rationale
                    </h3>
                    <p class="text-sm text-gray-600 leading-relaxed italic">"{{ analysisResult.aiDecision.reason }}"</p>
                  </div>
                </div>

                <div class="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div class="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                    <div class="text-xs text-indigo-600 font-bold uppercase mb-1">Entry Price</div>
                    <div class="text-xl font-bold text-indigo-900">
                      {{ Math.floor(analysisResult.aiDecision.entry || 0) || "N/A" }}
                    </div>
                  </div>
                  <div class="p-4 bg-red-50 rounded-xl border border-red-100">
                    <div class="text-xs text-red-600 font-bold uppercase mb-1">Stop Loss</div>
                    <div class="text-xl font-bold text-red-900">
                      {{ Math.floor(analysisResult.aiDecision.stopLoss || 0) || "N/A" }}
                    </div>
                  </div>
                  <div class="p-4 bg-green-50 rounded-xl border border-green-100">
                    <div class="text-xs text-green-600 font-bold uppercase mb-1">Target(s)</div>
                    <div class="text-xl font-bold text-green-900">
                      {{ analysisResult.aiDecision.targets?.map((t: number) => Math.floor(t)).join(", ") || "N/A" }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Sidebar Details -->
          <div class="space-y-8">
            <!-- Paper Portfolio -->
            <div
              v-if="portfolio.length > 0"
              class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
            >
              <div class="p-4 bg-indigo-50 border-b border-indigo-100">
                <h3 class="text-sm font-bold text-indigo-700 uppercase flex items-center gap-2">
                  <ShieldCheck class="w-4 h-4" />
                  Paper Portfolio
                </h3>
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
            <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
              <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-6 flex items-center gap-2">
                <TrendingUp class="w-4 h-4" />
                Technical Stats
              </h3>

              <div class="space-y-4 text-sm">
                <div class="flex items-center justify-between">
                  <span class="text-gray-500">Trend</span>
                  <span
                    class="font-bold"
                    :class="analysisResult.tf15m.trend === 'up' ? 'text-green-600' : 'text-red-600'"
                  >
                    {{ analysisResult.tf15m.trend.toUpperCase() }}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-gray-500">RSI</span>
                  <span class="font-bold">{{ analysisResult.tf15m.rsi.toFixed(2) }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-gray-500">VWAP</span>
                  <span class="font-bold">{{ analysisResult.tf15m.vwap.toFixed(2) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else-if="!loading" class="text-center py-20">
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
                        {{ new Date(trade.opened_at).toLocaleDateString() }}
                        <span class="text-[10px] opacity-50 ml-1">{{
                          new Date(trade.opened_at).toLocaleTimeString()
                        }}</span>
                      </div>
                    </td>
                    <td class="px-6 py-4 text-xs text-gray-500 font-medium">
                      <div v-if="trade.closed_at" class="whitespace-nowrap">
                        {{ new Date(trade.closed_at).toLocaleDateString() }}
                        <span class="text-[10px] opacity-50 ml-1">{{
                          new Date(trade.closed_at).toLocaleTimeString()
                        }}</span>
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
                      {{ trade.entry_price.toFixed(2) }}
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-bold text-green-600">
                      {{ trade.ai_target ? trade.ai_target.toFixed(2) : "—" }}
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-bold text-red-600">
                      {{ trade.ai_stop_loss ? trade.ai_stop_loss.toFixed(2) : "—" }}
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-bold text-gray-600">
                      {{ trade.exit_price ? trade.exit_price.toFixed(2) : "—" }}
                    </td>
                    <td class="px-6 py-4 text-right">
                      <span
                        v-if="trade.pnl !== null"
                        class="font-mono text-sm font-black"
                        :class="trade.pnl >= 0 ? 'text-green-600' : 'text-red-600'"
                      >
                        {{ trade.pnl >= 0 ? "+" : "" }}{{ trade.pnl.toFixed(2) }}
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
                              "{{ trade.ai_reasoning || "No reasoning recorded." }}"
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
                              {{ trade.exit_reason || "Manual Exit or unknown" }}
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
                              v-if="trade.strategy_context"
                              class="bg-gray-900 p-3 rounded-lg border border-gray-800 shadow-inner"
                            >
                              <div class="text-[9px] text-gray-500 font-bold uppercase mb-2">
                                Market Snapshot (JSON)
                              </div>
                              <pre
                                class="text-[10px] text-indigo-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed"
                              >
                                {{ JSON.parse(trade.strategy_context) }}
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
                                {{ (trade.ai_confidence * 100).toFixed(0) }}%
                              </div>
                            </div>
                            <div class="bg-white/80 p-3 rounded-lg border border-indigo-100/50">
                              <div class="text-[9px] text-gray-400 font-bold uppercase">India VIX</div>
                              <div class="text-sm font-black text-indigo-900">
                                {{ trade.vix_level?.toFixed(2) || "—" }}
                              </div>
                            </div>
                            <div class="bg-white/80 p-3 rounded-lg border border-indigo-100/50">
                              <div class="text-[9px] text-gray-400 font-bold uppercase">RSI (15m)</div>
                              <div class="text-sm font-black text-indigo-900">
                                {{ trade.rsi_level?.toFixed(2) || "—" }}
                              </div>
                            </div>
                            <div class="bg-white/80 p-3 rounded-lg border border-indigo-100/50">
                              <div class="text-[9px] text-gray-400 font-bold uppercase">Trend</div>
                              <div class="text-sm font-black text-indigo-900 capitalize">
                                {{ trade.trend_15m || "—" }}
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
                        {{ new Date(event.timestamp).toLocaleDateString() }}
                        <span class="text-[10px] opacity-50 ml-1">{{
                          new Date(event.timestamp).toLocaleTimeString()
                        }}</span>
                      </div>
                    </td>
                    <td class="px-6 py-4">
                      <span class="text-sm font-black text-gray-900">{{ event.symbol }}</span>
                    </td>
                    <td class="px-6 py-4">
                      <span class="text-sm text-gray-700 font-medium">{{ event.reason }}</span>
                    </td>
                    <td class="px-6 py-4 text-right font-mono text-sm font-bold text-gray-600">
                      {{ event.price.toFixed(2) }}
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
                            {{ JSON.parse(event.metadata) }}
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

      <!-- Logs View -->
      <div v-show="currentView === 'logs'" class="animate-in fade-in slide-in-from-bottom duration-500">
        <div class="bg-gray-900 rounded-2xl shadow-2xl border border-gray-800 overflow-hidden flex flex-col h-[70vh]">
          <div class="p-4 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="flex gap-1.5">
                <div class="w-3 h-3 rounded-full bg-red-500"></div>
                <div class="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div class="w-3 h-3 rounded-full bg-green-500"></div>
              </div>
              <h2 class="text-sm font-bold text-gray-300 uppercase tracking-widest flex items-center gap-2">
                <Zap class="w-4 h-4 text-indigo-400" />
                Backend Terminal
              </h2>
            </div>
            <button @click="serverLogs = []" class="text-xs font-bold text-gray-500 hover:text-white transition-colors">
              Clear
            </button>
          </div>
          <div
            ref="logsContainer"
            class="flex-1 overflow-y-auto p-6 font-mono text-xs space-y-1.5 selection:bg-indigo-500/30"
          >
            <div v-if="serverLogs.length === 0" class="text-gray-600 italic">Awaiting logs from server...</div>
            <div
              v-for="(log, i) in serverLogs"
              :key="i"
              class="text-gray-300 whitespace-pre-wrap break-words leading-relaxed"
            >
              <span class="text-indigo-500 mr-2 opacity-50">[{{ new Date().toLocaleTimeString() }}]</span>
              <span>{{ log }}</span>
            </div>
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
