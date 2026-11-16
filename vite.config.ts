// Multi-page build: the mapper (index.html) + the public asset library browser (library.html).
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), library: resolve(import.meta.dirname, 'library.html') },
    },
  },
})
