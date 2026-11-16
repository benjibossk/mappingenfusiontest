// Node ESM hook: lets tests import src modules that use extensionless relative imports (Vite style).
// Usage: node --import ./tests/library/resolve-ts.mjs --test tests/biomes/*.test.ts tests/library/*.test.ts
import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) } catch (e) {
    if ((spec.startsWith('.') || spec.startsWith('/')) && !/\\.[cm]?[jt]s$/.test(spec)) return next(spec + '.ts', ctx)
    throw e
  }
}`))
