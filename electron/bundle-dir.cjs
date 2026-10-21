/* Where server-bundle/ is built in development - one definition, read by
   scripts/build-desktop-server.mjs (which writes it) and electron/main.cjs
   (which runs it when the app is not packaged).

   OUTSIDE the project on purpose. This repo lives under OneDrive, whose sync
   agent grabs a freshly written 200MB tree of DLLs mid-copy and holds it:
   the next build fails with EBUSY trying to delete its own output. It is the
   same trap the README describes for electron-builder's release folder, and
   the same way out. package.json's extraResources names the same path.

   CHAS_BUNDLE_DIR overrides it, for a build machine that keeps its work
   somewhere else. */

const path = require('node:path')
const os = require('node:os')

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')

module.exports = process.env.CHAS_BUNDLE_DIR || path.join(localAppData, 'chas-build', 'server-bundle')
