<script setup lang="ts">
import { ref, onMounted, watchEffect } from 'vue'
import { ArrowLeft, Save, User, Link as LinkIcon, ShieldCheck, CheckCircle2 } from '@lucide/vue'

const user = useSupabaseUser()
watchEffect(() => {
  if (!user.value) {
    navigateTo('/login')
  }
})

const loadingProfile = ref(true)
const savingProfile = ref(false)
const profileError = ref('')
const profileSuccess = ref('')

const fullName = ref('')
const email = ref('')

const tradeMode = ref<'PAPER' | 'REAL'>('PAPER')
const changingTradeMode = ref(false)

const allowIndexOptions = ref(true)
const allowEquity = ref(true)
const allowStockOptions = ref(true)
const stockOptionPreference = ref('PREFER_OPTIONS_IF_LISTED')
const equityHoldingMode = ref<'MIS' | 'CNC'>('MIS')
const equityRiskPerTrade = ref(1500)
const maxActivePositions = ref(10)
const maxIndexPositions = ref(2)
const maxDailyTrades = ref(30)
const enablePullbackEntry = ref(true)

const kiteApiKey = ref('')
const kiteApiSecret = ref('')
const hasSavedApiSecret = ref(false)

const enableUsMarket = ref(false)
const alpacaTradingMode = ref<'PAPER' | 'LIVE'>('PAPER')
const alpacaApiKey = ref('')
const alpacaApiSecret = ref('')
const hasSavedAlpacaSecret = ref(false)
const disconnectingAlpaca = ref(false)

const loadingConnections = ref(true)
const connections = ref<any[]>([])

// Fetch Profile
const fetchProfile = async () => {
  try {
    loadingProfile.value = true
    let data: any = null
    if (typeof $fetch === 'function') {
      data = await $fetch<any>('/api/profile')
    } else {
      const response = await useFetch<any>('/api/profile')
      if (response.error.value) throw response.error.value
      data = response.data.value
    }

    if (data) {
      fullName.value = data.fullName || ''
      email.value = data.email || user.value?.email || ''
      tradeMode.value = data.tradeMode || 'PAPER'

      if (data.allowedUniverses) {
        allowIndexOptions.value = data.allowedUniverses.includes('INDEX_OPTIONS')
        allowEquity.value = data.allowedUniverses.includes('EQUITY')
        allowStockOptions.value = data.allowedUniverses.includes('STOCK_OPTIONS')
      }
      if (data.stockOptionPreference) stockOptionPreference.value = data.stockOptionPreference
      if (data.equityHoldingMode) equityHoldingMode.value = data.equityHoldingMode
      if (data.equityRiskPerTrade) equityRiskPerTrade.value = Number(data.equityRiskPerTrade) || 1500
      if (data.maxActivePositions !== undefined && data.maxActivePositions !== null) {
        maxActivePositions.value = Number(data.maxActivePositions) || 10
      }
      if (data.maxIndexPositions !== undefined && data.maxIndexPositions !== null) {
        maxIndexPositions.value = Number(data.maxIndexPositions)
      }
      if (data.maxDailyTrades !== undefined && data.maxDailyTrades !== null) {
        maxDailyTrades.value = Number(data.maxDailyTrades) || 30
      }
      if (data.enablePullbackEntry !== undefined && data.enablePullbackEntry !== null) {
        enablePullbackEntry.value = Boolean(data.enablePullbackEntry)
      }
      if (data.enableUsMarket !== undefined && data.enableUsMarket !== null) {
        enableUsMarket.value = Boolean(data.enableUsMarket)
      }
      if (data.alpacaTradingMode) {
        alpacaTradingMode.value = data.alpacaTradingMode === 'LIVE' ? 'LIVE' : 'PAPER'
      }
    }
  } catch (err: any) {
    console.error('Failed to load profile:', err)
    profileError.value = 'Failed to load profile data.'
  } finally {
    loadingProfile.value = false
  }
}

