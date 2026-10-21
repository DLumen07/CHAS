import { useState } from 'react'
import { ShieldCheck, Link as LinkIcon } from '@phosphor-icons/react'
import { Button, Panel, cx } from '../components/ui'
import { AUDIT } from '../data/mock'

/* The hash-chained activity log.

   Action chips are filled, not outlined. There are five of them repeating down
   a long column and a 1px rule around each one turned the column into a grid
   of boxes; a soft ground carries the same grouping without the ruling. */

const TONE: Record<string, string> = {
  MEASUREMENT_CORRECTED: 'text-gold-700 bg-gold-100',
  LOGIN_FAILED: 'text-[#9f1239] bg-[#fdf2f5]',
  SF8_EXPORT_RELEASED: 'text-navy-800 bg-navy-50',
  BACKUP_COMPLETED: 'text-[#14663a] bg-[#f2faf5]',
  STUB_RETURNED: 'text-[#14663a] bg-[#f2faf5]',
}

export default function Audit() {
  const [verified, setVerified] = useState(false)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-6 pt-1 pb-6">
      <div
        className={cx(
          'flex shrink-0 items-center gap-3.5 rounded-[16px] px-4 py-3.5 transition-colors duration-200',
          verified ? 'bg-[#f2faf5]' : 'bg-wash',
        )}
      >
        <span
          className={cx(
            'grid size-10 shrink-0 place-items-center rounded-full',
            verified ? 'bg-[#dcf3e4]' : 'bg-navy-100',
          )}
        >
          <ShieldCheck size={19} weight="fill" className={verified ? 'text-n' : 'text-navy-700'} />
        </span>
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold text-navy-900">
            {verified
              ? 'Chain verified - 428 entries, no breaks detected'
              : 'Hash-chained audit log'}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            Each entry stores the hash of the one before it. The log is tamper-evident, not
            unchangeable: an edit, deletion, or reorder breaks the chain and shows up here as a
            break.
          </p>
        </div>
        <Button
          variant={verified ? 'secondary' : 'primary'}
          icon={<LinkIcon size={14} />}
          onClick={() => setVerified((v) => !v)}
          className="shrink-0"
        >
          {verified ? 'Re-verify' : 'Verify chain'}
        </Button>
      </div>

      <Panel
        className="min-h-0 flex-1"
        title="Activity"
        subtitle="Most recent first"
        bodyClass="min-h-0 flex-1 overflow-auto p-0"
        actions={<Button>Export log</Button>}
      >
        <table className="w-full min-w-[820px] border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-card text-left">
            <tr className="border-b border-line-soft text-[10px] font-semibold tracking-[0.06em] whitespace-nowrap text-placeholder uppercase">
              <th className="px-4 py-2.5 font-semibold">#</th>
              <th className="px-2 py-2.5 font-semibold">Timestamp</th>
              <th className="px-2 py-2.5 font-semibold">Actor</th>
              <th className="px-2 py-2.5 font-semibold">Action</th>
              <th className="px-2 py-2.5 font-semibold">Target</th>
              <th className="px-4 py-2.5 font-semibold">Prev. hash</th>
            </tr>
          </thead>
          <tbody>
            {AUDIT.map((e) => (
              <tr
                key={e.id}
                className="border-b border-line-soft transition-colors duration-100 hover:bg-wash"
              >
                <td className="tnum px-4 py-2.5 text-muted">{e.id}</td>
                <td className="tnum px-2 py-2.5 whitespace-nowrap text-muted">{e.at}</td>
                <td className="px-2 py-2.5 whitespace-nowrap">
                  <span className="font-medium text-navy-900">{e.actor}</span>
                  <span className="ml-1.5 text-[10.5px] text-muted">{e.role}</span>
                </td>
                <td className="px-2 py-2.5">
                  <span
                    className={cx(
                      'inline-block rounded-full px-2.5 py-1 font-mono text-[10.5px] whitespace-nowrap',
                      TONE[e.action] ?? 'bg-wash text-muted',
                    )}
                  >
                    {e.action}
                  </span>
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap text-navy-900">{e.target}</td>
                <td className="px-4 py-2.5 font-mono text-[10.5px] whitespace-nowrap text-muted">
                  {e.hash}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}
