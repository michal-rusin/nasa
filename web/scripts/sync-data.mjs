// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

// Copies ../data/out/<DATA_VERSION|v1>/ to public/data/. No dependencies; works on every OS.
// Usage: node scripts/sync-data.mjs [--optional]
//   --optional: missing source = warning and exit 0 (for predev, using sample data).
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.env.DATA_VERSION ?? 'v1'
const src = resolve(webDir, '..', 'data', 'out', version)
const dst = join(webDir, 'public', 'data')
const optional = process.argv.includes('--optional')

if (!existsSync(src) || !statSync(src).isDirectory()) {
  const msg = `sync-data: missing source directory ${src} (DATA_VERSION=${version}).`
  if (optional) {
    console.warn(`[warning] ${msg} Existing files in public/data/ are preserved.`)
    process.exit(0)
  }
  console.error(`[error] ${msg}\nGenerate data with the engine or set DATA_VERSION to an existing version.`)
  process.exit(1)
}

// Cleanup: old root .json/.bin files and masks/ and layers/. Preserve sample/.
if (existsSync(dst)) {
  for (const name of readdirSync(dst)) {
    const p = join(dst, name)
    const isDir = statSync(p).isDirectory()
    if (isDir ? name === 'masks' || name === 'layers' : /\.(json|bin)$/i.test(name)) {
      rmSync(p, { recursive: true, force: true })
    }
  }
}

// Do not overwrite public/data/sample/, even if the source contains that directory.
const srcSample = join(src, 'sample')
cpSync(src, dst, {
  recursive: true,
  filter: (from) => {
    const p = resolve(from)
    return p !== srcSample && !p.startsWith(srcSample + sep)
  },
})
console.log(`sync-data: copied ${src} → ${dst}`)
