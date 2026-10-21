import { useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  Database,
  DownloadSimple,
  UploadSimple,
  Warning,
  CheckCircle,
  Info,
  Trash,
  FloppyDisk,
  ArrowCounterClockwise,
} from '@phosphor-icons/react'
import { AccentButton, Button, IconChip, Panel, cx } from '@/components/ui'
import {
  SERVER_BACKED,
  describeBackup,
  isAdmin,
  restoreRecords,
  snapshotRecords,
  storageLabel,
  useRoster,
  useSchool,
} from '@/lib/records'

/* Getting the records off this laptop, and putting them back.

   THE PROBLEM THIS SOLVES. Every measurement typed on this workstation lives
   in one JSON file in the user profile. That file is not backed up by
   anything - not by the school, which has no server for these machines, and
   not by DepEd. A workstation that is reimaged over the summer, or simply
   fails, takes a year of weigh-ins with it, and the only other copy of those
   numbers is the SF8 sheets if somebody remembered to export them.

   A backup here is the WHOLE file: measurements, absences, immunization
   checks, slips, the meeting, the staff list and the notices. It is plain
   JSON on purpose - a school that stops using CHAS must still be able to read
   what it recorded, and a proprietary blob would make the data hostage to the
   software. That is also the honest caveat, and it is stated on the screen:
   the file is not encrypted, so it is a health record in the clear and it
   belongs on a drive the school controls.

   RESTORING REPLACES. It is not a merge, because a merge across two copies of
   the same learner needs a rule for which measurement wins, and there is no
   rule that is right for a child's height - the two numbers disagree because
   one of them is wrong, and only a person knows which. So the screen says
   "replaces everything on this workstation" and asks twice.

   One thing does not come back from the file: whose install this is. See
   restoreRecords in lib/records.ts. */

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function when(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  return `${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

type Note = { tone: 'ok' | 'warn'; text: string }

/** What was read out of a chosen file, before anything is written. */
type Pending = {
  fileName: string
  raw: unknown
  summary: ReturnType<typeof describeBackup>
}

export default function Backup() {
  const { install, ready, learners, savedAt, clearAll } = useRoster()
  const { staff } = useSchool()
  const fileInput = useRef<HTMLInputElement>(null)

  const [note, setNote] = useState<Note | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [clearing, setClearing] = useState(false)

  /* What a backup taken right now would contain. Counted off the record file
     itself rather than off the roster, because the roster is the sample list
     with saved values merged over it - and a backup of "182 learners" would
     be claiming to carry a roster it does not have. */
  const contents = useMemo(() => {
    const f = snapshotRecords()
    return [
      { label: 'Measurements', n: Object.keys(f.measurements).length },
      { label: 'Absences', n: Object.keys(f.absences).length },
      { label: 'Immunization checks', n: Object.keys(f.immunizations).length },
      { label: 'Slips issued or scanned', n: Object.keys(f.slips).length },
      { label: 'Staff changes', n: Object.keys(f.staff).length },
    ]
    /* Recomputed whenever anything in the file moves. `savedAt` changes on
       every write, and the staff map this screen does not otherwise read are
       named so a change to it is not missed. */
  }, [savedAt, staff])

  if (ready && !isAdmin(install)) return <Navigate to="/admin" replace />

  function download() {
    try {
      const file = snapshotRecords()
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `CHAS-backup-${stamp()}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      /* Revoked on the next tick, not immediately: the click is asynchronous
         and revoking the URL in the same frame cancels the save on some
         Chromium builds. */
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNote({
        tone: 'ok',
        text: `Wrote CHAS-backup-${stamp()}.json. Put it somewhere the school controls - the file is not encrypted.`,
      })
    } catch (err) {
      setNote({ tone: 'warn', text: `Could not write the backup: ${String(err)}` })
    }
  }

  async function choose(file: File) {
    setNote(null)
    try {
      const text = await file.text()
      const raw = JSON.parse(text) as unknown
      const summary = describeBackup(raw)
      if (!summary.ok) {
        setPending(null)
        setNote({ tone: 'warn', text: summary.reason ?? 'That file cannot be read as a backup.' })
        return
      }
      setPending({ fileName: file.name, raw, summary })
    } catch {
      setPending(null)
      setNote({ tone: 'warn', text: 'That file is not valid JSON, so nothing was read from it.' })
    }
  }

  async function confirmRestore() {
    if (!pending) return
    setBusy(true)
    try {
      await restoreRecords(pending.raw)
      setNote({
        tone: 'ok',
        text: `Restored from ${pending.fileName}. Every screen now reads the restored records.`,
      })
      setPending(null)
    } catch (err) {
      setNote({ tone: 'warn', text: `The restore did not finish: ${String(err)}` })
    } finally {
      setBusy(false)
    }
  }

  const measured = learners.filter((l) => l.measuredOn).length

  return (
    <div className="h-full overflow-auto px-6 pt-1 pb-6">
      {/* The one thing a person has to know before either button is pressed:
          where the records currently are, and that the file is readable. */}
      <div className="mb-3.5 flex items-start gap-2.5 rounded-[14px] bg-wash px-4 py-2.5">
        <Info size={15} weight="fill" className="mt-px shrink-0 text-navy-700" />
        <p className="text-[11.5px] leading-relaxed text-muted">
          <span className="font-semibold text-navy-900">{storageLabel()}</span>
          {' - '}
          last written {when(savedAt)}. A backup is the whole record file as plain JSON:{' '}
          <span className="font-semibold text-navy-900">it is not encrypted</span>, so treat the
          file as the health record it is and keep it on a drive the school controls.
        </p>
      </div>

      {note && (
        <div
          className={cx(
            'mb-3.5 flex items-start gap-2.5 rounded-[14px] px-4 py-2.5 text-[11.5px] leading-relaxed',
            note.tone === 'ok' ? 'bg-[#f2faf5] text-[#14663a]' : 'bg-gold-100 text-gold-700',
          )}
        >
          {note.tone === 'ok' ? (
            <CheckCircle size={15} weight="fill" className="mt-px shrink-0" />
          ) : (
            <Warning size={15} weight="fill" className="mt-px shrink-0" />
          )}
          <span>{note.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <IconChip tone="navy">
                <Database size={14} weight="fill" />
              </IconChip>
              What a backup would carry
            </span>
          }
          subtitle={`${measured} of ${learners.length} learners on this install have a measurement`}
          className="h-fit"
        >
          <ul className="space-y-1">
            {contents.map((c) => (
              <li
                key={c.label}
                className="flex items-baseline justify-between gap-3 rounded-[10px] px-3 py-2 odd:bg-wash"
              >
                <span className="text-[12px] text-navy-900">{c.label}</span>
                <span className="tnum text-[13px] font-semibold text-navy-900">{c.n}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <AccentButton onClick={download} icon={<DownloadSimple size={15} weight="bold" />}>
              Save a backup
            </AccentButton>
            <span className="text-[11px] text-muted">
              <FloppyDisk size={12} weight="bold" className="mr-1 inline align-[-1px]" />
              CHAS-backup-{stamp()}.json
            </span>
          </div>
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <IconChip tone="gold">
                <UploadSimple size={14} weight="fill" />
              </IconChip>
              Restore from a backup
            </span>
          }
          subtitle="Replaces everything recorded on this workstation"
          className="h-fit"
        >
          <div className="flex items-start gap-2.5 rounded-[12px] bg-gold-100 px-3.5 py-3">
            <Warning size={16} weight="fill" className="mt-px shrink-0 text-gold-700" />
            <p className="text-[11.5px] leading-relaxed text-gold-700">
              A restore is not a merge. Everything currently on this workstation is thrown away and
              the file&rsquo;s contents take its place. Save a backup of what is here first if you
              are not certain.
            </p>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              /* Cleared so the same file can be chosen twice - after a
                 mistaken cancel, the change event would not fire again. */
              e.target.value = ''
              if (f) void choose(f)
            }}
          />

          <div className="mt-3.5">
            <Button
              onClick={() => fileInput.current?.click()}
              icon={<UploadSimple size={14} weight="bold" />}
            >
              Choose a backup file
            </Button>
          </div>

          {pending && (
            <div className="mt-3.5 rounded-[12px] bg-wash px-3.5 py-3">
              <div className="text-[12px] font-semibold text-navy-900">{pending.fileName}</div>
              <dl className="mt-2 space-y-1 text-[11.5px] text-muted">
                <Row label="Written" value={when(pending.summary.savedAt)} />
                <Row label="File version" value={String(pending.summary.version)} />
                <Row label="Measurements" value={String(pending.summary.measurements)} />
                <Row label="Slips" value={String(pending.summary.slips)} />
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => void confirmRestore()}
                  icon={<ArrowCounterClockwise size={14} weight="bold" />}
                >
                  {busy ? 'Restoring...' : 'Replace the records with this file'}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Panel>

        <Panel
          title="Start the workstation over"
          subtitle="Throws away everything typed here, keeps who this laptop belongs to"
          className="h-fit"
        >
          {SERVER_BACKED ? (
            <p className="text-[12px] leading-relaxed text-muted">
              This build reads the school server, so there is nothing on the workstation to clear.
              Records are removed on the server or not at all.
            </p>
          ) : (
            <>
              <p className="text-[12px] leading-relaxed text-muted">
                Measurements, absences, immunization checks, slips, notices and staff changes are
                all deleted. There is no undo, so save a backup first.
              </p>
              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                {clearing ? (
                  <>
                    <Button
                      variant="danger"
                      onClick={() => {
                        clearAll()
                        setClearing(false)
                        setNote({ tone: 'ok', text: 'The workstation was cleared.' })
                      }}
                      icon={<Trash size={14} weight="bold" />}
                    >
                      Yes, delete everything
                    </Button>
                    <Button variant="ghost" onClick={() => setClearing(false)}>
                      Keep the records
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="danger"
                    onClick={() => setClearing(true)}
                    icon={<Trash size={14} weight="bold" />}
                  >
                    Clear this workstation
                  </Button>
                )}
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>{label}</dt>
      <dd className="tnum font-medium text-navy-900">{value}</dd>
    </div>
  )
}
