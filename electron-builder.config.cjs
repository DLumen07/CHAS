/* electron-builder configuration.

   A .cjs file rather than the "build" block in package.json, for one reason:
   the installer has to carry server-bundle/, which is built OUTSIDE this
   OneDrive folder (see electron/bundle-dir.cjs), and putting it in the app
   takes code - see afterPack below.

   The installer and its unpacked tree go to %LOCALAPPDATA%\chas-release for
   the same OneDrive reason the README gives: its sync agent locks
   win-unpacked mid-rename and fails the build with EPERM. */

const fs = require('node:fs')
const path = require('node:path')
const bundleDir = require('./electron/bundle-dir.cjs')

module.exports = {
  appId: 'ph.deped.detailen.chas',
  productName: 'CHAS',
  copyright: 'Detailen Elementary School, Maria Aurora, Aurora',
  directories: {
    output: path.join(path.dirname(bundleDir), '..', 'chas-release'),
    buildResources: 'brand',
  },
  /* The window's own code. The app it shows, the API behind it and the
     database all travel in server-bundle/ below. */
  files: ['electron/**/*', 'package.json'],
  /* server-bundle/ goes to resources/server, outside app.asar, because
     postgres.exe, the Prisma engine and the argon2 addon are loaded or
     spawned by the OS, which cannot read an archive.

     Copied here rather than listed as extraResources: electron-builder drops
     every node_modules folder from extra resources whatever the filter says,
     and the bundle's node_modules IS the database - the installer came out
     with an API and no PostgreSQL. afterPack runs on the unpacked app before
     the installer is made from it, so what is copied here is what ships. */
  afterPack: async (context) => {
    if (!fs.existsSync(path.join(bundleDir, 'desktop.mjs'))) {
      throw new Error(`server-bundle is missing at ${bundleDir}. Run \`npm run build:desktop\`.`)
    }
    const dest = path.join(context.appOutDir, 'resources', 'server')
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(bundleDir, dest, { recursive: true })
    /* The Visual C++ runtime beside CHAS.exe too, so anything the app process
       itself loads finds it first (see scripts/build-desktop-server.mjs). */
    const vc = path.join(bundleDir, 'vcruntime')
    if (!fs.existsSync(vc)) throw new Error('server-bundle/vcruntime is missing. Run `npm run build:desktop`.')
    for (const dll of fs.readdirSync(vc)) fs.copyFileSync(path.join(vc, dll), path.join(context.appOutDir, dll))
  },
  win: {
    icon: 'brand/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: 'CHAS',
  },
}
