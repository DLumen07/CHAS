import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { ArrowCounterClockwise, Image, UploadSimple, Warning } from '@phosphor-icons/react'
import { Button } from '@/components/ui'
import { TextInput } from '@/components/form'
import { Seal } from '@/components/Seal'
import { ClassesSettings } from '@/components/ClassesSettings'
import { toast } from '@/components/toast'
import { ApiError, endpoints } from '@/lib/api'
import { isAdmin, useRoster } from '@/lib/records'
import { setSchoolInfo, useSchool, type SchoolIdentity } from '@/lib/school-year'

/* School settings. Head only.

   The school's name, School ID, district, division and region - the SF8
   header and the letterhead of every invitation slip - and the school's
   logo. These were constants until 2026-10-15; the user asked for them to
   be settings so the app can be set up for any school.

   One centred container, one column (2026-10-15): the logo with Upload
   and, once one is uploaded, a way back to the default; then the details
   with one Save button at the foot.

   Below it since 2026-10-17, a second container of the same width: the
   year levels and sections (components/ClassesSettings.tsx). It saves each
   change as it is made, so it is kept apart from the details form and its
   Save button. */

type Details = Omit<SchoolIdentity, 'logoVersion'>
type Errors = Partial<Record<keyof Details, string>>

export default function SchoolSettings() {
  const { install, ready } = useRoster()
  if (!ready) return null
  if (!isAdmin(install)) return <Navigate to="/admin" replace />
  return <Settings />
}

