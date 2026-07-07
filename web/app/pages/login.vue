<script setup lang="ts">
import { ref } from 'vue'
import { TrendingUp, Mail, KeyRound, Loader2, ArrowRight } from '@lucide/vue'

const supabase = useSupabaseClient()
const user = useSupabaseUser()

const email = ref('')
const password = ref('')
const loading = ref(false)
const isSignUp = ref(false)
const errorMsg = ref('')
const successMsg = ref('')

// If user is already logged in, redirect to dashboard
watchEffect(() => {
  if (user.value) {
    navigateTo('/')
  }
})

async function handleAuth() {
  if (!email.value || !password.value) {
    errorMsg.value = 'Please enter both email and password'
    return
  }

  try {
    loading.value = true
    errorMsg.value = ''
    successMsg.value = ''

    if (isSignUp.value) {
      const { error } = await supabase.auth.signUp({
        email: email.value,
        password: password.value,
      })
      if (error) throw error
      successMsg.value = 'Account created successfully! You can now log in.'
      isSignUp.value = false
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.value,
        password: password.value,
      })
      if (error) throw error
      // Watch effect will automatically redirect to '/' once user.value is set
    }
  } catch (e: any) {
    errorMsg.value = e.message || 'Authentication failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 selection:bg-indigo-500/30">
    <!-- Animated Background Elements -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px]"></div>
      <div class="absolute top-[60%] -right-[10%] w-[40%] h-[40%] rounded-full bg-emerald-500/10 blur-[120px]"></div>
    </div>

    <!-- Login Container -->
    <div class="w-full max-w-md relative z-10">
      <!-- Brand Header -->
      <div class="flex flex-col items-center mb-10 text-center">
        <div
          class="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center mb-6 shadow-lg shadow-indigo-500/25"
        >
          <TrendingUp class="w-8 h-8 text-white" />
        </div>
        <h1 class="text-3xl font-bold tracking-tight text-white mb-2">Trading Assistant</h1>
        <p class="text-zinc-400 text-sm">Autonomous Multi-Agent Trading System</p>
      </div>

      <!-- Card -->
      <div class="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/50 rounded-3xl p-8 shadow-2xl">
        <div v-if="errorMsg" class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
          <p class="text-sm text-red-400 font-medium">{{ errorMsg }}</p>
        </div>

        <div
          v-if="successMsg"
          class="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center gap-3"
        >
          <p class="text-sm text-green-400 font-medium">{{ successMsg }}</p>
        </div>

        <div class="space-y-6 transition-all duration-300">
          <div>
            <h2 class="text-xl font-semibold text-white mb-1">{{ isSignUp ? 'Create an account' : 'Welcome back' }}</h2>
            <p class="text-zinc-400 text-sm">
              {{ isSignUp ? 'Sign up to start trading' : 'Enter your credentials to access your account' }}
            </p>
          </div>

          <div class="space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium text-zinc-300 ml-1">Email Address</label>
              <div class="relative">
                <Mail class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                <input
                  v-model="email"
                  type="email"
                  placeholder="name@example.com"
                  class="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl py-3 pl-12 pr-4 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                />
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-zinc-300 ml-1">Password</label>
              <div class="relative">
                <KeyRound class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                <input
                  v-model="password"
                  @keyup.enter="handleAuth"
                  type="password"
                  placeholder="••••••••"
                  class="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl py-3 pl-12 pr-4 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                />
              </div>
            </div>
          </div>

          <button
            @click="handleAuth"
            :disabled="loading"
            class="w-full bg-white hover:bg-zinc-100 text-zinc-950 font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <Loader2 v-if="loading" class="w-5 h-5 animate-spin" />
            <template v-else>
              <span>{{ isSignUp ? 'Sign Up' : 'Sign In' }}</span>
              <ArrowRight class="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </template>
          </button>

          <div class="text-center">
            <button @click="isSignUp = !isSignUp" class="text-sm text-zinc-500 hover:text-white transition-colors">
              {{ isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up" }}
            </button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="mt-8 text-center">
        <p class="text-zinc-600 text-xs">Secure authentication powered by Supabase</p>
      </div>
    </div>
  </div>
</template>
