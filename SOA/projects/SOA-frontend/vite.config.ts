import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// package.json is the single source of truth for the app version. Read it rather
// than importing it, because tsconfig.node.json (which covers this file) doesn't
// enable resolveJsonModule.
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    // Substituted at build time and in dev; see the declaration in src/vite-env.d.ts.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
      },
    }),
  ],
})