// Fetch Connections
const fetchConnections = async () => {
  try {
    loadingConnections.value = true
    let data: any[] | null = null
    if (typeof $fetch === 'function') {
      data = await $fetch<any[]>('/api/profile/connections')
    } else {
      const response = await useFetch<any[]>('/api/profile/connections')
      if (response.error.value) throw response.error.value
      data = response.data.value
    }

    if (data) {
      connections.value = data
      const zerodha = data.find((c: any) => c.brokerName === 'zerodha')
      if (zerodha) {
        kiteApiKey.value = zerodha.apiKey || ''
        hasSavedApiSecret.value = zerodha.hasApiSecret || false
      }
      const alpaca = data.find((c: any) => c.brokerName === 'alpaca')
      if (alpaca) {
        alpacaApiKey.value = alpaca.apiKey || ''
        hasSavedAlpacaSecret.value = alpaca.hasApiSecret || false
        if (alpaca.tradingMode) {
          alpacaTradingMode.value = alpaca.tradingMode === 'LIVE' ? 'LIVE' : 'PAPER'
        }
      } else {
        alpacaApiKey.value = ''
        hasSavedAlpacaSecret.value = false
      }
    }
  } catch (err: any) {
    console.error('Failed to load connections:', err)
  } finally {
    loadingConnections.value = false
  }
}

const saveProfile = async () => {
  try {
    savingProfile.value = true
    profileError.value = ''
    profileSuccess.value = ''

    const universes: string[] = []
    if (allowIndexOptions.value) universes.push('INDEX_OPTIONS')
    if (allowEquity.value) universes.push('EQUITY')
    if (allowStockOptions.value) universes.push('STOCK_OPTIONS')

    const payload: any = {
      ...(fullName.value && fullName.value.trim().length > 0 ? { fullName: fullName.value.trim() } : {}),
      allowedUniverses: universes.join(','),
      stockOptionPreference: stockOptionPreference.value,
      equityHoldingMode: equityHoldingMode.value,
      equityRiskPerTrade: Number(equityRiskPerTrade.value) || 1500,
      maxActivePositions: Number(maxActivePositions.value) > 0 ? Number(maxActivePositions.value) : 10,
      maxIndexPositions: Number(maxIndexPositions.value) >= 0 ? Number(maxIndexPositions.value) : 2,
      maxDailyTrades: Number(maxDailyTrades.value) > 0 ? Number(maxDailyTrades.value) : 30,
      enablePullbackEntry: Boolean(enablePullbackEntry.value),
      enableUsMarket: Boolean(enableUsMarket.value),
      alpacaTradingMode: alpacaTradingMode.value,
    }

    if (kiteApiKey.value && kiteApiSecret.value) {
      payload.kiteApiKey = kiteApiKey.value
      payload.kiteApiSecret = kiteApiSecret.value
    } else if (
      (kiteApiKey.value && !kiteApiSecret.value && !hasSavedApiSecret.value) ||
      (!kiteApiKey.value && kiteApiSecret.value)
    ) {
      profileError.value = 'Both Kite API Key and API Secret must be provided together.'
      savingProfile.value = false
      return
    }

    if (alpacaApiKey.value && alpacaApiSecret.value) {
      payload.alpacaApiKey = alpacaApiKey.value.trim()
      payload.alpacaApiSecret = alpacaApiSecret.value.trim()
    } else if (alpacaApiKey.value && hasSavedAlpacaSecret.value) {
      payload.alpacaApiKey = alpacaApiKey.value.trim()
    } else if (
      (!alpacaApiKey.value && alpacaApiSecret.value) ||
      (alpacaApiKey.value && !alpacaApiSecret.value && !hasSavedAlpacaSecret.value)
    ) {
      profileError.value = 'Both Alpaca API Key and API Secret must be provided together.'
      savingProfile.value = false
      return
    }

    if (typeof $fetch === 'function') {
      await $fetch('/api/profile', {
        method: 'PUT',
        body: payload,
      })
    } else {
      const { error } = await useFetch('/api/profile', {
        method: 'PUT',
        body: payload,
      })
      if (error.value) throw error.value
    }

    if (kiteApiSecret.value) {
      hasSavedApiSecret.value = true
      kiteApiSecret.value = '' // Clear after save for security
    }

    if (alpacaApiSecret.value) {
      hasSavedAlpacaSecret.value = true
      alpacaApiSecret.value = '' // Clear after save for security
    }

    profileSuccess.value = 'Settings updated successfully!'
    setTimeout(() => {
      profileSuccess.value = ''
    }, 3000)

    // Re-fetch profile and connections from server to confirm persistence
    await Promise.all([fetchProfile(), fetchConnections()])
  } catch (err: any) {
    console.error('Failed to update profile:', err)
    profileError.value = 'Failed to save changes: ' + (err.data?.statusMessage || err.message || 'Unknown error')
  } finally {
    savingProfile.value = false
  }
}

