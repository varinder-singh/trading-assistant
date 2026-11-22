import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  app: {
    head: {
      title: 'Antigravity Trading Cockpit',
      meta: [
        { charset: 'utf-8' },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
        },
        { name: 'theme-color', content: '#020617' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Antigravity' },
        { name: 'format-detection', content: 'telephone=no' },
        { name: 'mobile-web-app-capable', content: 'yes' },
      ],
      link: [
        { rel: 'manifest', href: '/manifest.json' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', href: '/favicon.ico' },
      ],
    },
  },
  vite: {
    server: {
      allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev'],
    },
  },
  modules: ['@nuxtjs/tailwindcss', '@nuxtjs/supabase'],
  alias: {
    '@core': join(__dirname, '../src'),
  },
  nitro: {
    experimental: {
      websocket: true,
    },
    esbuild: {
      options: {
        target: 'esnext',
      },
    },
  },
})
