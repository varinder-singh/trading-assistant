<template>
  <div class="flex-1 min-h-0 flex flex-col bg-slate-950 border-r border-slate-800 h-full overflow-hidden">
    <!-- Top Chart Controls Bar -->
    <div class="shrink-0 px-4 py-2 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 bg-slate-900/40 text-xs">
      <!-- Left Title & Toggles -->
      <div class="flex items-center gap-3">
        <div data-test="chart-mode-title" class="font-bold text-slate-300 font-mono">
          {{ marketState === 'open' ? 'INTRADAY LIVE EXECUTION' : 'HISTORICAL TRAJECTORY REPLAY' }}
        </div>

        <div class="flex items-center gap-1 font-mono">
          <button
            v-for="tf in ['5m', '15m', '30m', '1h']"
            :key="tf"
            data-test="timeframe-btn"
            type="button"
            @click="$emit('update:selectedTimeframe', tf)"
            class="px-2 py-0.5 rounded transition"
            :class="selectedTimeframe === tf ? 'bg-slate-800 font-bold text-indigo-400 border border-slate-700' : 'text-slate-400 hover:text-white'"
          >
            {{ tf }}
          </button>
        </div>
      </div>

      <!-- Overlays Toggle -->
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
          <input
            type="checkbox"
            :checked="overlays.pocVah"
            @change="$emit('update:overlays', { ...overlays, pocVah: !overlays.pocVah })"
            class="rounded border-slate-700 text-indigo-600 focus:ring-0"
          >
          <span>Support / Resistance</span>
        </label>
        <label class="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
          <input
            type="checkbox"
            :checked="overlays.vwapEma"
            @change="$emit('update:overlays', { ...overlays, vwapEma: !overlays.vwapEma })"
            class="rounded border-slate-700 text-indigo-600 focus:ring-0"
          >
          <span>VWAP</span>
        </label>
      </div>

      <!-- Session High/Low Levels -->
      <div class="flex items-center gap-2 font-mono text-[11px] text-slate-400">
        <span v-if="high">HIGH: <span class="text-slate-200">{{ high.toFixed(2) }}</span></span>
        <span v-if="low">LOW: <span class="text-slate-200">{{ low.toFixed(2) }}</span></span>
        <span v-if="livePrice">LTP: <span class="text-emerald-400 font-bold">{{ livePrice.toFixed(2) }}</span></span>
      </div>
    </div>

    <!-- MAIN REAL CHART CONTAINER -->
    <div class="relative flex-1 min-h-0 bg-slate-950 p-2 flex flex-col overflow-hidden">
      <!-- Floating Active Trade Overlay on Chart -->
      <div
        v-if="positions && positions.length > 0"
        data-test="chart-active-trade-overlay"
        class="absolute top-4 left-4 z-20 bg-slate-900/95 backdrop-blur border border-indigo-500/50 rounded-xl p-2.5 shadow-2xl text-xs font-mono max-w-sm pointer-events-none"
      >
        <div class="flex items-center justify-between gap-3 mb-1.5">
          <div class="flex items-center gap-1.5 font-bold text-white">
            <span
              class="px-1.5 py-0.5 rounded text-[10px]"
              :class="positions[0].symbol?.endsWith('PE') ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'"
            >
              {{ positions[0].symbol?.endsWith('PE') ? 'PE' : 'CE' }}
            </span>
            <span>{{ positions[0].symbol }}</span>
          </div>
          <span
            class="font-bold text-xs"
            :class="(positions[0].unrealizedPnL || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
          >
            {{ (positions[0].unrealizedPnL || 0) >= 0 ? '+' : '' }}₹{{ Number(positions[0].unrealizedPnL || 0).toFixed(2) }}
          </span>
        </div>
        <div class="grid grid-cols-3 gap-2 text-[10px] text-slate-400 pt-1 border-t border-slate-800">
          <div>
            <div>QTY</div>
            <div class="text-white font-bold">{{ positions[0].quantity }}</div>
          </div>
          <div>
            <div>ENTRY</div>
            <div class="text-white font-bold">₹{{ Number(positions[0].avgEntryPrice || positions[0].buyPrice || 0).toFixed(2) }}</div>
          </div>
          <div>
            <div>LTP</div>
            <div class="text-emerald-400 font-bold">₹{{ Number(positions[0].currentPrice || positions[0].lastPrice || positions[0].avgEntryPrice || 0).toFixed(2) }}</div>
          </div>
        </div>
        <div class="mt-1.5 flex items-center justify-between text-[10px] pt-1 border-t border-slate-800/60">
          <div class="text-rose-400 font-bold">
            SL: ₹{{ Number(positions[0].trailingSlLocked || positions[0].aiStopLoss || 0).toFixed(2) }}
          </div>
          <div v-if="positions[0].t1Hit" class="text-amber-400 font-bold flex items-center gap-1">
            <span>T1 HIT 🥇</span>
            <span class="text-slate-400 font-normal">SL +50% cushion</span>
          </div>
          <div v-else-if="positions[0].t1Target" class="text-slate-400">
            T1: ₹{{ Number(positions[0].t1Target).toFixed(2) }}
          </div>
        </div>
      </div>

      <!-- Real Lightweight Chart Mount Target -->
      <div ref="chartContainer" class="w-full flex-1 min-h-0 overflow-hidden"></div>

      <!-- Empty state when no candles yet -->
      <div
        v-if="!candles || candles.length === 0"
        class="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-10 text-slate-400 text-xs font-mono"
      >
        Loading market candle history...
      </div>

      <!-- Chart Bottom Status Strip -->
      <div class="shrink-0 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono">
        <div class="flex items-center gap-4">
          <span v-if="rsi">RSI(14): <span class="text-slate-200">{{ rsi.toFixed(1) }}</span></span>
          <span v-if="atr">ATR: <span class="text-slate-200">{{ atr.toFixed(2) }}</span></span>
          <span v-if="vwap">VWAP: <span class="text-blue-400 font-bold">{{ vwap.toFixed(2) }}</span></span>
          <span v-if="gti">GTI: <span class="text-emerald-400 font-bold">{{ gti }}</span></span>
        </div>
        <div>
          {{ marketState === 'open' ? 'Live Stream Active' : 'Market Closed (Offline Data)' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { createChart, CandlestickSeries, CrosshairMode } from 'lightweight-charts'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'

const props = withDefaults(
  defineProps<{
    candles?: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>
    gtiHistory?: Array<any>
    resistance?: number | null
    support?: number | null
    vwap?: number | null
    selectedTimeframe?: string
    marketState?: 'open' | 'closed'
    symbol?: string
    high?: number | null
    low?: number | null
    livePrice?: number | null
    rsi?: number | null
    atr?: number | null
    gti?: number | null
    overlays?: { ratchetBands?: boolean; pocVah?: boolean; vwapEma?: boolean }
    positions?: any[]
  }>(),
  {
    candles: () => [],
    gtiHistory: () => [],
    resistance: null,
    support: null,
    vwap: null,
    selectedTimeframe: '15m',
    marketState: 'closed',
    symbol: 'NIFTY',
    high: null,
    low: null,
    livePrice: null,
    rsi: null,
    atr: null,
    gti: null,
    overlays: () => ({ ratchetBands: true, pocVah: true, vwapEma: true }),
    positions: () => [],
  }
)

defineEmits<{
  (e: 'update:selectedTimeframe', tf: string): void
  (e: 'update:overlays', overlays: { ratchetBands?: boolean; pocVah?: boolean; vwapEma?: boolean }): void
}>()

const chartContainer = ref<HTMLElement | null>(null)
let chart: IChartApi | null = null
let candleSeries: ISeriesApi<'Candlestick'> | null = null
let resistanceLine: any = null
let supportLine: any = null
let vwapLine: any = null

function getGtiColors(gtiScore: any | undefined, isUp: boolean) {
  let color = isUp ? '#22c55e' : '#ef4444'
  if (!gtiScore) return { color, wickColor: color }
  const score = gtiScore.composite || 0
  if (score > 0.6) color = '#3b82f6'
  else if (score > 0.2) color = '#10b981'
  else if (score < -0.6) color = '#9333ea'
  else if (score < -0.2) color = '#f43f5e'
  else color = isUp ? '#22c55e' : '#ef4444'
  return { color, wickColor: color }
}

function initChart() {
  if (!chartContainer.value) return
  // Skip in headless test environment where canvas 2D rendering is stubbed
  if (typeof window === 'undefined' || typeof document === 'undefined' || navigator.userAgent.includes('HappyDOM') || (window as any).__vitest_worker__) {
    return
  }

  if (chart) {
    try {
      chart.remove()
    } catch (_) {}
    chart = null
  }

  try {
    chart = createChart(chartContainer.value, {
      localization: {
        timeFormatter: (time: number) => {
          const date = new Date(time * 1000)
          return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
        },
      },
      layout: {
        background: { color: '#090d16' },
        textColor: '#e2e8f0',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        autoScale: true,
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number) => {
          const date = new Date(time * 1000)
          return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
        },
      },
      width: chartContainer.value.clientWidth || 600,
      height: chartContainer.value.clientHeight > 0 ? chartContainer.value.clientHeight : 380,
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

    renderCandles()
    renderPriceLines()
  } catch (err) {
    console.warn('Lightweight chart initialization skipped in test environment')
  }
}

const currentCandle = ref<any>(null)

function renderCandles() {
  if (!candleSeries || !props.candles || props.candles.length === 0) return

  // 1. Clean, sort strictly in ascending time order, and deduplicate
  const sorted = [...props.candles]
    .map((c) => ({
      ...c,
      time: Math.floor(Number(c.time)),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter((c) => !isNaN(c.time) && !isNaN(c.open) && !isNaN(c.close))
    .sort((a, b) => a.time - b.time)

  const deduplicated: typeof sorted = []
  for (const c of sorted) {
    if (deduplicated.length === 0 || c.time > deduplicated[deduplicated.length - 1].time) {
      deduplicated.push(c)
    }
  }

  const formatted = deduplicated.map((c) => {
    const isUp = c.close >= c.open
    const gtiMatch = props.gtiHistory.find((g: any) => g.time === c.time)
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

  candleSeries.setData(formatted)

  // Seed current forming candle from the latest historical bar
  if (formatted.length > 0) {
    const last = formatted[formatted.length - 1]
    currentCandle.value = { ...last }

    // If live price is already populated, update the forming candle immediately
    if (props.livePrice !== null && props.livePrice !== undefined) {
      updateLiveCandle(props.livePrice)
    }
  }
}

function updateLiveCandle(price: number) {
  if (!candleSeries || !price || isNaN(price)) return

  const tfMap: Record<string, number> = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600 }
  const bucketSecs = tfMap[props.selectedTimeframe || '15m'] || 900
  const now = Math.floor(Date.now() / 1000)
  const currentBucketTime = now - (now % bucketSecs)

  if (!currentCandle.value || currentBucketTime > Number(currentCandle.value.time)) {
    // Start of a new candle period
    const isUp = true
    const { color, wickColor } = getGtiColors(props.gti !== null && props.gti !== undefined ? { composite: props.gti / 100 } : undefined, isUp)

    currentCandle.value = {
      time: currentBucketTime as any,
      open: price,
      high: price,
      low: price,
      close: price,
      color,
      wickColor,
    }
  } else {
    // Live update of active forming candle
    currentCandle.value.close = price
    if (price > currentCandle.value.high) currentCandle.value.high = price
    if (price < currentCandle.value.low) currentCandle.value.low = price

    const isUp = currentCandle.value.close >= currentCandle.value.open
    const { color, wickColor } = getGtiColors(props.gti !== null && props.gti !== undefined ? { composite: props.gti / 100 } : undefined, isUp)
    currentCandle.value.color = color
    currentCandle.value.wickColor = wickColor
  }

  try {
    candleSeries.update(currentCandle.value)
  } catch (err) {
    console.warn('Lightweight charts live tick update warning:', err)
  }
}

function renderPriceLines() {
  if (!candleSeries) return

  if (resistanceLine) {
    candleSeries.removePriceLine(resistanceLine)
    resistanceLine = null
  }
  if (supportLine) {
    candleSeries.removePriceLine(supportLine)
    supportLine = null
  }
  if (vwapLine) {
    candleSeries.removePriceLine(vwapLine)
    vwapLine = null
  }

  if (props.overlays?.pocVah) {
    if (props.resistance) {
      resistanceLine = candleSeries.createPriceLine({
        price: props.resistance,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'RESISTANCE',
      })
    }
    if (props.support) {
      supportLine = candleSeries.createPriceLine({
        price: props.support,
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'SUPPORT',
      })
    }
  }

  if (props.overlays?.vwapEma && props.vwap) {
    vwapLine = candleSeries.createPriceLine({
      price: props.vwap,
      color: '#3b82f6',
      lineWidth: 1,
      lineStyle: 1,
      axisLabelVisible: true,
      title: 'VWAP',
    })
  }
}

watch(() => props.candles, () => {
  renderCandles()
}, { deep: true })

watch(() => props.livePrice, (newPrice) => {
  if (newPrice !== null && newPrice !== undefined) {
    updateLiveCandle(newPrice)
  }
})

watch(() => props.selectedTimeframe, () => {
  currentCandle.value = null
  renderCandles()
})

watch([() => props.resistance, () => props.support, () => props.vwap, () => props.overlays], () => {
  renderPriceLines()
}, { deep: true })

let resizeObserver: ResizeObserver | null = null

function handleResize() {
  if (chart && chartContainer.value) {
    const width = chartContainer.value.clientWidth
    const height = chartContainer.value.clientHeight
    if (width > 0 && height > 0) {
      chart.applyOptions({ width, height })
    }
  }
}

function setupResizeObserver() {
  if (!chartContainer.value) return
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0 || !chart) return
      const entry = entries[0]
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height })
      }
    })
    resizeObserver.observe(chartContainer.value)
  }
}

onMounted(() => {
  nextTick(() => {
    initChart()
    setupResizeObserver()
    window.addEventListener('resize', handleResize)
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (chart) {
    chart.remove()
    chart = null
  }
})
</script>
