// Fails when package.json's version has no entry in src/data/changelog.ts (or is not the newest one).
// Run: npm run check:changelog
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const src = readFileSync(new URL('src/data/changelog.ts', root), 'utf8')
const versions = [...src.matchAll(/version:\s*'([^']+)'/g)].map((m) => m[1])

if (!versions.includes(version)) {
  console.error(`check:changelog FAILED: package.json is ${version} but src/data/changelog.ts has no entry for it (found: ${versions.join(', ') || 'none'}).`)
  process.exit(1)
}
if (versions[0] !== version) {
  console.error(`check:changelog FAILED: the newest entry in src/data/changelog.ts is ${versions[0]}, expected ${version} first.`)
  process.exit(1)
}
const md = readFileSync(new URL('CHANGELOG.md', root), 'utf8')
if (!md.includes(`## [${version}]`)) {
  console.error(`check:changelog FAILED: CHANGELOG.md has no "## [${version}]" section.`)
  process.exit(1)
}
console.log(`check:changelog OK: ${version}`)
