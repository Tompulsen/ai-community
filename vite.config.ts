import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      'elkjs/lib/elk.bundled.js': fileURLToPath(new URL('./src/studio-elk.ts', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['elkjs/lib/elk.bundled.js'],
    include: ['elkjs/lib/elk-api.js'],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'syntax', test: /node_modules[\\/]highlight\.js[\\/]/, entriesAware: true },
            { name: 'math', test: /node_modules[\\/]katex[\\/]/, entriesAware: true },
          ],
        },
      },
    },
  },
})
