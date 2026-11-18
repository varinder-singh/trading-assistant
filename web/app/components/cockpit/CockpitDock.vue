<template>
  <!-- 1. DESKTOP DOCK MODE (Default: unchanged desktop multi-pane dock) -->
  <footer v-if="!mobileView" class="bg-slate-900 border-t border-slate-800 flex flex-col">
    <!-- Bottom Tabs Bar -->
    <div class="shrink-0 px-4 py-1.5 border-b border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-xs">
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
            :class="positions.length > 0 ? 'bg-emerald-400 animate-pulse' : (marketState === 'open' ? 'bg-emerald-500' : 'bg-slate-500')"
          ></span>
          <span>ACTIVE POSITIONS ({{ positions.length }})</span>
          <span
            v-if="positions.length > 0"
            class="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded text-[10px] font-bold"
          >
            RUNNING
          </span>
        </button>

        <button
          data-test="dock-tab-history"
          type="button"
          @click="$emit('update:activeTab', 'history')"
          class="font-medium flex items-center gap-1.5 transition"
          :class="activeTab === 'history' ? 'text-indigo-400 font-bold' : 'text-slate-400 hover:text-white'"
        >
          <span>TODAY'S CLOSED TRADES & FORENSIC LOGS ({{ displayedTrades.length }})</span>
        </button>

        <button
          data-test="dock-tab-events"
          type="button"
          @click="$emit('update:activeTab', 'events')"
          class="font-medium flex items-center gap-1.5 transition"
          :class="activeTab === 'events' ? 'text-indigo-400 font-bold' : 'text-slate-400 hover:text-white'"
        >
          SYSTEM HEALTH & ENGINE LOGS ({{ eventLogs.length }})
        </button>
      </div>

      <div class="text-xs text-slate-400 font-mono">
        <span v-if="marketState === 'open'">
          Active Positions: <span class="text-emerald-400 font-bold">{{ positions.length }}</span>
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
      class="p-3 overflow-y-auto max-h-[175px]"
    >
      <table v-if="positions.length > 0" class="w-full text-left text-xs font-mono">
        <thead>
          <tr class="text-slate-400 border-b border-slate-800/80 pb-1">
            <th class="py-1">INSTRUMENT</th>
            <th>MODE</th>
            <th>QTY</th>
            <th>ENTRY</th>
            <th>LTP</th>
            <th>TRAILING SL</th>
            <th>TARGET STATUS</th>
            <th>UNREALIZED P&L</th>
            <th class="text-right">ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="pos in positions"
            :key="pos.id || pos.symbol"
            data-test="position-row"
            class="border-b border-slate-800/40 text-slate-200 hover:bg-slate-800/30"
          >
            <td class="py-2.5 font-bold text-white flex items-center gap-2">
              <span
                class="px-1.5 py-0.5 rounded text-[10px]"
                :class="pos.symbol?.endsWith('PE') ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'"
              >
                {{ pos.symbol?.endsWith('PE') ? 'PE' : 'CE' }}
              </span>
              <span>{{ pos.symbol }}</span>
            </td>
            <td><span class="text-indigo-400 font-semibold">{{ pos.product || 'PAPER' }}</span></td>
            <td>{{ pos.quantity }}</td>
            <td>₹{{ Number(pos.avgEntryPrice || pos.buyPrice || pos.price || 0).toFixed(2) }}</td>
            <td class="font-bold text-emerald-400">₹{{ Number(pos.currentPrice || pos.lastPrice || pos.avgEntryPrice || 0).toFixed(2) }}</td>
            <td>
              <div class="flex items-center gap-1.5">
                <span class="text-rose-400 font-bold">
                  ₹{{ (pos.trailingSlLocked || pos.aiStopLoss || pos.stopLoss) ? Number(pos.trailingSlLocked || pos.aiStopLoss || pos.stopLoss).toFixed(2) : '—' }}
                </span>
                <span
                  v-if="pos.trailingSlLocked"
                  class="text-[9px] px-1 py-0.2 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded font-bold"
                >
                  LOCKED
                </span>
              </div>
            </td>
            <td>
              <div class="flex items-center gap-2 text-[11px]">
                <span v-if="pos.t1Target" class="flex items-center gap-1">
                  <span class="text-slate-400">T1:</span>
                  <span :class="pos.t1Hit ? 'text-amber-400 font-bold line-through' : 'text-slate-200'">₹{{ Number(pos.t1Target).toFixed(2) }}</span>
                  <span v-if="pos.t1Hit" class="text-amber-400 font-black">🥇 HIT</span>
                </span>
                <span v-if="pos.t2Target" class="flex items-center gap-1">
                  <span class="text-slate-400">T2:</span>
                  <span :class="pos.t2Hit ? 'text-amber-400 font-bold line-through' : 'text-slate-200'">₹{{ Number(pos.t2Target).toFixed(2) }}</span>
                  <span v-if="pos.t2Hit" class="text-amber-400 font-black">🥈 HIT</span>
                </span>
                <span v-if="!pos.t1Target && pos.aiTarget" class="text-slate-200">
                  Target: ₹{{ Number(pos.aiTarget).toFixed(2) }}
                </span>
              </div>
            </td>
            <td
              class="font-bold text-sm"
              :class="(pos.unrealizedPnL || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
            >
              {{ (pos.unrealizedPnL || 0) >= 0 ? '+' : '' }}₹{{ Number(pos.unrealizedPnL || 0).toFixed(2) }}
            </td>
            <td class="text-right space-x-2">
              <button
                data-test="close-btn"
                type="button"
                @click="$emit('closePosition', pos.id || pos.symbol)"
                class="px-2.5 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 rounded border border-rose-700 text-[11px] font-bold transition"
              >
                Close
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Real Empty Banner -->
      <div v-else class="py-6 text-center text-slate-400">
        <div class="flex flex-col items-center justify-center gap-1">
          <span class="text-sm font-bold text-slate-300">
            {{ marketState === 'open' ? 'No active open positions' : 'All intraday positions squared off' }}
          </span>
          <span class="text-xs text-slate-500">
            {{ marketState === 'open' ? 'Autonomous MAS is monitoring for new high-probability setups.' : 'Zero overnight exposure carried forward. Check the "Trade History" tab below.' }}
          </span>
        </div>
      </div>
    </div>

    <!-- Closed Trades & Forensic View -->
    <div
      v-else-if="activeTab === 'history'"
      data-test="dock-history-content"
      class="p-3 overflow-y-auto max-h-[175px] text-xs font-mono"
    >
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-slate-400 text-[11px]">
        <!-- Filter Toggle -->
        <div class="flex items-center gap-2">
          <span class="text-slate-500">FILTER:</span>
          <button
            type="button"
            @click="historyFilter = 'all'"
            class="px-2 py-0.5 rounded transition"
            :class="historyFilter === 'all' ? 'bg-indigo-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:text-white'"
          >
            All Historical Trades ({{ tradeHistory.length }})
          </button>
          <button
            type="button"
            @click="historyFilter = 'today'"
            class="px-2 py-0.5 rounded transition"
            :class="historyFilter === 'today' ? 'bg-indigo-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:text-white'"
          >
            Today's Trades ({{ todaysTrades.length }})
          </button>
        </div>

        <div class="text-slate-300">
          Total Net P&L:
          <span
            class="font-bold"
            :class="totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'"
          >
            {{ totalPnl >= 0 ? '+' : '' }}₹{{ totalPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 }) }}
          </span>
        </div>
      </div>

      <table v-if="displayedTrades.length > 0" class="w-full text-left">
        <thead>
          <tr class="text-slate-400 border-b border-slate-800/80 pb-1">
            <th class="py-1">TIME (IST)</th>
            <th>TRADE ID</th>
            <th>INSTRUMENT</th>
            <th>SIDE</th>
            <th>QTY</th>
            <th>ENTRY</th>
            <th>EXIT</th>
            <th>EXIT REASON</th>
            <th>NET P&L</th>
            <th>AI CONFIDENCE</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/40 text-slate-300">
          <template v-for="t in paginatedTrades" :key="t.id">
            <tr
              data-test="history-row"
              @click="toggleExpand(t.id)"
              class="hover:bg-slate-800/40 cursor-pointer transition select-none"
              :class="expandedTradeId === t.id ? 'bg-slate-800/50' : ''"
            >
              <td class="py-2 text-slate-400">
                <span class="inline-flex items-center gap-1">
                  <span class="text-[10px] text-slate-500">{{ expandedTradeId === t.id ? '▼' : '▶' }}</span>
                  {{ formatTimestamp(t.closedAt || t.istClose || t.updatedAt || t.openedAt || t.istOpen) }}
                </span>
              </td>
              <td class="text-indigo-400">{{ t.id?.slice(0, 8) }}</td>
              <td class="font-bold text-white">{{ t.symbol }}</td>
              <td>
                <span
                  class="px-1 py-0.5 rounded text-[10px] font-bold"
                  :class="t.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'"
                >
                  {{ t.side }}
                </span>
              </td>
              <td>{{ t.quantity }}</td>
              <td>₹{{ Number(t.entryPrice || 0).toFixed(2) }}</td>
              <td>{{ t.exitPrice ? '₹' + Number(t.exitPrice).toFixed(2) : '—' }}</td>
              <td>
                <span
                  class="font-bold"
                  :class="(Number(t.pnl) || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
                >
                  {{ getTradeExitReason(t) }}
                </span>
              </td>
              <td
                class="font-bold"
                :class="(Number(t.pnl) || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
              >
                {{ t.pnl !== null && t.pnl !== undefined ? ((Number(t.pnl) || 0) >= 0 ? '+' : '') + '₹' + Number(t.pnl).toFixed(2) : '—' }}
              </td>
              <td class="text-slate-400">
                {{ getTradeAiConfidence(t) ? getTradeAiConfidence(t) + '%' : (getTradeAiReasoning(t) ? 'Analyzed' : '—') }}
              </td>
            </tr>

            <!-- Expandable Forensic Detail Panel -->
            <tr v-if="expandedTradeId === t.id" class="bg-slate-950/80 border-b border-slate-800">
              <td colspan="10" class="p-3">
                <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3 text-xs font-mono space-y-2">
                  <div class="flex flex-wrap items-center justify-between text-slate-400 border-b border-slate-800/80 pb-1.5 gap-2">
                    <span class="font-bold text-indigo-400 flex items-center gap-1.5">
                      <span>🔬</span> FORENSIC AUDIT & DECISION TRACE
                    </span>
                    <span class="text-[11px] text-slate-500">ID: {{ t.id }} | Mode: {{ t.mode || 'PAPER' }}</span>
                  </div>
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                    <div>
                      <span class="text-slate-500 block text-[10px] uppercase">Strategy Setup</span>
                      <span class="text-slate-200 font-bold">{{ getTradeSetup(t) }}</span>
                    </div>
                    <div>
                      <span class="text-slate-500 block text-[10px] uppercase">Market Regime & VIX</span>
                      <span class="text-slate-200">VIX: {{ getTradeVix(t) }} | RSI: {{ getTradeRsi(t) }} | Trend: {{ getTradeTrend(t) }}</span>
                    </div>
                    <div>
                      <span class="text-slate-500 block text-[10px] uppercase">Exit Reason & Protection</span>
                      <span :class="(Number(t.pnl) || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'" class="font-bold">
                        {{ getTradeExitReason(t) }}
                      </span>
                    </div>
                  </div>
                  <div v-if="getTradeAiReasoning(t)" class="p-2.5 bg-slate-950 rounded border border-slate-800 text-slate-300 text-[11px] leading-relaxed">
                    <span class="text-indigo-400 font-bold">AI Reasoning: </span>
                    {{ getTradeAiReasoning(t) }}
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <!-- Pagination Controls -->
      <div v-if="totalPages > 1" class="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
        <div>
          Showing <span class="text-white font-bold">{{ (currentPage - 1) * pageSize + 1 }}-{{ Math.min(currentPage * pageSize, displayedTrades.length) }}</span> of <span class="text-white font-bold">{{ displayedTrades.length }}</span> trades
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            data-test="prev-page-btn"
            @click="currentPage--"
            :disabled="currentPage === 1"
            class="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            ◀ Prev
          </button>
          <span class="font-mono text-slate-300">Page {{ currentPage }} of {{ totalPages }}</span>
          <button
            type="button"
            data-test="next-page-btn"
            @click="currentPage++"
            :disabled="currentPage === totalPages"
            class="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            Next ▶
          </button>
        </div>
      </div>

      <!-- Empty State for History -->
      <div v-else-if="displayedTrades.length === 0" class="py-8 text-center text-slate-500">
        No {{ historyFilter === 'today' ? "trades recorded today." : "trades recorded in database yet for this account." }}
      </div>
    </div>

    <!-- Live Event Bus & Engine Health -->
    <div
      v-else-if="activeTab === 'events'"
      data-test="dock-events-content"
      class="p-3 font-mono text-xs max-h-[175px] overflow-y-auto space-y-1.5 text-slate-400"
    >
      <div v-for="(log, idx) in eventLogs" :key="idx" data-test="event-log-item" class="flex items-start gap-2 hover:bg-slate-800/40 p-1 rounded transition">
        <span class="text-slate-500 whitespace-nowrap">[{{ log.time }}]</span>
        <span class="font-bold whitespace-nowrap" :class="log.tagColor">[{{ log.tag }}]</span>
        <span class="text-slate-200 leading-relaxed break-words flex-1">{{ log.message }}</span>
      </div>
      <div v-if="eventLogs.length === 0" class="text-center py-6 text-slate-500">
        No recent system events logged.
      </div>
    </div>
  </footer>

  <!-- 2. MOBILE FULL-HEIGHT VIEW MODE (Thumb-friendly cards, zero horizontal table squishing) -->
  <div v-else class="flex-1 min-h-0 flex flex-col bg-slate-900 overflow-hidden">
    <!-- Active Positions Mobile View -->
    <div
      v-if="activeTab === 'positions'"
      data-test="dock-positions-content"
      class="flex-1 min-h-0 flex flex-col overflow-hidden"
    >
      <div class="shrink-0 px-4 py-2 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs">
        <div class="flex items-center gap-2 font-bold text-white">
          <span
            class="w-2 h-2 rounded-full"
            :class="positions.length > 0 ? 'bg-emerald-400 animate-pulse' : (marketState === 'open' ? 'bg-emerald-500' : 'bg-slate-500')"
          ></span>
          <span>ACTIVE POSITIONS ({{ positions.length }})</span>
        </div>
        <div v-if="positions.length > 0" class="text-xs font-mono">
          Total Unrealized:
          <span class="font-bold" :class="totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'">
            {{ totalUnrealizedPnl >= 0 ? '+' : '' }}₹{{ totalUnrealizedPnl.toFixed(2) }}
          </span>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <div
          v-for="pos in positions"
          :key="pos.id || pos.symbol"
          data-test="position-row"
          class="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2.5 shadow-sm"
        >
          <!-- Row 1: Symbol, CE/PE badge, Mode, and Unrealized P&L -->
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2">
              <span
                class="px-1.5 py-0.5 rounded text-[10px] font-bold"
                :class="pos.symbol?.endsWith('PE') ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'"
              >
                {{ pos.symbol?.endsWith('PE') ? 'PE' : 'CE' }}
              </span>
              <span class="font-bold text-sm text-white font-mono">{{ pos.symbol }}</span>
              <span class="text-[10px] px-1.5 py-0.2 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded font-semibold">{{ pos.product || 'PAPER' }}</span>
            </div>
            <div
              class="font-mono font-bold text-base"
              :class="(pos.unrealizedPnL || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
            >
              {{ (pos.unrealizedPnL || 0) >= 0 ? '+' : '' }}₹{{ Number(pos.unrealizedPnL || 0).toFixed(2) }}
            </div>
          </div>

          <!-- Row 2: Quantities & Prices Grid -->
          <div class="grid grid-cols-3 gap-2 text-xs font-mono bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
            <div>
              <div class="text-[10px] text-slate-500">QTY</div>
              <div class="text-slate-200 font-semibold">{{ pos.quantity }}</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-500">AVG ENTRY</div>
              <div class="text-slate-200 font-semibold">₹{{ Number(pos.avgEntryPrice || pos.buyPrice || pos.price || 0).toFixed(2) }}</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-500">LTP</div>
              <div class="text-emerald-400 font-bold">₹{{ Number(pos.currentPrice || pos.lastPrice || pos.avgEntryPrice || 0).toFixed(2) }}</div>
            </div>
          </div>

          <!-- Row 3: Target & Trailing SL -->
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div class="flex items-center gap-1.5">
              <span class="text-slate-400 text-[11px]">SL:</span>
              <span class="text-rose-400 font-bold">
                ₹{{ (pos.trailingSlLocked || pos.aiStopLoss || pos.stopLoss) ? Number(pos.trailingSlLocked || pos.aiStopLoss || pos.stopLoss).toFixed(2) : '—' }}
              </span>
              <span
                v-if="pos.trailingSlLocked"
                class="text-[9px] px-1 py-0.2 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded font-bold"
              >
                LOCKED
              </span>
            </div>

            <div class="text-[11px]">
              <span v-if="pos.t1Target" class="inline-flex items-center gap-1">
                <span class="text-slate-400">T1:</span>
                <span :class="pos.t1Hit ? 'text-amber-400 font-bold line-through' : 'text-slate-200'">₹{{ Number(pos.t1Target).toFixed(2) }}</span>
                <span v-if="pos.t1Hit" class="text-amber-400 font-black">🥇 HIT</span>
              </span>
              <span v-else-if="pos.aiTarget" class="text-slate-200">
                Target: ₹{{ Number(pos.aiTarget).toFixed(2) }}
              </span>
            </div>
          </div>

          <!-- Row 4: Action Button -->
          <button
            data-test="close-btn"
            type="button"
            @click="$emit('closePosition', pos.id || pos.symbol)"
            class="w-full py-2 bg-rose-950/80 hover:bg-rose-900 border border-rose-700/80 text-rose-200 hover:text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-[0.98]"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
            <span>Square Off Position</span>
          </button>
        </div>

        <!-- Empty Banner -->
        <div v-if="positions.length === 0" class="py-12 text-center text-slate-400 px-4">
          <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 text-xl">
            💼
          </div>
          <div class="text-sm font-bold text-slate-300">
            {{ marketState === 'open' ? 'No active open positions' : 'All intraday positions squared off' }}
          </div>
          <div class="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
            {{ marketState === 'open' ? 'Autonomous MAS is monitoring for new high-probability setups.' : 'Zero overnight exposure carried forward. Check the "Forensics" tab for today\'s trade autopsies.' }}
          </div>
        </div>
      </div>
    </div>

    <!-- Closed Trades & Forensic Mobile View -->
    <div
      v-else-if="activeTab === 'history'"
      data-test="dock-history-content"
      class="flex-1 min-h-0 flex flex-col overflow-hidden text-xs font-mono h-full w-full"
    >
      <!-- Filter Bar & Net P&L Summary (Sticky Top) -->
      <div class="shrink-0 p-3 border-b border-slate-800 bg-slate-900/90 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-white flex items-center gap-1.5">
            <span>🔬</span> CLOSED TRADES & FORENSICS
          </span>
          <div class="text-xs font-mono text-slate-300">
            Net P&L:
            <span
              class="font-bold"
              :class="totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'"
            >
              {{ totalPnl >= 0 ? '+' : '' }}₹{{ totalPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 }) }}
            </span>
          </div>
        </div>

        <!-- Filter Toggle -->
        <div class="flex items-center gap-2 text-xs">
          <button
            type="button"
            @click="historyFilter = 'today'"
            class="flex-1 py-1.5 rounded-lg text-center font-medium transition"
            :class="historyFilter === 'today' ? 'bg-indigo-600 text-white font-bold shadow-sm' : 'bg-slate-800 text-slate-400 hover:text-white'"
          >
            Today's Trades ({{ todaysTrades.length }})
          </button>
          <button
            type="button"
            @click="historyFilter = 'all'"
            class="flex-1 py-1.5 rounded-lg text-center font-medium transition"
            :class="historyFilter === 'all' ? 'bg-indigo-600 text-white font-bold shadow-sm' : 'bg-slate-800 text-slate-400 hover:text-white'"
          >
            All History ({{ tradeHistory.length }})
          </button>
        </div>
      </div>

      <!-- Trade Cards List (Scrollable Center) -->
      <div class="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <div
          v-for="t in paginatedTrades"
          :key="t.id"
          data-test="history-row"
          @click="toggleExpand(t.id)"
          class="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2.5 transition cursor-pointer select-none"
          :class="expandedTradeId === t.id ? 'border-indigo-500/60 ring-1 ring-indigo-500/40 bg-slate-900/70' : 'hover:border-slate-700'"
        >
          <!-- Header row: Time, Side, Instrument, Net PnL -->
          <div class="flex items-start justify-between gap-2">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono"
                  :class="t.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'"
                >
                  {{ t.side }}
                </span>
                <span class="font-bold text-white font-mono text-sm">{{ t.symbol }}</span>
              </div>
              <div class="text-[11px] text-slate-500 font-mono">
                {{ formatTimestamp(t.closedAt || t.istClose || t.updatedAt || t.openedAt || t.istOpen) }} • ID: {{ t.id?.slice(0, 8) }}
              </div>
            </div>
            <div
              class="font-mono font-bold text-base"
              :class="(Number(t.pnl) || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
            >
              {{ t.pnl !== null && t.pnl !== undefined ? ((Number(t.pnl) || 0) >= 0 ? '+' : '') + '₹' + Number(t.pnl).toFixed(2) : '—' }}
            </div>
          </div>

          <!-- Quantities & Prices Grid -->
          <div class="grid grid-cols-3 gap-2 text-xs font-mono bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
            <div>
              <div class="text-[10px] text-slate-500">QTY</div>
              <div class="text-slate-200">{{ t.quantity }}</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-500">ENTRY ➔ EXIT</div>
              <div class="text-slate-200">₹{{ Number(t.entryPrice || 0).toFixed(1) }} ➔ {{ t.exitPrice ? '₹' + Number(t.exitPrice).toFixed(1) : '—' }}</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-500">CONFIDENCE</div>
              <div class="text-indigo-300 font-semibold">{{ getTradeAiConfidence(t) ? getTradeAiConfidence(t) + '%' : (getTradeAiReasoning(t) ? 'Analyzed' : '—') }}</div>
            </div>
          </div>

          <!-- Exit Reason & Expand Hint -->
          <div class="flex items-center justify-between text-xs pt-0.5">
            <div class="flex items-center gap-1.5 font-mono">
              <span class="text-slate-500 text-[11px]">EXIT:</span>
              <span
                class="font-bold"
                :class="(Number(t.pnl) || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'"
              >
                {{ getTradeExitReason(t) }}
              </span>
            </div>
            <div class="text-indigo-400 font-medium text-[11px] flex items-center gap-1">
              <span>{{ expandedTradeId === t.id ? 'Hide Forensic Trace ▲' : 'View Forensic Trace ▼' }}</span>
            </div>
          </div>

          <!-- Expandable Forensic Panel -->
          <div v-if="expandedTradeId === t.id" class="pt-2 border-t border-slate-800 space-y-2 font-mono text-xs">
            <div class="text-indigo-400 font-bold flex items-center gap-1 text-[11px]">
              <span>🔬</span> FORENSIC AUDIT & DECISION TRACE
            </div>
            <div class="space-y-1.5 bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-[11px]">
              <div>
                <span class="text-slate-500 block text-[10px] uppercase">Strategy Setup</span>
                <span class="text-slate-200 font-bold">{{ getTradeSetup(t) }}</span>
              </div>
              <div>
                <span class="text-slate-500 block text-[10px] uppercase">Market Regime & VIX</span>
                <span class="text-slate-200">VIX: {{ getTradeVix(t) }} | RSI: {{ getTradeRsi(t) }} | Trend: {{ getTradeTrend(t) }}</span>
              </div>
              <div>
                <span class="text-slate-500 block text-[10px] uppercase">Exit Verdict & Protection</span>
                <span :class="(Number(t.pnl) || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'" class="font-bold">
                  {{ getTradeExitReason(t) }}
                </span>
              </div>
              <div v-if="getTradeAiReasoning(t)" class="pt-1.5 border-t border-slate-800/80 text-slate-300 leading-relaxed">
                <span class="text-indigo-400 font-bold">AI Reasoning: </span>
                {{ getTradeAiReasoning(t) }}
              </div>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="displayedTrades.length === 0" class="py-12 text-center text-slate-400 px-4 space-y-3">
          <div class="text-sm font-bold text-slate-300">
            {{ historyFilter === 'today' ? "No trades recorded today." : "No trades recorded in database yet for this account." }}
          </div>
          <p class="text-xs text-slate-500">
            {{ historyFilter === 'today' ? "No closed intraday positions have been executed today." : "Historical trade logs will appear here once executed." }}
          </p>
          <button
            v-if="historyFilter === 'today' && tradeHistory.length > 0"
            type="button"
            @click="historyFilter = 'all'"
            class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition shadow-sm inline-flex items-center gap-1.5"
          >
            <span>📜</span> View All {{ tradeHistory.length }} Historical Trades
          </button>
        </div>
      </div>

      <!-- Sticky Pagination Controls (ALWAYS VISIBLE when trades exist) -->
      <div
        v-if="displayedTrades.length > 0"
        data-test="mobile-pagination-bar"
        class="shrink-0 px-3 py-2 border-t border-slate-800 bg-slate-900/95 flex items-center justify-between text-xs text-slate-400 font-mono"
      >
        <button
          type="button"
          data-test="prev-page-btn"
          @click.stop="currentPage--"
          :disabled="currentPage <= 1"
          class="px-3 py-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          ◀ Prev
        </button>
        <span class="text-slate-300 font-mono">
          Page {{ currentPage }} of {{ totalPages }} <span class="text-slate-500">({{ displayedTrades.length }} trades)</span>
        </span>
        <button
          type="button"
          data-test="next-page-btn"
          @click.stop="currentPage++"
          :disabled="currentPage >= totalPages"
          class="px-3 py-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          Next ▶
        </button>
      </div>
    </div>

    <!-- Live Event Bus & Engine Health Mobile View -->
    <div
      v-else-if="activeTab === 'events'"
      data-test="dock-events-content"
      class="flex-1 min-h-0 flex flex-col overflow-hidden text-xs font-mono"
    >
      <div class="shrink-0 px-4 py-2 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs">
        <span class="font-bold text-white flex items-center gap-1.5">
          <span>📋</span> SYSTEM HEALTH & ENGINE LOGS ({{ eventLogs.length }})
        </span>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5 text-slate-400">
        <div v-for="(log, idx) in eventLogs" :key="idx" data-test="event-log-item" class="flex items-start gap-2 hover:bg-slate-800/40 p-1.5 rounded transition bg-slate-950/40 border border-slate-800/50">
          <span class="text-slate-500 whitespace-nowrap">[{{ log.time }}]</span>
          <span class="font-bold whitespace-nowrap" :class="log.tagColor">[{{ log.tag }}]</span>
          <span class="text-slate-200 leading-relaxed break-words flex-1">{{ log.message }}</span>
        </div>
        <div v-if="eventLogs.length === 0" class="text-center py-12 text-slate-500">
          No recent system events logged.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    activeTab?: 'positions' | 'history' | 'events'
    marketState?: 'open' | 'closed'
    positions?: Array<any>
    tradeHistory?: Array<any>
    eventLogs?: Array<{ time: string; tag: string; message: string; tagColor: string }>
    mobileView?: boolean
  }>(),
  {
    activeTab: 'history',
    marketState: 'closed',
    positions: () => [],
    tradeHistory: () => [],
    eventLogs: () => [],
    mobileView: false,
  }
)

