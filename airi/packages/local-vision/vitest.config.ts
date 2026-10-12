import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { name: 'local-vision', include: ['src/**/*.test.ts'] } })
