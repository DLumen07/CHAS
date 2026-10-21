/* The CHAS logo - the app's own mark, not the school's.

   public/chas-logo.png (512px, transparent background): the child, the heart
   and the growth bars held in a hand inside the C. Cleaned from
   brand/chas-logo-master.png - faint halo speckles removed, edges kept soft,
   no fill added. Referenced through BASE_URL so it resolves under the Vite
   dev server and under file:// in Electron.

   `tile` puts it on a white disc. The file stays transparent; the disc is for
   the navy sidebar only, where the dark-blue C and child would otherwise sink
   into the background. On light screens (sign-in) it is drawn bare.

   Kept apart from Seal on purpose: the school seal still goes on the printed
   invitation and the registration form, because a letter to a parent carries
   the school's mark, not the software's. */

const SRC = `${import.meta.env.BASE_URL}chas-logo.png`

export function AppLogo({
  size = 36,
  tile = false,
  className,
}: {
  size?: number
  /** A white disc behind the mark, for dark grounds. `size` is the disc. */
  tile?: boolean
  className?: string
}) {
  if (!tile) {
    return (
      <img
        src={SRC}
        width={size}
        height={size}
        alt="CHAS"
        className={className}
        style={{ width: size, height: size, display: 'block', flexShrink: 0, objectFit: 'contain' }}
      />
    )
  }

  const inner = Math.round(size * 0.8)
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 6px 16px -8px rgba(4,12,36,0.55)',
      }}
    >
      <img src={SRC} width={inner} height={inner} alt="CHAS" style={{ width: inner, height: inner, display: 'block' }} />
    </span>
  )
}
