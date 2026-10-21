import { useState } from 'react'
import { schoolLogoUrl } from '../lib/api'
import { useSchool } from '../lib/school-year'

/* The school seal.

   public/logo.png (512px, transparent), referenced through BASE_URL so the
   same path resolves under the Vite dev server and under file:// in the
   packaged Electron build. If it is missing, the monogram below stands in
   rather than leaving a broken image on a screen a nurse is signing into.

   The 6250px master lives in brand/, outside the served directory, so the
   23MB original is not shipped inside the app and never rasterized on a
   school workstation.

   THE SEAL NEEDS A LIGHT GROUND even though the background is transparent.
   Its outer petals are rgb(0,34,147) and navy-900 is #0e2464: 1.13:1, so the
   silhouette disappears on dark chrome. Against white it is 12.73:1. On a
   navy surface, pass `plate` - the mark is effectively circular (max radius
   is 1.04x its half-extent, 1.3% of pixels outside the inscribed circle), so
   a disc at 1.16x contains it with a white margin and nothing clips. */

/* The logo shipped with the app. Since 2026-10-15 the head can upload the
   school's own in School settings; that one is served by the API and used
   instead whenever it is set. */
const DEFAULT_SRC = `${import.meta.env.BASE_URL}logo.png`
const PLATE = 1.16

export function Seal({
  size = 36,
  className,
  plate = false,
}: {
  size?: number
  className?: string
  /** White disc behind the mark. Required on navy, pointless on white. */
  plate?: boolean
}) {
  const school = useSchool()
  const src = school.logoVersion ? schoolLogoUrl(school.logoVersion) : DEFAULT_SRC
  /* Keyed by the picture, so a new upload gets another chance to load. */
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = failedSrc === src

  const mark = failed ? (
    <div
      style={{
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        background: 'var(--color-navy-900)',
        color: 'var(--color-seal-yellow)',
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        lineHeight: 1,
      }}
      aria-hidden
    >
      {school.name.trim().charAt(0).toUpperCase() || 'S'}
    </div>
  ) : (
    <img
      src={src}
      onError={() => setFailedSrc(src)}
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
      alt={school.name}
    />
  )

  if (!plate) return <span className={className}>{mark}</span>

  return (
    <span
      className={className}
      style={{
        width: size * PLATE,
        height: size * PLATE,
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        background: '#fff',
        flexShrink: 0,
      }}
    >
      {mark}
    </span>
  )
}
