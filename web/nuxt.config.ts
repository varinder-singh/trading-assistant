import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss'],
  alias: {
    "@core": join(__dirname, "../src")
  },
  nitro: {
    experimental: {
      websocket: true
    },
    esbuild: {
      options: {
        target: 'esnext'
      }
    }
  }
})