defineEmits<{
  (e: 'update:activeTab', tab: 'positions' | 'history' | 'events'): void
  (e: 'closePosition', id: string): void
}>()

const historyFilter = ref<'all' | 'today'>('all')
const expandedTradeId = ref<string | null>(null)
const currentPage = ref(1)
const pageSize = ref(10)

watch(historyFilter, () => {
  currentPage.value = 1
})

function toggleExpand(id: string) {
  expandedTradeId.value = expandedTradeId.value === id ? null : id
}

function parseDate(dateInput: any): Date | null {
  if (!dateInput) return null
  if (dateInput instanceof Date) return isNaN(dateInput.getTime()) ? null : dateInput
  if (typeof dateInput === 'number') {
    const ms = dateInput < 1e11 ? dateInput * 1000 : dateInput
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof dateInput === 'string') {
    let s = dateInput.trim()
    if (s.includes(' ') && !s.includes('T')) {
      s = s.replace(' ', 'T')
    }
    if (s.includes('T') && !s.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(s)) {
      s = s + 'Z'
    }
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

function getISTDateStr(dateInput: any): string {
  const d = parseDate(dateInput)
  if (!d) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
}

function formatTimestamp(timestamp?: any): string {
  const d = parseDate(timestamp)
  if (!d) return '—'
  return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
}

const todayIST = computed(() => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
})

const todaysTrades = computed(() => {
  return props.tradeHistory.filter((t) => {
    const d = t.closedAt || t.istClose || t.updatedAt || t.openedAt || t.istOpen || t.createdAt || ''
    return getISTDateStr(d) === todayIST.value
  })
})

// Auto-switch to 'all' if today has 0 trades but historical trades exist
watch(
  () => [todaysTrades.value.length, props.tradeHistory.length],
  ([todayCount, allCount]) => {
    if (todayCount === 0 && allCount > 0 && historyFilter.value === 'today') {
      historyFilter.value = 'all'
    }
  },
  { immediate: true }
)

function getTradeExitReason(t: any): string {
  return t.exitReason || t.exitMetadata?.exitReason || t.forensicVerdict || t.status || 'CLOSED'
}

function getTradeAiReasoning(t: any): string {
  return t.aiReasoning || t.entryMetadata?.aiReasoning || t.forensicVerdict || ''
}

function getTradeAiConfidence(t: any): string | number {
  return t.aiConfidence || t.entryMetadata?.aiConfidence || ''
}

function getTradeSetup(t: any): string {
  return t.setup || t.entryMetadata?.setup || t.strategyContext || t.entryMetadata?.strategyContext?.agentType || 'Autonomous MAS Execution'
}

function getTradeVix(t: any): string | number {
  return t.vixLevel || t.entryMetadata?.vixLevel || '—'
}

function getTradeRsi(t: any): string | number {
  return t.rsiLevel || t.entryMetadata?.rsiLevel || '—'
}

function getTradeTrend(t: any): string {
  return t.trend15m || t.entryMetadata?.trend15m || t.entryMetadata?.strategyContext?.macroTrend || '—'
}

const displayedTrades = computed(() => {
  return historyFilter.value === 'today' ? todaysTrades.value : props.tradeHistory
})

const totalPages = computed(() => {
  return Math.max(1, Math.ceil(displayedTrades.value.length / pageSize.value))
})

const paginatedTrades = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return displayedTrades.value.slice(start, start + pageSize.value)
})

const totalPnl = computed(() => {
  return displayedTrades.value.reduce((acc, t) => acc + (Number(t.pnl) || 0), 0)
})

const totalUnrealizedPnl = computed(() => {
  return props.positions.reduce((acc, p) => acc + (Number(p.unrealizedPnL) || 0), 0)
})
</script>
