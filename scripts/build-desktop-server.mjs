/* Assemble server-bundle/: everything the installed app runs besides Electron.
   It is written to %LOCALAPPDATA%\chas-build\server-bundle (see
   electron/bundle-dir.cjs), not into the project.

     server-bundle/
       desktop.mjs      the API, PostgreSQL startup and first-launch setup,
                        bundled from server/desktop.ts
       app/             the built front-end (server mode), served by the API
       migrations/      server/prisma/migrations, applied on launch
       node_modules/    only what cannot be bundled: native code and the
                        files that locate it on disk

   electron-builder ships this folder as an extraResource, OUTSIDE app.asar.
   It has to be: postgres.exe, the Prisma query engine and the argon2 addon
   are real files that the OS loads or spawns, and none of those can reach
   into an asar archive.

   Run by `npm run build:desktop`, after `build:server-app` has written dist/
   in server mode. */

import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/* Outside the project - see electron/bundle-dir.cjs for why. */
const out = createRequire(import.meta.url)('../electron/bundle-dir.cjs')
const serverModules = path.join(root, 'server', 'node_modules')
const rootModules = path.join(root, 'node_modules')

function fail(message) {
  console.error(`\n[build:desktop] ${message}\n`)
  process.exit(1)
}

/* The front-end must be the SERVER build. A local-store build here would
   ignore the API it is being served by, keep its records in the window's
   localStorage, and lose them - quietly - the day that storage is cleared.
   main.tsx stamps which one it is into the bundle. */
const dist = path.join(root, 'dist')
if (!existsSync(path.join(dist, 'index.html'))) fail('dist/ is missing. Run `npm run build:server-app` first.')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

await build({
  entryPoints: [path.join(root, 'server', 'desktop.ts')],
  outfile: path.join(out, 'desktop.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  alias: { '@': path.join(root, 'src') },
  /* CHAS_SAMPLES=1 (`npm run dist:samples`) makes an installer that adds
     the 25 sample learners on first launch - see server/desktop.ts. */
  define: { __CHAS_SAMPLES__: process.env.CHAS_SAMPLES === '1' ? 'true' : 'false' },
  /* Native code, and the package that finds postgres.exe relative to its own
     file. pg-native and pg-cloudflare are optional paths inside `pg` that
     this app never takes. */
  external: [
    '@prisma/client',
    '@node-rs/argon2',
    '@embedded-postgres/*',
    'pg-native',
    'pg-cloudflare',
  ],
  /* The CommonJS dependencies (Express and friends) call require() on Node
     built-ins, which an ESM bundle has no require for unless it makes one. */
  banner: {
    js: [
      "import { createRequire as __chasCreateRequire } from 'node:module';",
      'const require = __chasCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'warning',
})

/* What is left to copy, and from where. */
const modules = [
  [serverModules, '@prisma/client'],
  [serverModules, '.prisma/client'],
  [serverModules, '@node-rs/argon2'],
  [serverModules, '@node-rs/argon2-win32-x64-msvc'],
  [rootModules, '@embedded-postgres/windows-x64'],
]
for (const [from, name] of modules) {
  const src = path.join(from, name)
  if (!existsSync(src)) fail(`${name} is not installed (looked in ${from}).`)
  cpSync(src, path.join(out, 'node_modules', name), {
    recursive: true,
    filter: (p) =>
      /* Prisma leaves .tmp copies of the engine behind when a generate races
         a running dev server holding the DLL. They are 20MB each and dead. */
      !/\.tmp\d*$/.test(p) &&
      /* This app runs Prisma's native library engine against PostgreSQL.
         The WebAssembly engines for edge runtimes and for four other
         databases are about 50MB the installed app never loads. */
      !(name.includes('prisma') && /(\.wasm|wasm-base64|query_compiler_bg|query_engine_bg|edge|react-native|\.map$)/.test(path.basename(p))),
  })
}

/* The query engine must be the Windows one, freshly generated for this
   schema - a stale client against a newer schema fails at the first query
   that touches a new column, on a school laptop, weeks later. */
const engine = path.join(out, 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node')
if (!existsSync(engine)) fail('The Prisma query engine for Windows is missing. Run `npm --prefix server run db:generate`.')
const shippedSchema = readFileSync(path.join(out, 'node_modules', '.prisma', 'client', 'schema.prisma'), 'utf8')
const currentSchema = readFileSync(path.join(root, 'server', 'prisma', 'schema.prisma'), 'utf8')
if (shippedSchema.replace(/\s+/g, '') !== currentSchema.replace(/\s+/g, ''))
  fail('The generated Prisma client is older than schema.prisma. Run `npm --prefix server run db:generate`.')

/* The Microsoft Visual C++ runtime, app-local.

   postgres.exe, initdb.exe and pg_ctl.exe import vcruntime140.dll (and
   postgres.exe msvcp140.dll and vcruntime140_1.dll), and so does the argon2
   addon that checks passwords. None of them ship it, and a freshly set-up
   Windows does not have it until something installs the Visual C++
   Redistributable - so on exactly the machine a school buys for CHAS, the
   database would not start and the app would quit with "could not start".

   Microsoft permits copying these DLLs next to the programs that use them.
   They go beside postgres.exe (its own process, so its own folder is searched
   first), beside the argon2 addon (Node loads addons with the addon's folder
   on the search path), and into vcruntime/ for electron-builder to put beside
   CHAS.exe as well. Taken from this build machine's System32. */
const VC_RUNTIME = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'concrt140.dll']
const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
const vcTargets = [
  path.join(out, 'vcruntime'),
  path.join(out, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin'),
  path.join(out, 'node_modules', '@node-rs', 'argon2-win32-x64-msvc'),
]
for (const dll of VC_RUNTIME) {
  const src = path.join(system32, dll)
  if (!existsSync(src)) fail(`${dll} is not in ${system32}. Install the Visual C++ Redistributable (x64) on this build machine.`)
  for (const dir of vcTargets) {
    mkdirSync(dir, { recursive: true })
    cpSync(src, path.join(dir, dll))
  }
}

cpSync(path.join(root, 'server', 'prisma', 'migrations'), path.join(out, 'migrations'), {
  recursive: true,
  filter: (p) => !p.endsWith('migration_lock.toml'),
})
cpSync(dist, path.join(out, 'app'), { recursive: true })

/* A package.json so Node treats nothing here as belonging to a parent
   project's "type", and so the folder says what it is when someone finds it
   in C:\Program Files. */
writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify({ name: 'chas-desktop-server', private: true, type: 'module' }, null, 2),
)

console.log('[build:desktop] server-bundle/ ready')
