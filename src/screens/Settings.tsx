import { HardDrives, Warning, ArrowClockwise, Trash, CaretDown } from '@phosphor-icons/react'
import { AccentButton, Button, Field, Panel, cx } from '../components/ui'

/* Settings that are not yet configured are shown as empty, not hidden.

   The selects match the Field control they sit between - same 10px radius,
   same fill on focus - so a row of settings reads as one form rather than as
   two controls that were built at different times. */

/* Shared shape for the native selects on this screen. */
const SELECT =
  'w-full appearance-none rounded-[10px] border border-line bg-white py-2 pr-8 pl-3 text-[13px] ' +
  'transition-[border-color,box-shadow] duration-100 hover:border-[#c2cddd] ' +
  'focus:border-navy-600 focus:outline-none focus:shadow-[0_0_0_3px_rgba(43,82,196,0.12)]'

function Select({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium text-muted">{label}</span>
      <span className="relative block">
        <select className={cx(SELECT)}>{children}</select>
        <CaretDown
          size={12}
          weight="bold"
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-placeholder"
        />
      </span>
    </label>
  )
}

export default function Settings() {
  return (
    /* A reading screen: the scroller is the outer box, and the multicol box
       inside it must keep an AUTO height. Given a definite height, CSS
       multicol lays overflow out as more columns to the right instead of
       growing downward, which put two of these panels off-screen. */
    <div className="h-full overflow-y-auto px-6 pt-1 pb-6">
      <div className="columns-1 gap-4 xl:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <Panel title="Encrypted backup" subtitle="Not configured">
          <div className="space-y-3.5">
            <div className="flex items-start gap-2.5 rounded-[12px] bg-gold-100 px-3.5 py-3">
              <Warning size={16} weight="fill" className="mt-px shrink-0 text-gold-700" />
              <p className="text-[11.5px] leading-relaxed text-gold-700">
                Set a destination and cadence before deployment, then run a restore test and
                record the date it succeeded.
              </p>
            </div>

            <Select label="Destination">
              <option>- not set -</option>
              <option>Encrypted USB drive</option>
              <option>Second internal disk</option>
              <option>School server share</option>
            </Select>

            <Select label="Cadence">
              <option>- not set -</option>
              <option>After every weigh-in session</option>
              <option>Daily at close of school</option>
              <option>Weekly</option>
            </Select>

            <Field label="Last verified restore" placeholder="Never tested" readOnly />

            <div className="flex gap-2 pt-1">
              <AccentButton icon={<HardDrives size={15} weight="bold" />}>Back up now</AccentButton>
              <Button icon={<ArrowClockwise size={14} />}>Test restore</Button>
            </div>
          </div>
        </Panel>

        <Panel title="Data privacy - RA 10173" subtitle="Health records of minors">
          <div className="space-y-3.5">
            <Field
              label="Retention period"
              placeholder="- not set -"
              hint="How long measurements are kept after a learner leaves the school."
            />
            <Field
              label="Data Protection Officer"
              placeholder="- not set -"
              hint="Named person accountable for this database."
            />
            <Select label="Basis for processing">
              <option>- not set -</option>
              <option>DepEd mandate (SF8 reporting)</option>
              <option>Guardian consent on enrolment</option>
            </Select>

            <div className="border-t border-line-soft pt-3.5">
              <div className="text-[12px] font-medium text-navy-900">
                Purge records past retention
              </div>
              <p className="mt-1 mb-2.5 text-[11px] leading-relaxed text-muted">
                Permanently removes learner measurements older than the retention period. The
                audit log keeps the fact that a purge happened, not the purged data.
              </p>
              <Button variant="danger" icon={<Trash size={14} />}>
                Review purge candidates
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Accounts &amp; roles" subtitle="4 accounts on this workstation">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line-soft text-left text-[10px] font-semibold tracking-[0.06em] text-placeholder uppercase">
                <th className="py-2.5 font-semibold">User</th>
                <th className="py-2.5 font-semibold">Role</th>
                <th className="py-2.5 font-semibold">Scope</th>
                <th className="py-2.5 text-right font-semibold">Last sign-in</th>
              </tr>
            </thead>
            <tbody className="text-navy-900">
              {[
                ['M. Ocampo', 'Nurse', 'All grade levels - measure, print', '2026-08-10 08:58'],
                ['R. Villanueva', 'Adviser', 'Grade 4 only', '2026-08-08 15:29'],
                ['E. Manalo', 'Adviser', 'Grade 6 only', '2026-08-07 10:12'],
                ['A. Bantolo', 'Admin', 'Release, backup, audit', '2026-08-05 16:18'],
              ].map(([u, r, s, t]) => (
                <tr key={u} className="border-b border-line-soft last:border-0">
                  <td className="py-2.5 font-medium">{u}</td>
                  <td className="py-2.5 text-muted">{r}</td>
                  <td className="py-2.5 text-muted">{s}</td>
                  <td className="tnum py-2.5 text-right text-muted">{t}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3.5 border-t border-line-soft pt-3.5 text-[11px] leading-relaxed text-muted">
            Roles restrict what each account can reach. On a shared machine they are only as
            strong as the sign-in: a borrowed login makes every audit entry it produces
            unattributable.
          </p>
        </Panel>

        <Panel title="Growth reference" subtitle="WHO 2007, 5 to 19 years">
          <dl className="space-y-2.5 text-[12.5px]">
            {[
              ['Reference', 'WHO 2007 growth reference, 5-19 years'],
              ['Indicators', 'BMI-for-age, height-for-age'],
              ['Age basis', 'Age in completed months at date of weighing'],
              ['Cut-offs', 'DepEd SF8 bands (SW / W / N / OW / O)'],
              ['Table validation', 'Not yet run - pending cell-by-cell check'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-muted">{k}</dt>
                <dd className="text-right font-medium text-navy-900">{v}</dd>
              </div>
            ))}
          </dl>
          {/* The LMS tables ARE loaded and the engine does compute z-scores -
              see src/data/who2007.json and lib/nutrition.ts. What has not
              happened is the cell-by-cell check against the printed DepEd
              reference, so that is what this now says. The old wording called
              the whole engine a stub, which stopped being true. */}
          <div className="mt-3.5 rounded-[12px] bg-gold-100 px-3.5 py-3 text-[11.5px] leading-relaxed text-gold-700">
            The WHO LMS tables are loaded and every band on screen is computed from them, but they
            have not yet been validated cell-by-cell against the printed DepEd SF8 reference.
            Treat classifications as unverified until that check is recorded here.
          </div>
        </Panel>
      </div>
    </div>
  )
}
