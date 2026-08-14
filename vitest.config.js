import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      // configDefaults.exclude ne couvre pas .claude/** : une copie de travail
      // laissée par un agent isolé (isolation: "worktree") sous
      // .claude/worktrees/** se fait sinon ramasser comme suite de tests
      // dupliquée (et potentiellement obsolète/en conflit).
      exclude: [...configDefaults.exclude, 'e2e/*', '.claude/**'],
      root: fileURLToPath(new URL('./', import.meta.url))
    }
  })
)
