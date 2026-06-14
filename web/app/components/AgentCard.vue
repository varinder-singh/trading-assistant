<template>
  <div
    class="bg-white p-2.5 rounded-xl shadow-sm border border-gray-200 transition-all duration-300 w-36 shrink-0 relative"
    :class="{
      'border-indigo-500 ring-1 ring-indigo-50 shadow-sm': agent?.status === 'thinking',
      'border-green-500 bg-green-50/30': agent?.status === 'decided',
      'border-red-500 bg-red-50/30': agent?.status === 'error',
      'opacity-60': !isActive && agent?.status === 'idle',
      'ring-1 ring-green-100 border-green-400': isActive && agent?.status === 'decided'
    }"
  >
    <div class="flex items-center justify-between mb-1.5">
      <span class="text-[9px] font-black uppercase tracking-widest text-gray-400 truncate">{{ name }}</span>
      <div class="flex items-center gap-1.5 shrink-0">
        <span
          v-if="agent?.status === 'thinking'"
          class="w-2 h-2 bg-indigo-500 rounded-full animate-ping"
        ></span>
        <span
          class="w-2 h-2 rounded-full"
          :class="{
            'bg-gray-300': agent?.status === 'idle',
            'bg-indigo-500': agent?.status === 'thinking',
            'bg-green-500': agent?.status === 'decided',
            'bg-red-500': agent?.status === 'error',
          }"
        ></span>
      </div>
    </div>
    <div class="text-[10px] font-bold text-gray-900 line-clamp-2 leading-snug h-7">
      {{ agent?.message || 'Awaiting...' }}
    </div>
    <div class="mt-1.5 text-[8px] text-gray-400 flex items-center justify-between font-medium">
      <span>{{ agent?.status?.toUpperCase() || 'IDLE' }}</span>
      <span>{{ agent?.lastUpdate ? new Date(agent.lastUpdate).toLocaleTimeString([], { hour12: false }) : '--:--:--' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  name: string
  agent: {
    status: string
    message: string
    lastUpdate: number
  }
  isActive?: boolean
}>()
</script>