// Disconnect Alpaca Credentials
const disconnectAlpaca = async () => {
  const confirmDisconnect = window.confirm(
    'Are you sure you want to remove your Alpaca API credentials? US Market trading will be disabled.'
  )
  if (!confirmDisconnect) return

  try {
    disconnectingAlpaca.value = true
    profileError.value = ''
    profileSuccess.value = ''

    if (typeof $fetch === 'function') {
      await $fetch('/api/profile/broker?name=alpaca', { method: 'DELETE' })
    } else {
      await useFetch('/api/profile/broker?name=alpaca', { method: 'DELETE' })
    }

    alpacaApiKey.value = ''
    alpacaApiSecret.value = ''
    hasSavedAlpacaSecret.value = false
    enableUsMarket.value = false

    profileSuccess.value = 'Alpaca credentials removed successfully.'
    setTimeout(() => {
      profileSuccess.value = ''
    }, 3000)

    await Promise.all([fetchProfile(), fetchConnections()])
  } catch (err: any) {
    console.error('Failed to disconnect Alpaca:', err)
    profileError.value = 'Failed to remove Alpaca credentials: ' + (err.data?.statusMessage || err.message || 'Unknown error')
  } finally {
    disconnectingAlpaca.value = false
  }
}

// Toggle Trade Mode
const toggleTradeMode = async (newMode: 'PAPER' | 'REAL', force = false) => {
  if (newMode === 'REAL') {
    const confirmReal = window.confirm(
      'WARNING: Switching to REAL mode will place actual trades with real money. Are you absolutely sure?'
    )
    if (!confirmReal) return
  }

  try {
    changingTradeMode.value = true
    profileError.value = ''
    profileSuccess.value = ''

    await $fetch('/api/profile/trade-mode', {
      method: 'PUT',
      body: { tradeMode: newMode, force },
    })

    tradeMode.value = newMode
    profileSuccess.value = `Successfully switched to ${newMode} mode.`

    // Clear success message after 3 seconds
    setTimeout(() => {
      profileSuccess.value = ''
    }, 3000)
  } catch (err: any) {
    if (err.response?.status === 409 && err.response?._data?.statusMessage === 'OPEN_REAL_TRADES') {
      const confirmForce = window.confirm(
        err.response._data.message + '\\n\\nDo you want to force switch to PAPER anyway?'
      )
      if (confirmForce) {
        return toggleTradeMode('PAPER', true)
      }
    } else {
      profileError.value = 'Failed to switch mode: ' + (err.response?._data?.message || err.message)
    }
  } finally {
    changingTradeMode.value = false
  }
}

onMounted(() => {
  fetchProfile()
  fetchConnections()
})
</script>

