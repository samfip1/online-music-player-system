import { defineConfig } from 'vitest/config'
import { testEnv } from './test/env.js'

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: './test/global-setup.ts',
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
  },
})
