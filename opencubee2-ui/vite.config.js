import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ['**/public/keyframes/**'],
    },
  },
  build: {
    outDir: 'dist_app',
    copyPublicDir: false,
  },
})
