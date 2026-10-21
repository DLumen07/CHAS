import { useState, type ReactNode } from 'react'
import { Funnel, Check, X } from '@phosphor-icons/react'
import { cx } from './ui'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './primitives'
import type { Learner } from '@/data/mock'
import { BAND_COLOR } from '@/lib/nutrition'
import {
  BMI_BANDS,
  EMPTY_FILTER,
  HFA_BANDS,
  SLIP_LABEL,
  SLIP_STATES,
  activeCount,
  countsFor,
  isEmpty,
  isFlagged,
  type LearnerFilter,
} from '@/lib/filters'

/* The filter panel.

   There used to be a rail of four pills here, which could ask four questions.
   This asks any combination of six facets, which is why it is a panel and not
   more pills: seventeen options laid out in a row would be a second toolbar,
   and the rail's own idiom - pick exactly one - is the wrong one for values
   that combine. The row it stood on went to the search field.

   It is deliberately narrow. A menu is read down its left edge, so the width
   only has to hold the longest label ("Attended the meeting") and its count;
   anything past that is a panel pretending to be a page, and it covers the
   wall it is filtering while it is open.

   Every option carries the number of learners it would leave visible, counted
   with the OTHER facets still applied. That number is the whole argument for
   a panel over a rail: the adviser can see that "Wasted" holds four before
   spending a click on it, and can see a combination holds none before
   concluding the roster itself is empty. */