<template>
  <div
    data-test="profile-scroll-container"
    class="h-screen overflow-y-auto bg-gray-50 text-gray-900 font-sans pb-16"
  >
    <!-- Header -->
    <header class="bg-white border-b border-gray-200 sticky top-0 z-20">
      <div class="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <NuxtLink to="/" class="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-900">
            <ArrowLeft class="w-5 h-5" />
          </NuxtLink>
          <h1 class="text-xl font-bold tracking-tight">Account Settings</h1>
        </div>
      </div>
    </header>

    <main class="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <!-- Trade Mode Settings -->
      <section class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div :class="tradeMode === 'REAL' ? 'bg-red-100' : 'bg-blue-100'" class="p-2 rounded-lg transition-colors">
              <ShieldCheck
                :class="tradeMode === 'REAL' ? 'text-red-600' : 'text-blue-600'"
                class="w-5 h-5 transition-colors"
              />
            </div>
            <div>
              <h2 class="text-lg font-semibold">Trading Mode</h2>
              <p class="text-sm text-gray-500">Determine if the AI places trades with real money</p>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <span class="text-sm font-medium" :class="tradeMode === 'REAL' ? 'text-gray-500' : 'text-blue-600'"
              >PAPER</span
            >
            <button
              @click="toggleTradeMode(tradeMode === 'PAPER' ? 'REAL' : 'PAPER')"
              :disabled="changingTradeMode"
              class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 disabled:opacity-50"
              :class="tradeMode === 'REAL' ? 'bg-red-600' : 'bg-gray-200'"
              role="switch"
            >
              <span class="sr-only">Toggle trading mode</span>
              <span
                aria-hidden="true"
                class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                :class="tradeMode === 'REAL' ? 'translate-x-5' : 'translate-x-0'"
              ></span>
            </button>
            <span class="text-sm font-medium" :class="tradeMode === 'REAL' ? 'text-red-600' : 'text-gray-500'"
              >REAL</span
            >
          </div>
        </div>
      </section>

      <!-- Profile Settings -->
      <section class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
          <div class="bg-indigo-100 p-2 rounded-lg">
            <User class="w-5 h-5 text-indigo-600" />
          </div>
          <h2 class="text-lg font-semibold">Personal Information</h2>
        </div>

        <div class="p-6 space-y-6">
          <div v-if="loadingProfile" class="flex items-center justify-center py-8">
            <div class="animate-spin w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full"></div>
          </div>

          <form v-else @submit.prevent="saveProfile" class="space-y-6">
            <div v-if="profileError" class="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
              {{ profileError }}
            </div>
            <div
              v-if="profileSuccess"
              class="p-3 bg-green-50 text-green-700 text-sm rounded-lg border border-green-100 flex items-center gap-2"
            >
              <CheckCircle2 class="w-4 h-4" />
              {{ profileSuccess }}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="space-y-2">
                <label class="text-sm font-medium text-gray-700">Full Name</label>
                <input
                  v-model="fullName"
                  type="text"
                  placeholder="e.g. John Doe"
                  class="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                />
              </div>

              <div class="space-y-2">
                <label class="text-sm font-medium text-gray-700">Email Address</label>
                <input
                  v-model="email"
                  type="email"
                  disabled
                  class="w-full px-4 py-2 bg-gray-50 border border-gray-200 text-gray-500 rounded-xl cursor-not-allowed"
                />
                <p class="text-xs text-gray-500">Email is managed via authentication provider.</p>
              </div>
            </div>

            <hr class="border-gray-100 my-6" />

            <div class="space-y-4">
              <h3 class="text-sm font-semibold text-gray-900">Kite Developer Credentials</h3>
              <p class="text-xs text-gray-500">
                To isolate your environment, provide your own Kite API Key and Secret.
                <a href="https://developers.kite.trade/" target="_blank" class="text-indigo-600 hover:underline"
                  >Get credentials here</a
                >.
              </p>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-2">
                  <label class="text-sm font-medium text-gray-700">API Key</label>
                  <input
                    v-model="kiteApiKey"
                    type="text"
                    placeholder="Your Kite Connect API Key"
                    class="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium text-gray-700 flex items-center justify-between">
                    API Secret
                    <span v-if="hasSavedApiSecret" class="text-xs text-green-600 flex items-center gap-1">
                      <ShieldCheck class="w-3 h-3" /> Saved Securely
                    </span>
                  </label>
                  <input
                    v-model="kiteApiSecret"
                    type="password"
                    placeholder="Enter to update (encrypted at rest)"
                    class="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>
            </div>

            <hr class="border-gray-100 my-6" />

            <!-- Alpaca Developer Credentials (US Market & Crypto) -->
            <div class="space-y-4">
              <div class="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <h3 class="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <span>Alpaca Markets Credentials</span>
                    <span
                      class="text-xs px-2 py-0.5 rounded-full font-medium"
                      :class="alpacaTradingMode === 'LIVE' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'"
                    >
                      {{ alpacaTradingMode === 'LIVE' ? 'Live US Equities' : 'Paper Sandbox' }}
                    </span>
                  </h3>
                  <p class="text-xs text-gray-500">
                    User-configured credentials stored securely in database (encrypted with AES-256-GCM).
                    <a href="https://alpaca.markets/" target="_blank" class="text-indigo-600 hover:underline">Get keys from Alpaca</a>.
                  </p>
                </div>

                <div class="flex items-center gap-2">
                  <label class="text-xs font-medium text-gray-600">Mode:</label>
                  <select
                    v-model="alpacaTradingMode"
                    data-test="alpaca-mode-select"
                    class="px-2.5 py-1 text-xs bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="PAPER">Paper Trading (Sandbox)</option>
                    <option value="LIVE">Live Trading (Real USD)</option>
                  </select>

                  <button
                    v-if="hasSavedAlpacaSecret || alpacaApiKey"
                    type="button"
                    @click="disconnectAlpaca"
                    :disabled="disconnectingAlpaca"
                    data-test="disconnect-alpaca-btn"
                    class="text-xs px-2.5 py-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition-colors disabled:opacity-50"
                  >
                    {{ disconnectingAlpaca ? 'Removing...' : 'Remove Keys' }}
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-2">
                  <label class="text-sm font-medium text-gray-700">Alpaca API Key ID</label>
                  <input
                    v-model="alpacaApiKey"
                    data-test="alpaca-api-key-input"
                    type="text"
                    placeholder="e.g. PK..."
                    class="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                  />
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium text-gray-700 flex items-center justify-between">
                    Alpaca API Secret Key
                    <span v-if="hasSavedAlpacaSecret" class="text-xs text-green-600 flex items-center gap-1">
                      <ShieldCheck class="w-3 h-3" /> Saved Securely
                    </span>
                  </label>
                  <input
                    v-model="alpacaApiSecret"
                    data-test="alpaca-api-secret-input"
                    type="password"
                    placeholder="Enter to update (encrypted at rest)"
                    class="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                  />
                </div>
              </div>
            </div>

            <!-- Multi-Asset Universe & Execution Settings -->
            <div class="pt-6 border-t border-gray-100 space-y-6">
              <div>
                <h3 class="text-base font-semibold text-gray-900">Trading Universe & Execution Preferences</h3>
                <p class="text-xs text-gray-500">Configure which asset classes the assistant monitors and how trades execute.</p>
              </div>

              <!-- Allowed Universes -->
              <div class="space-y-3">
                <label class="text-sm font-medium text-gray-700">Active Asset Classes & Markets</label>
                <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <label class="flex items-center gap-3 p-3.5 border rounded-xl cursor-pointer hover:bg-gray-50 transition-colors" :class="allowIndexOptions ? 'border-indigo-500 bg-indigo-50/30' : 'border-gray-200'">
                    <input type="checkbox" v-model="allowIndexOptions" class="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4" />
                    <div>
                      <span class="text-sm font-medium text-gray-900 block">NIFTY Options</span>
                      <span class="text-xs text-gray-500">Intraday Index Scalping</span>
                    </div>
                  </label>

                  <label class="flex items-center gap-3 p-3.5 border rounded-xl cursor-pointer hover:bg-gray-50 transition-colors" :class="allowEquity ? 'border-indigo-500 bg-indigo-50/30' : 'border-gray-200'">
                    <input type="checkbox" v-model="allowEquity" class="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4" />
                    <div>
                      <span class="text-sm font-medium text-gray-900 block">NSE Equities</span>
                      <span class="text-xs text-gray-500">Top 200 Liquid Stocks</span>
                    </div>
                  </label>

                  <label class="flex items-center gap-3 p-3.5 border rounded-xl cursor-pointer hover:bg-gray-50 transition-colors" :class="allowStockOptions ? 'border-indigo-500 bg-indigo-50/30' : 'border-gray-200'">
                    <input type="checkbox" v-model="allowStockOptions" class="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4" />
                    <div>
                      <span class="text-sm font-medium text-gray-900 block">Stock Options</span>
                      <span class="text-xs text-gray-500">NSE F&O Listed Stocks</span>
                    </div>
                  </label>

                  <label class="flex items-center gap-3 p-3.5 border rounded-xl cursor-pointer hover:bg-gray-50 transition-colors" :class="enableUsMarket ? 'border-indigo-500 bg-indigo-50/30' : 'border-gray-200'">
                    <input type="checkbox" v-model="enableUsMarket" data-test="enable-us-market-checkbox" class="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4" />
                    <div>
                      <span class="text-sm font-medium text-gray-900 block">US Market (Alpaca)</span>
                      <span class="text-xs text-gray-500">NYSE / NASDAQ Equities</span>
                    </div>
                  </label>
                </div>
              </div>

              <!-- Holding Mode (Scenario A vs B) & Sizing -->
              <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="space-y-2">
                  <label class="text-sm font-medium text-gray-700">Stock Holding Mode</label>
                  <select
                    v-model="equityHoldingMode"
                    class="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  >
                    <option value="MIS">Scenario A: Intraday (MIS - 3:15 PM Square-Off)</option>
                    <option value="CNC">Scenario B: Swing Carrying (CNC - Multi-Day)</option>
                  </select>
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium text-gray-700">F&O Stock Preference</label>
                  <select
                    v-model="stockOptionPreference"
                    class="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  >
                    <option value="PREFER_OPTIONS_IF_LISTED">Trade Options if Listed, else Equity</option>
                    <option value="EQUITY_ONLY">Equity Cash Only</option>
                    <option value="OPTIONS_ONLY">Options Only</option>
                  </select>
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium text-gray-700">Max Risk per Stock Trade (₹)</label>
                  <input
                    v-model.number="equityRiskPerTrade"
                    type="number"
                    min="500"
                    step="500"
                    placeholder="1500"
                    class="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  />
                </div>
              </div>

              <!-- Pool Allocation: NIFTY vs Stocks & Wave Pullback Entry -->
              <div class="grid grid-cols-1 md:grid-cols-4 gap-6 pt-2">
                <div class="space-y-2">
                  <label class="text-sm font-medium text-gray-700">Total Active Position Pool</label>
                  <input
                    v-model.number="maxActivePositions"
                    data-test="max-active-positions-input"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    class="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  />
                  <p class="text-[11px] text-gray-500">Total concurrent open positions</p>
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium text-gray-700">Reserved NIFTY Index Slots</label>
                  <input
                    v-model.number="maxIndexPositions"
                    data-test="max-index-positions-input"
                    type="number"
                    min="0"
                    :max="maxActivePositions"
                    step="1"
                    class="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  />
                  <p class="text-[11px] text-gray-500">
                    Stocks get up to {{ Math.max(0, maxActivePositions - maxIndexPositions) }} slots
                  </p>
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium text-gray-700">Daily Trade Pool Cap</label>
                  <input
                    v-model.number="maxDailyTrades"
                    data-test="max-daily-trades-input"
                    type="number"
                    min="1"
                    max="200"
                    step="1"
                    class="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  />
                  <p class="text-[11px] text-gray-500">Max intraday trades per session</p>
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium text-gray-700">Wave Pullback Entry</label>
                  <label
                    class="flex items-center gap-3 p-2.5 border rounded-xl cursor-pointer hover:bg-gray-50 transition-colors"
                    :class="enablePullbackEntry ? 'border-indigo-500 bg-indigo-50/30' : 'border-gray-200'"
                  >
                    <input
                      v-model="enablePullbackEntry"
                      data-test="enable-pullback-checkbox"
                      type="checkbox"
                      class="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                    />
                    <div>
                      <span class="text-xs font-medium text-gray-900 block">Enter on Wave Retracement</span>
                      <span class="text-[10px] text-gray-500">Avoids buying inflated spike tops</span>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div class="flex justify-end pt-4">
              <button
                type="submit"
                data-test="save-profile-btn"
                :disabled="savingProfile"
                class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm shadow-indigo-200"
              >
                <span
                  v-if="savingProfile"
                  class="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                ></span>
                <Save v-else class="w-4 h-4" />
                {{ savingProfile ? 'Saving...' : 'Save Changes' }}
              </button>
            </div>
          </form>
        </div>
      </section>

      <!-- Broker Connections -->
      <section class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="bg-orange-100 p-2 rounded-lg">
              <LinkIcon class="w-5 h-5 text-orange-600" />
            </div>
            <h2 class="text-lg font-semibold">Broker Connections</h2>
          </div>
        </div>

        <div class="p-6">
          <div v-if="loadingConnections" class="flex items-center justify-center py-8">
            <div class="animate-spin w-8 h-8 border-4 border-orange-200 border-t-orange-600 rounded-full"></div>
          </div>

          <div v-else class="space-y-4">
            <!-- Zerodha Integration Card -->
            <div
              class="border border-gray-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-gray-300 transition-colors"
            >
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                  <span class="font-bold text-orange-600 text-xl">Z</span>
                </div>
                <div>
                  <h3 class="font-semibold text-gray-900">Zerodha Kite</h3>
                  <p class="text-sm text-gray-500">Live market data and trade execution</p>
                </div>
              </div>

              <div class="flex items-center gap-4">
                <template v-if="connections.find((c) => c.brokerName === 'zerodha')?.isActive">
                  <div
                    class="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm font-medium border border-green-100"
                  >
                    <ShieldCheck class="w-4 h-4" />
                    Connected as {{ connections.find((c) => c.brokerName === 'zerodha')?.brokerUserId }}
                  </div>
                  <a
                    href="/api/auth/kite/login"
                    class="text-sm text-indigo-600 hover:text-indigo-700 font-medium px-3 py-1.5 hover:bg-indigo-50 rounded-lg transition-colors"
                  >
                    Reconnect
                  </a>
                </template>
                <template v-else>
                  <div
                    class="flex items-center gap-2 px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium border border-gray-200"
                  >
                    Not Connected
                  </div>
                  <a
                    href="/api/auth/kite/login"
                    class="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
                  >
                    Connect Account
                  </a>
                </template>
              </div>
            </div>

            <!-- Alpaca Markets Integration Card -->
            <div
              class="border border-gray-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-gray-300 transition-colors"
            >
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0 text-2xl">
                  🦙
                </div>
                <div>
                  <h3 class="font-semibold text-gray-900 flex items-center gap-2">
                    <span>Alpaca Markets</span>
                    <span
                      v-if="connections.find((c) => c.brokerName === 'alpaca')?.isActive"
                      class="text-xs px-2 py-0.5 rounded-full font-medium"
                      :class="connections.find((c) => c.brokerName === 'alpaca')?.tradingMode === 'LIVE' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'"
                    >
                      {{ connections.find((c) => c.brokerName === 'alpaca')?.tradingMode === 'LIVE' ? 'Live USD' : 'Paper Sandbox' }}
                    </span>
                  </h3>
                  <p class="text-sm text-gray-500">US Equities (NYSE / NASDAQ), Options, and Crypto API</p>
                </div>
              </div>

              <div class="flex items-center gap-4">
                <template v-if="connections.find((c) => c.brokerName === 'alpaca')?.isActive">
                  <div
                    class="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm font-medium border border-green-100"
                  >
                    <ShieldCheck class="w-4 h-4" />
                    Connected ({{ connections.find((c) => c.brokerName === 'alpaca')?.apiKey?.slice(0, 6) }}...)
                  </div>
                  <button
                    type="button"
                    @click="disconnectAlpaca"
                    :disabled="disconnectingAlpaca"
                    class="text-sm text-red-600 hover:text-red-700 font-medium px-3 py-1.5 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {{ disconnectingAlpaca ? 'Disconnecting...' : 'Disconnect' }}
                  </button>
                </template>
                <template v-else>
                  <div
                    class="flex items-center gap-2 px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium border border-gray-200"
                  >
                    Not Configured
                  </div>
                  <span class="text-xs text-gray-500">Add credentials above to connect</span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
