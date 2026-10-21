// Builds the app icon: a multi-size Windows .ico (PNG-compressed entries) from one PNG,
// using Electron's nativeImage for the resizing. argv: <in.png> <out.ico> <preview-dir>
const { app, nativeImage } = require('electron')
const fs = require('fs'), path = require('path')
app.whenReady().then(() => {
  const [src, out, previewDir] = process.argv.slice(-3)
  const img = nativeImage.createFromPath(src)
  if (img.isEmpty()) { console.error('could not read', src); app.exit(1); return }
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = sizes.map((s) => img.resize({ width: s, height: s, quality: 'best' }).toPNG())
  pngs.forEach((p, i) => fs.writeFileSync(path.join(previewDir, `icon-${sizes[i]}.png`), p))
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = 6 + 16 * sizes.length
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1)
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
    e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12)
    offset += pngs[i].length
    return e
  })
  fs.writeFileSync(out, Buffer.concat([header, ...entries, ...pngs]))
  console.log('wrote', out, fs.statSync(out).size, 'bytes, source', img.getSize())
  app.exit(0)
})
