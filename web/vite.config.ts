// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
