// Kopiuje ../data/out/<DATA_VERSION|v1>/ do public/data/. Bez zależności, działa na każdym OS.
// Użycie: node scripts/sync-data.mjs [--optional]
//   --optional: brak źródła = ostrzeżenie i exit 0 (dla predev, praca na samplu).
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.env.DATA_VERSION ?? 'v1'
const src = resolve(webDir, '..', 'data', 'out', version)
const dst = join(webDir, 'public', 'data')
const optional = process.argv.includes('--optional')

if (!existsSync(src) || !statSync(src).isDirectory()) {
  const msg = `sync-data: brak katalogu źródłowego ${src} (DATA_VERSION=${version}).`
  if (optional) {
    console.warn(`[ostrzeżenie] ${msg} Zostają dotychczasowe pliki w public/data/.`)
    process.exit(0)
  }
  console.error(`[błąd] ${msg}\nWygeneruj dane silnikiem albo ustaw DATA_VERSION na istniejącą wersję.`)
  process.exit(1)
}

// Sprzątanie: stare .json/.bin w korzeniu oraz masks/ i layers/. sample/ zostaje nietknięty.
if (existsSync(dst)) {
  for (const name of readdirSync(dst)) {
    const p = join(dst, name)
    const isDir = statSync(p).isDirectory()
    if (isDir ? name === 'masks' || name === 'layers' : /\.(json|bin)$/i.test(name)) {
      rmSync(p, { recursive: true, force: true })
    }
  }
}

// Nie nadpisuj public/data/sample/, nawet gdyby źródło miało katalog o tej nazwie.
const srcSample = join(src, 'sample')
cpSync(src, dst, {
  recursive: true,
  filter: (from) => {
    const p = resolve(from)
    return p !== srcSample && !p.startsWith(srcSample + sep)
  },
})
console.log(`sync-data: skopiowano ${src} → ${dst}`)
