import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // This JavaScript client must not inherit the unrelated Downloads-level
  // tsconfig during Rolldown scanning or OXC source transforms.
  oxc: {
    tsconfig: false,
  },
  optimizeDeps: {
    rolldownOptions: {
      tsconfig: false,
    },
  },
})