function Settings() {
  const school = useSchool()
  const [form, setForm] = useState<Details>(() => pick(school))
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  /* The details can arrive after the page opens (a roster refresh). The
     form follows them until somebody starts typing. */
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched) setForm(pick(school))
  }, [school, touched])

  const set = (k: keyof Details) => (v: string) => {
    setTouched(true)
    setForm((f) => ({ ...f, [k]: k === 'schoolId' ? v.replace(/\D/g, '').slice(0, 6) : v }))
  }
  const changed = JSON.stringify(form) !== JSON.stringify(pick(school))

  function validate(): Errors {
    const e: Errors = {}
    if (!form.name.trim()) e.name = 'Enter the school name.'
    if (form.schoolId && !/^\d{6}$/.test(form.schoolId)) e.schoolId = 'The School ID must be 6 digits.'
    if (!form.district.trim()) e.district = 'Enter the district.'
    if (!form.division.trim()) e.division = 'Enter the division.'
    if (!form.region.trim()) e.region = 'Enter the region.'
    return e
  }

  async function save(ev: FormEvent) {
    ev.preventDefault()
    setFailure(null)
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    try {
      const { school: saved } = await endpoints.updateSchool({
        name: form.name.trim(),
        schoolId: form.schoolId,
        district: form.district.trim(),
        division: form.division.trim(),
        region: form.region.trim(),
      })
      setSchoolInfo({ school: saved })
      setTouched(false)
      toast.success('School details saved.')
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'Unable to save the school details.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-auto px-6 pt-1 pb-8">
      {/* One container, one column, centred like New school year
          (the user's call, 2026-10-15): the logo, then the details, then
          Save at the foot. */}
      <div className="panel mx-auto max-w-[760px] px-7 py-6">
        <LogoPanel />

        {/* --- School details --- */}
        <form onSubmit={(e) => void save(e)} className="mt-6 border-t border-line-soft pt-6" noValidate>
          <h3 className="text-[14px] font-semibold text-navy-900">School details</h3>
          <p className="mt-1 text-[12px] text-muted">
            Printed on the SF8, the invitation slips and the sign-in screen.
          </p>

          <div className="mt-5 space-y-4">
            <TextInput label="School name" value={form.name} onChange={set('name')} error={errors.name} />
            <TextInput
              label="School ID"
              hint="6 digits, issued by DepEd. Leave blank if not on file; the SF8 cell stays empty."
              value={form.schoolId}
              onChange={set('schoolId')}
              error={errors.schoolId}
              inputMode="numeric"
              placeholder="000000"
              className="font-mono tracking-[0.05em]"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="District" value={form.district} onChange={set('district')} error={errors.district} />
              <TextInput label="Division" value={form.division} onChange={set('division')} error={errors.division} />
            </div>
            <TextInput
              label="Region"
              hint="As written on the SF8, for example III - CENTRAL LUZON."
              value={form.region}
              onChange={set('region')}
              error={errors.region}
            />
          </div>

          {failure && (
            <p
              role="alert"
              className="mt-4 flex items-center gap-2 rounded-[10px] bg-[#fdf2f5] px-3.5 py-2.5 text-[12px] font-medium text-[#9f1239]"
            >
              <Warning size={15} weight="fill" className="shrink-0" />
              {failure}
            </p>
          )}

          <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-line-soft pt-5">
            {changed && (
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-4 text-[13px]"
                onClick={() => {
                  setForm(pick(school))
                  setErrors({})
                  setTouched(false)
                }}
                disabled={saving}
              >
                Discard changes
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              className="h-10 rounded-[10px] px-5 text-[13px] font-semibold"
              disabled={saving || !changed}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </div>

      <div className="panel mx-auto mt-5 max-w-[760px] px-7 py-6">
        <ClassesSettings />
      </div>
    </div>
  )
}

function pick(s: SchoolIdentity): Details {
  return { name: s.name, schoolId: s.schoolId, district: s.district, division: s.division, region: s.region }
}

/* --- The logo --------------------------------------------------------- */

/** The longest side the logo is stored at. Enough for a slip letterhead
    printed at any size the app uses, and small enough to store in the
    database and send with every page that shows it. */
const MAX_SIDE = 512

/** Any picture the browser can open, as a PNG no larger than MAX_SIDE. */
async function toPng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new window.Image()
    img.src = url
    await img.decode()
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * k))
    const h = Math.max(1, Math.round(img.naturalHeight * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('encode')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

function LogoPanel() {
  const school = useSchool()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function upload(file: File) {
    setFailure(null)
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setFailure('Choose a PNG or JPG image.')
      return
    }
    setBusy(true)
    try {
      const png = await toPng(file)
      const { school: saved } = await endpoints.uploadSchoolLogo(png)
      setSchoolInfo({ school: saved })
      toast.success('School logo updated.')
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'The image could not be used. Try another file.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function reset() {
    setFailure(null)
    setBusy(true)
    try {
      const { school: saved } = await endpoints.removeSchoolLogo()
      setSchoolInfo({ school: saved })
      toast.success('The default logo is in use.')
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'Unable to remove the logo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h3 className="text-[14px] font-semibold text-navy-900">School logo</h3>
      <p className="mt-1 text-[12px] text-muted">Shown on the invitation slips and the learner record.</p>

      <div className="mt-4 flex flex-wrap items-center gap-5">
        <div className="grid size-[120px] shrink-0 place-items-center rounded-[14px] bg-wash">
          <Seal size={92} />
        </div>
        <div className="min-w-[220px] flex-1">
          <div className="text-[12.5px] font-medium text-navy-900">
            {school.logoVersion ? 'Uploaded logo' : 'Default logo'}
          </div>
          <p className="mt-1 flex items-start gap-2 text-[11.5px] leading-relaxed text-muted">
            <Image size={14} weight="fill" className="mt-px shrink-0 text-placeholder" />
            PNG or JPG. A square image with a transparent background works best. The SF8 keeps the
            DepEd seal and logo printed on the form itself.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <Button
              className="h-9 px-4 text-[12.5px]"
              icon={<UploadSimple size={14} weight="bold" />}
              onClick={() => input.current?.click()}
              disabled={busy}
            >
              {busy ? 'Working…' : 'Upload logo'}
            </Button>
            {school.logoVersion && (
              <Button
                variant="ghost"
                className="h-9 px-4 text-[12.5px]"
                icon={<ArrowCounterClockwise size={14} weight="bold" />}
                onClick={() => void reset()}
                disabled={busy}
              >
                Use default logo
              </Button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
        }}
      />

      {failure && (
        <p
          role="alert"
          className="mt-4 flex items-center gap-2 rounded-[10px] bg-[#fdf2f5] px-3.5 py-2.5 text-[12px] font-medium text-[#9f1239]"
        >
          <Warning size={15} weight="fill" className="shrink-0" />
          {failure}
        </p>
      )}
    </section>
  )
}
