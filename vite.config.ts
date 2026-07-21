import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import {
  developmentContentSecurityPolicy,
  productionContentSecurityPolicy,
} from './src/renderer-content-security-policy'

function contentSecurityPolicy(development: boolean): Plugin {
  const policy = development ? developmentContentSecurityPolicy : productionContentSecurityPolicy

  return {
    name: 'content-security-policy',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: policy,
          },
          injectTo: 'head-prepend',
        },
      ],
    },
  }
}

export default defineConfig(({ command }) => ({
  base: './',
  root: 'src/renderer',
  publicDir: '../../assets',
  server: {
    headers: {
      'Content-Security-Policy': developmentContentSecurityPolicy,
    },
  },
  plugins: [contentSecurityPolicy(command === 'serve'), tailwindcss(), react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: false,
  },
}))
