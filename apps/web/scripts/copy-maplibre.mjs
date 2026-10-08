// MapLibre 6 runs its tile worker as an ES-module worker. Bundlers (Turbopack) don't resolve it reliably,
// so serve the worker + its shared chunk as plain static files and point MapLibre at them (setWorkerUrl).
import { cpSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const dist = join(dirname(createRequire(import.meta.url).resolve('maplibre-gl/package.json')), 'dist')
const out = new URL('../public/vendor/maplibre/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) cpSync(join(dist, f), join(out, f))
console.log('copied maplibre worker to public/vendor/maplibre')