export function FilterMenu({
  learners,
  value,
  onChange,
}: {
  learners: Learner[]
  value: LearnerFilter
  onChange: (f: LearnerFilter) => void
}) {
  const [open, setOpen] = useState(false)
  const n = activeCount(value)

  /* Escape, outside-clicks, focus return and the aria wiring all belong to
     the Popover now - see components/primitives.tsx. What was here was a pair
     of document listeners that got the first two right and the third only
     for Escape: clicking outside closed the panel and left focus nowhere. */

  const bmiCounts = countsFor(learners, value, 'bmi', [...BMI_BANDS], (l) => l.bmiBand)
  const hfaCounts = countsFor(learners, value, 'hfa', [...HFA_BANDS], (l) => l.hfaBand)
  const slipCounts = countsFor(learners, value, 'slip', [...SLIP_STATES], (l) => l.slip)
  const sexCounts = countsFor(learners, value, 'sex', ['M', 'F'] as const, (l) => l.sex)
  const measuredCounts = countsFor(
    learners,
    value,
    'measured',
    ['yes', 'no'] as const,
    (l) => (l.measuredOn ? 'yes' : 'no'),
  )
  const flaggedCount = countsFor(learners, value, 'flagged', ['on'] as const, (l) =>
    isFlagged(l) ? 'on' : null,
  ).on

  /** Toggle one value in and out of a multi-select facet. */
  function toggle(key: 'sex' | 'bmi' | 'hfa' | 'slip', v: string) {
    const list = value[key] as string[]
    const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
    onChange({ ...value, [key]: next } as LearnerFilter)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cx(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium whitespace-nowrap',
          'transition-colors duration-100',
          /* Filled once it is doing something, so a narrowed roster can never
             be mistaken for the whole class. */
          n > 0 || open ? 'bg-navy-800 text-white' : 'bg-wash text-muted hover:text-navy-900',
        )}
      >
        <Funnel size={13} weight={n > 0 ? 'fill' : 'regular'} />
        Filters
        {n > 0 && (
          <span className="tnum grid min-w-[16px] place-items-center rounded-full bg-white/25 px-1 text-[10px] leading-[16px] font-bold">
            {n}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent aria-label="Filter learners" className="w-[236px]">
        <Group label="Records">
          <Option
            on={value.flagged}
            count={flaggedCount}
            onClick={() => onChange({ ...value, flagged: !value.flagged })}
          >
            Flagged only
          </Option>
          {/* Measured is one answer, not several - a learner cannot be both -
              so picking one clears the other rather than adding to it. */}
          <Option
            on={value.measured === 'yes'}
            count={measuredCounts.yes}
            onClick={() =>
              onChange({ ...value, measured: value.measured === 'yes' ? 'any' : 'yes' })
            }
          >
            Measured
          </Option>
          <Option
            on={value.measured === 'no'}
            count={measuredCounts.no}
            onClick={() =>
              onChange({ ...value, measured: value.measured === 'no' ? 'any' : 'no' })
            }
          >
            Not measured
          </Option>
        </Group>

        <Group label="BMI-for-age">
          {BMI_BANDS.map((b) => (
            <Option
              key={b}
              on={value.bmi.includes(b)}
              count={bmiCounts[b]}
              color={BAND_COLOR[b]}
              onClick={() => toggle('bmi', b)}
            >
              {b}
            </Option>
          ))}
        </Group>

        <Group label="Height-for-age">
          {HFA_BANDS.map((b) => (
            <Option
              key={b}
              on={value.hfa.includes(b)}
              count={hfaCounts[b]}
              color={BAND_COLOR[b]}
              onClick={() => toggle('hfa', b)}
            >
              {b}
            </Option>
          ))}
        </Group>

        <Group label="Invitation slip">
          {SLIP_STATES.map((s) => (
            <Option
              key={s}
              on={value.slip.includes(s)}
              count={slipCounts[s]}
              onClick={() => toggle('slip', s)}
            >
              {SLIP_LABEL[s]}
            </Option>
          ))}
        </Group>

        <Group label="Sex">
          <Option
            on={value.sex.includes('M')}
            count={sexCounts.M}
            onClick={() => toggle('sex', 'M')}
          >
            Male
          </Option>
          <Option
            on={value.sex.includes('F')}
            count={sexCounts.F}
            onClick={() => toggle('sex', 'F')}
          >
            Female
          </Option>
        </Group>

        <div className="mt-2 flex items-center justify-between border-t border-line-soft pt-2">
          <button
            onClick={() => onChange(EMPTY_FILTER)}
            disabled={isEmpty(value)}
            className="inline-flex items-center gap-1 rounded-[7px] px-1.5 py-1 text-[11px] font-medium text-muted transition-colors duration-100 hover:text-navy-900 disabled:pointer-events-none disabled:opacity-40"
          >
            <X size={11} weight="bold" />
            Clear all
          </button>
          {/* PopoverClose closes AND returns focus to the trigger. The
              hand-written version had to remember to do the second half. */}
          <PopoverClose className="rounded-[7px] bg-wash px-2.5 py-1 text-[11px] font-medium text-navy-900 transition-colors duration-100 hover:bg-navy-50">
            Done
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="[&+&]:mt-2 [&+&]:border-t [&+&]:border-line-soft [&+&]:pt-2">
      <div className="mb-1 px-1.5 text-[9.5px] font-semibold tracking-[0.07em] text-placeholder uppercase">
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}

/* A full-width row rather than a chip: the band names run to sixteen
   characters and a wrapped grid of chips at that length is a paragraph. The
   row also gives the count a fixed right edge, so the numbers line up into a
   column that can be read down. */
function Option({
  on,
  count,
  color,
  onClick,
  children,
}: {
  on: boolean
  count: number
  color?: string
  onClick: () => void
  children: ReactNode
}) {
  /* Zero is not disabled - it is still worth showing, and disabling a chosen
     one would strand a filter the adviser can no longer see to remove - but
     it is dimmed, so a dead end is visible before it is clicked. */
  const dead = count === 0 && !on
  return (
    <button
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2 rounded-[7px] py-1 pr-1.5 pl-1.5 text-left text-[11.5px]',
        'transition-colors duration-100',
        on ? 'bg-navy-50 font-medium text-navy-900' : 'text-navy-900 hover:bg-wash',
        dead && 'text-placeholder',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'grid size-[13px] shrink-0 place-items-center rounded-[3.5px] transition-colors duration-100',
          on ? 'bg-navy-800 text-white' : 'ring-1 ring-line ring-inset',
        )}
      >
        {on && <Check size={9} weight="bold" />}
      </span>
      {/* The band's own colour, so a row is recognised as the same finding the
          card's ring and the record's band row already show in it. */}
      {color && (
        <span
          aria-hidden
          className="size-[6px] shrink-0 rounded-full"
          style={{ background: color, opacity: dead ? 0.4 : 1 }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="tnum shrink-0 text-[10.5px] text-muted">{count}</span>
    </button>
  )
}
