<script setup lang="ts">
import { ref, onMounted } from 'vue'
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

const kiteApiKey = ref('')
const kiteApiSecret = ref('')
const hasSavedApiSecret = ref(false)

const loadingConnections = ref(true)
const connections = ref<any[]>([])

// Fetch Profile
const fetchProfile = async () => {
  try {
    loadingProfile.value = true
    const { data, error } = await useFetch<any>('/api/profile')
    if (error.value) throw error.value

    if (data.value) {
      fullName.value = data.value.fullName || ''
      email.value = data.value.email || user.value?.email || ''
      tradeMode.value = data.value.tradeMode || 'PAPER'
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
    const { data, error } = await useFetch<any[]>('/api/profile/connections')
    if (error.value) throw error.value

    if (data.value) {
      connections.value = data.value
      const zerodha = data.value.find((c: any) => c.brokerName === 'zerodha')
      if (zerodha) {
        kiteApiKey.value = zerodha.apiKey || ''
        hasSavedApiSecret.value = zerodha.hasApiSecret || false
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

    const payload: any = { fullName: fullName.value }

    if (kiteApiKey.value && kiteApiSecret.value) {
      payload.kiteApiKey = kiteApiKey.value
      payload.kiteApiSecret = kiteApiSecret.value
    } else if (
      (kiteApiKey.value && !kiteApiSecret.value && !hasSavedApiSecret.value) ||
      (!kiteApiKey.value && kiteApiSecret.value)
    ) {
      profileError.value = 'Both API Key and API Secret must be provided together.'
      savingProfile.value = false
      return
    }

    const { error } = await useFetch('/api/profile', {
      method: 'PUT',
      body: payload,
    })

    if (error.value) throw error.value

    if (kiteApiSecret.value) {
      hasSavedApiSecret.value = true
      kiteApiSecret.value = '' // Clear after save for security
    }

    profileSuccess.value = 'Settings updated successfully!'
    setTimeout(() => {
      profileSuccess.value = ''
    }, 3000)

    // Refresh connections to get updated status
    fetchConnections()
  } catch (err: any) {
    console.error('Failed to update profile:', err)
    profileError.value = 'Failed to save changes: ' + (err.data?.statusMessage || err.message || 'Unknown error')
  } finally {
    savingProfile.value = false
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
  <div class="min-h-screen bg-gray-50 text-gray-900 font-sans">
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

            <div class="flex justify-end pt-4">
              <button
                type="submit"
                :disabled="savingProfile || !fullName"
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
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
