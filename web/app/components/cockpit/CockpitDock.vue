<template>
  <footer class="bg-slate-900 border-t border-slate-800 flex flex-col">
    <!-- Bottom Tabs Bar -->
    <div class="px-4 py-1.5 border-b border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-xs">
      <div class="flex items-center gap-4">
        <button
          data-test="dock-tab-positions"
          type="button"
          @click="$emit('update:activeTab', 'positions')"
          class="font-bold flex items-center gap-1.5 transition"
          :class="activeTab === 'positions' ? 'text-indigo-400' : 'text-slate-400 hover:text-white'"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="marketState === 'open' && positions.length > 0 ? 'bg-emerald-400' : 'bg-slate-500'"
          ></span>
          <span>ACTIVE POSITIONS ({{ marketState === 'open' ? positions.length : '0 - SQUARED OFF' }})</span>
        </button>

        <button
          data-test="dock-tab-history"
          type="button"
          @click="$emit('update:activeTab', 'history')"
          class="font-medium flex items-center gap-1.5 transition"
          :class="activeTab === 'history' ? 'text-indigo-400 font-bold' : 'text-slate-400 hover:text-white'"
        >
          <span>TODAY'S CLOSED TRADES & FORENSIC LOGS ({{ closedTrades.length }})</span>
        </button>

        <button
          data-test="dock-tab-events"
          type="button"
          @click="$emit('update:activeTab', 'events')"
          class="font-medium flex items-center gap-1.5 transition"
          :class="activeTab === 'events' ? 'text-indigo-400 font-bold' : 'text-slate-400 hover:text-white'"
        >
          SYSTEM HEALTH & ENGINE LOGS
        </button>
      </div>

      <div class="text-xs text-slate-400 font-mono">
        <span v-if="marketState === 'open'">
          Active Risk: <span class="text-emerald-400 font-bold">{{ positions.length }}/2 Max Concurrent</span>
        </span>
        <span v-else>
          Overnight Exposure: <span class="text-indigo-300 font-bold">₹0.00 (Flat)</span>
        </span>
      </div>
    </div>

    <!-- Active Positions Table View -->
    <div
      v-if="activeTab === 'positions'"
      data-test="dock-positions-content"
      class="p-3 overflow-x-auto"
    >
      <table v-if="marketState === 'open' && positions.length > 0" class="w-full text-left text-xs font-mono">
        <thead>
          <tr class="text-slate-400 border-b border-slate-800/80 pb-1">
            <th class="py-1">INSTRUMENT</th>
            <th>MODE</th>
            <th>QTY</th>
            <th>ENTRY</th>
            <th>LTP</th>
            <th>PEAK (MFE)</th>
            <th>PROFIT RATCHET</th>
            <th>TRAILING SL</th>
            <th>UNREALIZED P&L</th>
            <th class="text-right">ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="pos in positions"
            :key="pos.id"
            data-test="position-row"
            class="border-b border-slate-800/40 text-slate-200 hover:bg-slate-800/30"
          >
            <td class="py-2.5 font-bold text-white flex items-center gap-2">
              <span
                class="px-1.5 py-0.5 rounded text-[10px]"
                :class="pos.type === 'CE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'"
              >
                {{ pos.type }}
              </span>
              {{ pos.symbol }}
            </td>
            <td><span class="text-indigo-400">{{ pos.mode }}</span></td>
            <td>{{ pos.quantity }}</td>
            <td>₹{{ pos.entryPrice.toFixed(2) }}</td>
            <td class="font-bold text-emerald-400">₹{{ pos.currentPrice.toFixed(2) }}</td>
            <td class="text-emerald-300">₹{{ pos.peakPrice.toFixed(2) }} (+{{ pos.peakPct.toFixed(1) }}%)</td>
            <td>
              <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[11px] font-bold">
                {{ pos.ratchetTierText }}
              </span>
            </td>
            <td class="text-slate-300 font-bold">₹{{ pos.stopLoss.toFixed(2) }}</td>
            <td
              class="font-bold text-sm"
              :class="pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'"
            >
              {{ pos.unrealizedPnl >= 0 ? '+' : '' }}₹{{ pos.unrealizedPnl.toFixed(2) }} ({{ pos.unrealizedPnlPct >= 0 ? '+' : '' }}{{ pos.unrealizedPnlPct.toFixed(1) }}%)
            </td>
            <td class="text-right space-x-2">
              <button
                data-test="scale-btn"
                type="button"
                @click="$emit('scalePosition', pos.id, 50)"
                class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 text-[11px]"
              >
                Scale 50%
              </button>
              <button
                data-test="close-btn"
                type="button"
                @click="$emit('closePosition', pos.id)"
                class="px-2 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 rounded border border-rose-700 text-[11px]"
              >
                Close
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Empty / Closed Mode Banner -->
      <div v-else class="py-6 text-center text-slate-400">
        <div class="flex flex-col items-center justify-center gap-1">
          <span class="text-sm font-bold text-slate-300">
            {{ marketState === 'open' ? 'No active open positions' : 'All intraday positions squared off' }}
          </span>
          <span class="text-xs text-slate-500">
            {{ marketState === 'open' ? 'Autonomous MAS is monitoring for new high-probability setups.' : 'Zero overnight exposure carried forward. Check the closed trades tab below.' }}
          </span>
        </div>
      </div>
    </div>

    <!-- Closed Trades & Forensic View -->
    <div
      v-else-if="activeTab === 'history'"
      data-test="dock-history-content"
      class="p-3 overflow-x-auto text-xs font-mono"
    >
      <div class="mb-2 text-slate-400 text-[11px] flex items-center justify-between">
        <span>Session Execution Matrix (All Positions Intraday Squared Off):</span>
        <span class="text-emerald-400 font-bold">
          Total Realized Net: +₹{{ closedTrades.reduce((acc, t) => acc + t.netPnl, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }) }}
        </span>
      </div>
      <table class="w-full text-left">
        <thead>
          <tr class="text-slate-400 border-b border-slate-800/80 pb-1">
            <th class="py-1">TRADE ID</th>
            <th>INSTRUMENT</th>
            <th>ENTRY</th>
            <th>EXIT</th>
            <th>EXIT ATTRIBUTION</th>
            <th>PEAK MFE</th>
            <th>MFE CAPTURE</th>
            <th>NET P&L</th>
            <th>FORENSIC VERDICT</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/40 text-slate-300">
          <tr v-for="t in closedTrades" :key="t.id" data-test="history-row">
            <td class="py-2 text-indigo-400">{{ t.id }}</td>
            <td class="font-bold text-white">{{ t.symbol }}</td>
            <td>₹{{ t.entryPrice.toFixed(2) }}</td>
            <td>₹{{ t.exitPrice.toFixed(2) }}</td>
            <td>
              <span
                class="font-bold"
                :class="t.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'"
              >
                {{ t.exitAttribution }}
              </span>
            </td>
            <td>+{{ t.peakMfePct.toFixed(1) }}%</td>
            <td>{{ t.mfeCapturePct > 0 ? t.mfeCapturePct.toFixed(1) + '%' : '-' }}</td>
            <td
              class="font-bold"
              :class="t.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'"
            >
              {{ t.netPnl >= 0 ? '+' : '' }}₹{{ t.netPnl.toFixed(2) }}
            </td>
            <td><span class="text-slate-400">{{ t.forensicVerdict }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Live Event Bus & Engine Health -->
    <div
      v-else-if="activeTab === 'events'"
      data-test="dock-events-content"
      class="p-3 font-mono text-xs max-h-32 overflow-y-auto space-y-1 text-slate-400"
    >
      <div v-for="(log, idx) in eventLogs" :key="idx" data-test="event-log-item">
        [{{ log.time }}] <span :class="log.tagColor">[{{ log.tag }}]</span> {{ log.message }}
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    activeTab?: 'positions' | 'history' | 'events'
    marketState?: 'open' | 'closed'
    positions?: Array<{
      id: string
      symbol: string
      type: 'CE' | 'PE'
      mode: string
      quantity: number
      entryPrice: number
      currentPrice: number
      peakPrice: number
      peakPct: number
      ratchetTierText: string
      stopLoss: number
      unrealizedPnl: number
      unrealizedPnlPct: number
    }>
    closedTrades?: Array<{
      id: string
      symbol: string
      entryPrice: number
      exitPrice: number
      exitAttribution: string
      peakMfePct: number
      mfeCapturePct: number
      netPnl: number
      forensicVerdict: string
    }>
    eventLogs?: Array<{ time: string; tag: string; message: string; tagColor: string }>
  }>(),
  {
    activeTab: 'positions',
    marketState: 'open',
    positions: () => [
      {
        id: 'pos-1',
        symbol: 'NIFTY 24200 CE',
        type: 'CE',
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
    ],
    closedTrades: () => [
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
    ],
    eventLogs: () => [
      { time: '21:58:12', tag: 'WS_TICK', message: 'KiteTicker heartbeat: 0 dropped frames. Session alive.', tagColor: 'text-indigo-400' },
      { time: '21:58:14', tag: 'RATCHET_EVAL', message: 'Retract Guard active. Noise Floor Gate (6.0%) evaluated OK.', tagColor: 'text-emerald-400' },
      { time: '21:58:16', tag: 'CRITIC_PING', message: 'Red-Team Adversarial check passed with minor note (low theta risk).', tagColor: 'text-amber-400' },
      { time: '21:58:20', tag: 'BROKER_AUTH', message: 'Zerodha Kite Token: VALID (Expires in 7h 14m at 06:00 AM).', tagColor: 'text-purple-400' },
    ],
  }
)

defineEmits<{
  (e: 'update:activeTab', tab: 'positions' | 'history' | 'events'): void
  (e: 'scalePosition', id: string, pct: number): void
  (e: 'closePosition', id: string): void
}>()
</script>
