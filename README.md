# CHAS – Child Health Assessment System

Nutritional status monitoring and parent meeting invitations for Detailen Elementary School, Maria Aurora, Aurora. Capstone project, 2026.

## Download

**[Download the latest installer (CHAS-Setup.exe)](https://github.com/DLumen07/CHAS/releases/latest)**

Open the link, then under **Assets** click `CHAS-Setup-<version>.exe`.

## Install

1. Run the downloaded `CHAS-Setup-<version>.exe`.
2. If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. The installer is not code-signed yet, so Windows does not recognise the publisher.
3. Follow the setup steps. CHAS opens when it finishes; the first start takes a little longer while the database is created.

**Requirements:** Windows 10 or 11 (64-bit). No internet connection is needed after installing. Everything, including the database, runs on this one computer.

## First sign-in

| Account | Username | Password |
|---|---|---|
| School head | `admin` | `admin12345678` |
| School nurse | `s.nurse` | `nurse12345678` |

Change both passwords on the **Roles** screen after the first sign-in.

## Upgrading from an older CHAS

Close CHAS, then run the new installer over it. All records are kept. If the head account was never changed from the old default (`a.bantolo`), it becomes `admin` / `admin12345678`; a head who set their own password keeps it.

---

## It is a school server now, not one workstation

> **Deployment, as of 2026-09-29:** the school runs CHAS on ONE machine with
> no server - the installer carries the API and a private PostgreSQL. See
> "Shipping it to a school" below. The server build described here is what
> runs inside that installer.

**Read this before anything else in the file.** CHAS began as an offline
desktop application: one laptop, one nurse, a JSON file in the user profile,
and a single-instance lock. It is not that any more, and several paragraphs
further down still describe the old shape. Where they disagree with this
section, this section is right.

The app runs against either of two stores, chosen at build time by
`VITE_CHAS_BACKEND` (see `.env.example`). Every screen reads through
`useRoster()` and neither knows which one it got.

| | |
|---|---|
| `server` | **The default, and what is developed against.** PostgreSQL behind an Express API, with real accounts and roles. Several people use it at once, from their own machines. Set up in [`server/README.md`](server/README.md). |
| `local` | The original offline build. A JSON file in Electron's per-user data directory, or localStorage in a plain browser. No server, one section, one machine. Kept working, no longer the target. |

What that change actually moved:

- **Concurrency.** Six advisers, the head and the nurse can be in the app at
  the same time. "Single workstation, single-instance lock" is no longer true
  of the deployed build and neither is any claim resting on it.
- **Identity.** Sign-in resolves a real user row with a role, not a picked
  persona. Every write carries `recordedById`, so an audit entry names a
  person rather than a shared login.
- **Scope.** An adviser's account holds one section and the server enforces
  that on every query. The head and the nurse read the school. This is a
  column on the user, not a filter the client is trusted to send.
- **The privacy claim.** "Records never leave this computer" is a property of
  the `local` build only. A deployed server has its own obligations - TLS, a
  real `SESSION_SECRET`, changed seed passphrases, encryption at rest - and
  they are listed at the top of `server/README.md`. Do not repeat the offline
  claim about a deployment.

**Current state: pre-test build.**

- **The classification engine is real.** WHO 2007 LMS parameters for
  BMI-for-age and height-for-age, 5 to 19 years, both sexes, in
  `src/data/who2007.json`. See "The growth reference" below.
- **Measurements are saved to PostgreSQL.** Every save is attributable, and
  every correction is kept: `measurement_revisions` records what was typed
  before it was retyped. The `local` build still writes its JSON file.
- **The learner roster is seeded, not imported.** Names, LRNs and birth dates
  are fabricated by `server/prisma/seed.ts`. A roster import is not built. It
  is shaped like Detailen: one section per year level, so a "section" in the
  code is usually the grade level and is named as one. Grade levels and
  sections are their own tables, so a school running two sections per year is
  a data change rather than a schema one.
- **Slips print and export.** The selected sheets are rendered into
  `#print-root`, which is the only thing the print stylesheet shows, and then
  sent either to the system print dialog or to Electron's `printToPDF` -
  8.5in x 5.5in, one slip per page. Saving a PDF stamps `printed_at`; paper
  printing does not, because the print dialog reports nothing back.
- **The audit log exists but is not hash-chained.** `audit_entries` is written
  on every meaningful action and nothing in the API updates or deletes a row.
  `prevHash` and `hash` are on the table, nullable, and no writer fills them.
  It is append-only, not yet tamper-evident. Say it that way.
- **The SF8 export saves a PDF directly only in Electron.** `Export PDF` on
  the SF8 screen writes the file through a save dialog in the desktop shell.
  In a browser tab it opens the print window instead, where "Save as PDF"
  produces the same document. Print works in both.

## Running it

The default `.env.local` points at the server build, so the API has to be up
before the UI is useful. Start it first, from `server/`, per
[`server/README.md`](server/README.md):

```bash
npm --prefix server run dev
```

Then the UI:

```bash
npm run dev:renderer
```

Vite alone, at `http://localhost:5173`, proxying `/api` to port 4000. This is
the fast path and it is what most work happens in.

```bash
npm run dev
```

Vite and Electron together. Use this when the thing being worked on is one of
the Electron-only capabilities: `printToPDF` (slips and the SF8 export) or
the `local` store.

```bash
npm start
```

Production build, loaded from disk in Electron.

There is a launch config at `.claude/launch.json` with both servers in it, if
your tooling reads one.

## Shipping it to a school: one machine, everything inside

The school installs CHAS on one computer, and that computer is the whole
deployment. There is no server to set up, no PostgreSQL to install and no
network needed. The installer carries all of it:

- the app itself (the `server` build of the UI),
- the API from `server/`, run inside the app's own process,
- a private PostgreSQL 17 (`embedded-postgres`), started and stopped by the
  app, listening on `127.0.0.1` only.

On every launch `electron/main.cjs` calls `startDesktop()` in
`server/desktop.ts`, which starts the database, applies any migration it has
not had yet (so a newer installer upgrades the school's data in place), and on
the very first launch creates the school, its grade levels and sections, and
two accounts. It then starts the ordinary API on `127.0.0.1:47810` and opens
the window on it. Quitting stops the database cleanly (`pg_ctl stop -m fast`);
a crash or power cut is recovered automatically on the next launch.

**First sign-in on a new install.** Each account must set a new password at its first sign-in; nothing else opens until it does. The same applies to accounts the head creates or resets, and, after an upgrade, to any account still using one of these passwords.

| | Username | Password |
|---|---|---|
| School head | `admin` | `admin12345678` |
| School nurse | `s.nurse` | `nurse12345678` |

Upgrading from 0.2.0 or earlier keeps every account as it was, with one exception: a head account still called `a.bantolo` and still opening with `chas-head-2026` becomes `admin` / `admin12345678` on the first launch of the new version. A head who changed that password keeps that username and password.

A new install starts with **no learners**: the nurse enrols the school's own
children from the Learners screen. The sample roster in `src/data/mock.ts` is
for development and never reaches an installed copy.

**Demo installer.** `npm run dist:samples` builds the same installer, but its
first launch adds the 25 sample learners in `server/samples.ts` (invented
names, LRNs starting `999999`, June and October 2026 weigh-ins). It adds them
once per machine, and only when the database has no real learners, so it never
mixes samples into a school's records. Do not give this build to a school.
`npm run seed:samples` adds the same 25 to an existing install.

**Where the data lives:** `%APPDATA%\CHAS\database` (the PostgreSQL cluster and
`settings.json`, which holds this install's generated database password and
session secret). The log is `%APPDATA%\CHAS\logs\chas.log`. Uninstalling the
app leaves both in place.

```bash
npm run dist
```

This runs `build:desktop` (type-check, the server-mode UI, then
`scripts/build-desktop-server.mjs`, which assembles `server-bundle/`) and then
electron-builder with `electron-builder.config.cjs`. It produces one x64
installer, `CHAS Setup 0.2.0.exe`, about 120MB, in `%LOCALAPPDATA%\chas-release`.
Per-user, no admin rights needed, makes a desktop shortcut. The first launch
after installing takes about half a minute while the database is created;
later launches take a few seconds.

To try the installed shape without packaging: `npm run build:desktop`, then
`npm run start:desktop`. Set `CHAS_DATA_DIR` to a scratch folder to test a
first launch without touching your own data.

Notes for whoever is doing this:

- **Build outputs live outside the project on purpose.** This repo is under
  OneDrive, whose sync agent locks freshly written files and fails the build
  with `EPERM`/`EBUSY`. `server-bundle/` is built in
  `%LOCALAPPDATA%\chas-build` (see `electron/bundle-dir.cjs`) and the installer
  goes to `%LOCALAPPDATA%\chas-release`. Do not point either back inside the
  project.
- **The Prisma client must be generated from the current schema.**
  `build:desktop` refuses to package a stale one. Run
  `npm --prefix server run db:generate` with the dev API stopped (it holds the
  engine DLL open).
- **No portable .exe any more.** A portable build unpacks itself to a temp
  folder on every launch, which with a database inside is 130MB per start.
- **The build is unsigned, so SmartScreen will warn.** "Windows protected your
  PC" appears on first launch. Click "More info" then "Run anyway". A
  code-signing certificate is the only thing that removes it.
- **Windows x64 only.** A macOS `.dmg` cannot be cross-built from Windows.
- **The icon is `brand/icon.ico`, committed, not generated at build time.**
  electron-builder's own PNG-to-ICO converter fails on this machine with
  `WebAssembly.Memory(): could not allocate memory`.
- **Backup and restore are on the Backup screen (head only).** A backup is a
  cold copy of the database cluster: PostgreSQL is stopped cleanly, `pgdata`
  is copied to a `CHAS-backup-<date>` folder the head picks (a USB drive),
  and it is started again. A restore swaps a backup in, keeps one copy of the
  previous records in `%APPDATA%\CHAS\database\pgdata-before-restore-*`, and
  restarts the app; if the restored copy will not open, the previous records
  are put back automatically. See "Backup and restore" in `server/desktop.ts`.
  Both work only in the installed app (they go through the Electron bridge).
- **Automatic backups** are made the same way each time CHAS closes, into
  `%APPDATA%\CHAS\database\backups` (not Documents, which OneDrive may sync):
  one per day, the last 7 days kept. A session that ended without closing
  CHAS is backed up on the next launch instead. See "Automatic backups" in
  `server/desktop.ts`.

## Stack

- **PostgreSQL + Prisma** - the source of truth. Schema and migrations in
  `server/prisma`.
- **Express 4** - the API, in `server/src`. Sessions are httpOnly cookies with
  only their hash stored; passphrases are Argon2id.
- **React + TypeScript + Vite**
- **Tailwind v4** - tokens in `src/index.css`
- **Phosphor** icons
- **Electron** - the desktop shell. It is what makes `printToPDF` (slips and the
  SF8 export) possible, and it can still run the `local` store offline. It is
  no longer the thing that holds the data.

SQLite and SQLCipher were the original plan and are not being pursued. The
encryption-at-rest question moved with the data: it is now a PostgreSQL
deployment question, not an application one.

## Design decisions (locked - don't drift)

This is a public-sector clinical tool, not a marketing site. The read is
**trust-first, high-density**: a nurse measuring 40 learners needs rows on
screen, not whitespace.

- **Type: Bahnschrift for display and numerals, Segoe UI for running text,
  Cascadia for codes.** Bahnschrift is Microsoft's variable DIN-style grotesk.
  DIN is the typeface of instruments, forms and signage, which is what this
  application is. All three ship with Windows, so the offline requirement
  costs no webfont fetch. Verified as actually resolving, not falling back.
- **The palette comes from the school seal.** Blues are pulled to the seal's
  royal blue. The seal's yellow (`#ffde17`) is the one "act here" colour, used
  as a FILL only: behind navy-950 text it reads at 13.3:1, and on white it is
  1.2:1, so it can never be type. Where that meaning is needed in text, dark
  amber (`--color-gold-700`) carries it. Status colours are a *data scale*,
  not accents.
- **The seal ships at `public/logo.png`, 512px, transparent.** Masters live in
  `brand/`, outside the served directory. `src/components/Seal.tsx` loads it
  through `BASE_URL` so one path works under Vite and under `file://` in the
  packaged app, and falls back to a monogram if it is missing. Never put the
  6250px master in `public/`: 23MB on disk, about 156MB of memory once
  rasterized, for a mark drawn at 34px.
- **The seal always needs a light ground.** Not a stylistic preference. Its
  outer petals are `rgb(0,34,147)` and navy-900 is `#0e2464`, which is
  **1.13:1** - the silhouette disappears on any navy surface. Against white it
  is 12.73:1. On navy, pass `plate`: the mark is effectively circular (max
  radius 1.04x its half-extent, 1.3% of pixels outside the inscribed circle),
  so the white disc at 1.16x contains it with a margin and clips nothing.
  Never put the bare mark on navy.
- **Colours go through theme utilities, never `bg-[var(--color-x)]`.** That
  arbitrary form silently generates no CSS in Tailwind v4. `--color-n` in
  `@theme` already gives you `text-n`.
- **Status scale is diverging.** Undernutrition runs warm (rose to orange),
  normal is green, overnutrition runs violet. The two problem directions must
  never be confusable at a glance. Every band clears WCAG AA both as a
  white-on-fill bar label and as chip text on its own tint.
- **Radius scale:** shells 16px, cards 12px, controls 8px, chips 6px. Nothing
  is a pill.
- **One surface treatment.** A panel is a hairline plus one shallow tinted
  shadow. No nested bezels, no gradients, no grain, no glow. Decoration that
  has to be justified in a comment is decoration.
- **Motion is feedback only.** Hover and press, 100ms. Nothing animates on
  mount: a screen the nurse opens forty times a day must be readable at once,
  not assembled over a second.
- **Labels label.** A panel subtitle says what the panel contains or how it is
  sorted. It does not argue a point. Caveats that matter go in one plain
  sentence at the bottom of the panel, not as an epigram at the top.
- **Target CSS viewport: 1264×689. Not 1366×768.** This distinction has
  already cost one round of broken layouts, so it is written down. The dev
  machine is 1920×1080 at 150% Windows scaling, which Windows reports as a
  1280×720 desktop in device-independent pixels. Electron asks for a 1366×768
  window, the OS clamps it to the 1280×720 work area, and the frame takes the
  rest: **about 1264×689 of CSS pixels reach the page.**

  The trap is that Tailwind's `xl:` breakpoint is 1280px. Every `xl:` layout
  misses by sixteen pixels and silently collapses to one column, which is why
  the screens once stacked into rows on the real machine while looking correct
  in a browser sized to 1366. **Do not gate a layout on `xl:`.** This is a
  desktop application with `minWidth: 1180`, so the splits are unconditional
  `grid-cols-[...]` and need no breakpoint at all.

  Check a layout at 1264×689, never at 1366×768. If you only have a browser,
  set that size explicitly.
- **`main` owns the height; no screen computes one from `100vh`.** `main` is
  `overflow-hidden`, and every screen is one of two kinds. A *workbench*
  (learners, weigh-in, slips, returns, sf8, audit) is `h-full min-h-0` and
  fills exactly, with panels `min-h-0` and their bodies
  `min-h-0 flex-1 overflow-auto` so they scroll internally and every column
  ends on the same line. A *reading screen* (dashboard, settings) scrolls its
  own root. Screens carry their own `p-5` so a scroller's bar sits at the true
  edge. The old `max-h-[calc(100vh-124px)]` was off by 32px and applied to
  only some panels, which is what left neighbouring columns misaligned.
- **A multicol box must keep an auto height.** Give `columns-*` a definite
  height and CSS lays the overflow out as more columns to the RIGHT instead of
  growing downward, pushing panels off-screen. On settings the scroller is the
  outer box; the multicol inside it is auto-height.
- **Every figure ships with its denominator.**
- **Zero em-dashes.** Regular hyphen only, in code, copy, and this file.
  Em-dash density is the most recognisable "written by an LLM" signal and a
  panel reads that as unearned.
- **Mock measurements must be physically possible.** Heights derive from the
  drawn height-for-age z, so a 133cm nine-year-old is Normal and a stunted one
  is genuinely short. Independent draws produced 165cm fourth-graders.

## Screens

Live in the build. Which ones appear in the sidebar depends on the role, and
the server enforces the same split independently of the nav:

| Route | Purpose | Who sees it |
|---|---|---|
| `/` | Sign-in | everyone |
| `/admin` | The school overview. Coverage, status mix by grade, the slip funnel, immunization, a by-sex table and a section ranking. Titled "Health overview" on the nurse's install. | head, nurse |
| `/dashboard` | The adviser's own class: funnel, status mix, per-grade workload, names needing a slip | advisers |
| `/learners` | Roster and filters, with one learner's record beside it | everyone, scoped |
| `/weigh-in` | Keyboard-first measurement capture with pre-save classification | everyone, scoped |
| `/feeding` | The feeding program: create one, pick eligible learners, mark each serving day, read the summary | everyone, scoped |
| `/slips` | Print queue, half-sheet preview, print and PDF export | everyone, scoped |
| `/attendance` | Scan or type a stub ID at the meeting door to stamp `attended_at` | everyone, scoped |
| `/sf8` | Grade-by-grade SF8 table, printout and PDF export | head |
| `/announcements` | School notices, written by the head and read by everyone | head writes |
| `/roles` | Staff accounts | head |
| `/backup` | Backup and restore | head |

The nurse is deliberately not a second head. She reads every section because a
health record that stopped at a class boundary would be useless to her, and
she may open a feeding program, but the accounts, the notices, the SF8 and the
backup are the head's. `server/src/auth/session.ts` is where that distinction
is actually made; the sidebar only reflects it.

Every one of these fills the viewport exactly at 1264x689 and scrolls only
inside its panels. None of them scrolls its root, and none ends short of the
foot: a screen that stops two thirds down reads as unfinished.

The composition rule they share is that **each screen has one dominant
element**, and it is whatever the person on that screen is actually doing:

- Weigh-in: the two number fields, at 52px, the largest type in the
  application. The nurse is reading them back against an instrument, often at
  arm's length, with a child waiting. The classification lands full width
  directly beneath them so her eye never leaves the centre column.
- Dashboard: the funnel, at 40px numerals.
- Learners: the roster table, with the side column carrying either the
  selection's own breakdown or the picked learner's record. It is never empty.
  It used to say "No learner selected" and spend a quarter of the width on
  saying it.
- Slips: the half-sheet preview, because it is the only part of this system a
  parent ever sees.
- Sign-in: the form.

Held back, not deleted. The screens are still in `src/screens`; their routes
are commented out in `src/App.tsx` and their nav groups removed from
`src/components/Shell.tsx`. Restore both together.

| Route | Purpose | Why it is held |
|---|---|---|
| `/audit` | Hash-chained activity log | The rows are being written. The chain writer is not. Showing a log captioned "tamper-evident" over an unchained table would be a claim the build cannot keep. See gap 2 |
| `/settings` | RA 10173, accounts, growth reference | Superseded in part: backup moved to `/backup` and accounts to `/roles`. What is left reads "Not configured" |

**Removed, not held.** Three modules were taken out on purpose and their
tables dropped in `server/prisma/migrations/8_drop_follow_ups_and_cycles`. Do
not restore them from an old branch without reading why they went:

| What | What it did | Why it is gone |
|---|---|---|
| Follow-up and monitoring | A queue of flagged children with messages, actions and a status funnel | Removed at the school's request. The slip and the meeting attendance already carry the part the school actually runs, and the module was a second place for the same list to live |
| Weigh-in rounds | Opened and closed a named weighing round; measurements were filed into one and refused outside it | Removed with follow-ups. A measurement is now an event with a date and nothing more, so any date saves. The cost is that "current" means newest, not "measured this term" |
| Academic setup | Created and deleted grade levels and sections | The screen and its endpoints are gone. The `grade_levels` and `sections` TABLES REMAIN, because `learners.sectionId` is required and dropping them would delete the roster. School structure is now fixed at what the seed writes |

The learner record dialog lost its Enrolment tab in the same pass and now
opens on three: Overview, Growth, Health. The enrolment fields are still in
the edit form, because that is where a child is actually moved between
classes.

The dashboard also lost its z-score histogram and its height-for-age against
BMI-for-age cross-tab in the same pass. Both were the strongest analysis in the
app and both read off a stub engine: the histogram's SD warning claims to
detect measurement error using numbers that are generated. They come back with
the WHO tables, not before. A plain band breakdown stands in for now, which
also carries the legend the per-grade mix bars need.

## The feeding program

The one thing the school DOES with the figures every other screen collects.
A weigh-in produces a list of wasted children; the feeding program is what
happens to that list, and it used to happen in a notebook.

Three tables in `server/prisma/schema.prisma`: a program with a name and a
window, the learners taken onto it, and one row per child per serving day.
The route is `server/src/routes/feeding.ts` and the screen is
`src/screens/Feeding.tsx`.

Four things worth knowing before changing any of it:

- **Eligibility is a suggestion, not a gate.** The picker opens with the
  wasted and severely wasted children already ticked, because that is who a
  supplementary program is for and retyping the list every term is how names
  get missed. The nurse can take anyone on. A hard rule would be this app
  deciding a clinical question, and schools take children on for reasons the
  WHO bands cannot see.
- **Absence is stored, not left blank.** A child who was on the list and did
  not come is a fact the school needs. A serving nobody marked either way is
  counted separately as *unmarked*, because calling it an absence would blame
  the school for a day it may well have fed them.
- **The attendance rate's denominator is recorded days, not the calendar.** A
  program that ran on eighteen of its sixty days reads as eighteen. Dividing
  by the window would report a diligent school as negligent.
- **Marking attendance is deliberately wider than managing the program.**
  Opening, editing and closing one is the nurse's or the head's. Any account
  whose scope covers the learner can mark a day, so the class adviser marks
  her own class at the table. Routing every tick through the nurse would
  guarantee it is filled in from memory on Friday.

It is server-only. A feeding program is a shared list several accounts write
to on the same day, and the `local` build has no way to learn what the nurse
added this morning, so that build says so rather than pretending.

## The SF8 export

The SF8 leaves CHAS as a **PDF**, not as an editable workbook, so the figures
cannot be retyped between the school and the division office (changed
2026-10-12; it used to be the `.xlsx`).

The PDF is the school's SF8 worksheet drawn cell for cell -
`src/components/Sf8Form.tsx`: the same fifteen columns, merges, fifty rows
per sex, summary table and signature lines, on long bond paper (8.5 x 13 in)
landscape so it prints at full size, with the column header repeated on every
page. The title block (seal, title, DepEd wordmark) is set as one centred
group, a size up from the sheet's. Males first,
then females, alphabetical, everyone enrolled. A learner who was not on the
scale gets their name and birthdate and leaves weight and height blank.

The numbers are still the workbook's arithmetic. At export time the template
(`electron/templates/sf8-template.xlsx`) is read for its `BMI` and `HEIGHT`
tables and its two header pictures (`readSf8Form` in `electron/sf8-core.mjs`),
and `computeSf8` in `src/lib/sf8.ts` applies the sheet's own formulas: the
CalSheet age chain, `VLOOKUP` banding, and `#N/A` for an age the tables do not
cover, exactly as Excel shows it. Checked against Excel itself on a full
100-learner sheet: every row agrees except row 14, where the template's `H14`
is missing its age formula (Excel shows a blank age and `#N/A`; the PDF gives
the learner their age).

The installed app gets the template from the main process (`chas:sf8:template`)
because its page may be `file://`; a browser tab fetches the bundled asset.

### The old workbook writer

`buildSf8` in `electron/sf8-core.mjs` still writes the filled `.xlsx` and is
no longer called by the app. What it knew about the template:

Mechanically an `.xlsx` is a ZIP of XML. The core reads and writes one with
no dependency, and every entry it does not touch - styles, drawings, the
CalSheet, the BMI tables - is copied through still deflated, byte for byte.
Only `sheet2.xml` and `workbook.xml` are rewritten.

Three things worth knowing:

- **Almost every formula in that sheet is a *shared* formula.** Excel writes
  the expression once on a master cell and leaves `<f t="shared" si="n"/>` on
  the rest, so overwriting a master silently blanks its whole column. The
  writer refuses outright to overwrite any cell containing an `<f>`; it only
  ever writes B, C, G, I and J, which carry no formulas.
- **Two cells in the template are genuinely broken** and are repaired on the
  way through: `A12` (the first learner's row number) is empty, and `K13`
  (the second learner's Height²) holds a literal `2.24` typed over the
  formula. Both are restored to the expression their neighbours use. `L13`
  looks broken the same way and is not - it belongs to a shared group - so it
  is left alone.
- **Height goes in at full precision.** The column shows two decimals, but
  `1.286` is written rather than `1.29`, so the BMI the sheet computes is the
  same number CHAS computed from the same measurement. Rounding there would
  have made the screen and the paper disagree in the last digit, which is the
  one thing this export exists to prevent.

The school ID cell is left empty on purpose. A DepEd School ID is issued, not
invented, and ours is not on file. `src/data/school.ts` holds the rest of the
header; a second school adopting CHAS changes that file and nothing else.

The template has a third broken cell the writer does not repair: `H14`, the
third boy's age, is empty, so a workbook it writes shows that learner with no
age and `#N/A` for BMI category.

## The growth reference

`src/data/who2007.json` holds the WHO 2007 L, M and S parameters for
BMI-for-age and height-for-age, 5 to 19 years, both sexes, one row per
completed month from 61 to 228. 168 rows per file, four files, 18KB.

It is *data*, not code. `src/lib/nutrition.ts` reads it and computes
`z = ((value/M)^L - 1) / (L*S)`.

Two scripts, and the difference between them matters:

- `node scripts/extract-who.mjs <dir> <out.json>` rebuilds the table from
  WHO's downloaded xlsx files. It maps columns **by header name**, because
  the two indicators do not share a layout: height-for-age carries two extra
  columns (`StDev`, `SD5neg`) that BMI-for-age does not, so a fixed column
  mapping is silently wrong by two columns for height. Ask how that was
  found: the script reconstructs WHO's own published SD columns from the
  parameters it just parsed and refuses to write the file if any value
  disagrees by more than 0.005. It caught exactly this.
- `node scripts/verify-who.mjs` validates the shipped engine. It bundles
  `nutrition.ts` and round-trips all 4704 published SD lines through the real
  exported functions. Current result: largest error 5.3e-15, out-of-range ages
  return null.

Two details worth knowing before defending this:

- **Age is completed months at the date of weighing**, which is DepEd's rule
  and where most manual SF8 errors come from.
- **BMI-for-age uses WHO's restricted LMS beyond ±3 SD.** Outside that range
  the Box-Cox tail is not supported by the data, so WHO extrapolates linearly
  on the width of the 2-to-3 SD band. Height-for-age is not weight-based and
  takes plain LMS throughout. Both behaviours are implemented and tested.
- **Outside 5y1m to 19y0m the engine returns null, not a guess.** The
  weigh-in screen says so rather than inventing a band.

## Known gaps - read before defending this

1. **The z-score engine has now met a DepEd table, and one thing changed.**
   `src/lib/nutrition.ts` loads the WHO 2007 LMS parameters as data and
   computes z properly. `node scripts/verify-who.mjs` round-trips all 4704 of
   WHO's own published SD lines back through the engine and agrees to 5e-15.

   The school's own SF8 workbook carries its per-month cut-off tables inside
   it, on a sheet named `BMI Tables`, sourced from `who.int/growthref`. Every
   band edge in it was compared against this engine, at all 168 ages, both
   sexes, for both indices:

   - **The numbers agree.** Differences are within one rounding step (0.1)
     essentially everywhere, and exactly zero for girls' height-for-age and
     the +2 SD boys' edge. The LMS maths, the tables and the completed-months
     age rule are all confirmed against DepEd's own file.
   - **The BMI banding did not.** The workbook runs Normal from -2 to +2 SD,
     Overweight +2 to +3, Obese +3 and above - not the WHO 5-19 convention of
     +1 and +2. Verified on values, not labels: at 61 months its "Normal to"
     is 18.3 where our +2 SD is 18.26, and its "Overweight to" is 20.2 where
     our +3 SD is 20.17.

   CHAS now follows the form, so the screen and the submitted SF8 cannot
   disagree. `BMI_CUTOFFS` in `src/lib/nutrition.ts` is the only place that
   encodes this, and its comment records the departure. Band probes inside
   every band of the workbook's table, 1680 of them, now agree 100%.

   One thing to say plainly if asked: **this is the school's workbook, not a
   DepEd issuance.** Its first sheet is titled "Sir Wedz Helper Tables" and a
   working note is still sitting in a CalSheet cell. It is the form actually
   being filled in, which is why the app matches it, but if a memo prescribing
   +1/+2 turns up, that array is a two-line change.

   The workbook also has a transcription slip worth knowing about: boys'
   height-for-age at -3 SD runs 137.0 cm at 162 months, **136.5 at 163**, then
   138.0 at 164. Height cannot dip. This engine says 137.5, which fits.

   The previous stub used `(bmi - 16.6) / 1.85` for every child regardless of
   age or sex. If you find that expression anywhere, it is a bug.
2. **The audit log is append-only, not tamper-evident.** Rows are written on
   every meaningful action and nothing in the API updates or deletes one. That
   is as far as it goes. `prevHash` and `hash` sit on the table, nullable,
   with no writer behind them, so an edit made in `psql` would leave no trace.
   Do not say "tamper-evident" until the chain writer exists. "Every action is
   recorded against a named account" is true today and is the claim to make.
3. **Encryption at rest is now a deployment question.** The data is in
   PostgreSQL, so this is disk or volume encryption on whatever hosts it, plus
   whatever the backup lands on. It is no longer something the application can
   claim on its own.
4. **Roles are real, and the remaining weakness is passphrase hygiene.** Each
   person has an account, the server scopes every query by it, and every write
   carries a user id, so audit entries are attributable in a way a shared
   workstation could never make them. What is left is a policy problem:
   `server/prisma/seed.ts` ships a known development passphrase, and a
   deployment that keeps it has no access control at all. Change them.
5. **The QR encodes an opaque stub ID only.** Confirm a USB scanner exists at
   the meeting door; the stub ID is also human-typable as a fallback.
6. **Baselines are unmeasured.** SF8 preparation time, encoding errors, reply
   rate, and measurement-to-advisory days all need a recorded "before" or the
   metrics are unfalsifiable.
7. **Reply rate is measured, not targeted.** A low rate is a finding about how
   advisories travel home, not a project failure.
8. **The status scale has a red-green problem under protanopia.** Measured, not
   guessed: Normal `#136c34` against Wasted `#b4400b` separate by only ΔE 4.9
   (OKLab x100) in protan simulation, where 8 is the floor. Those two are the
   boundary between "fine" and "needs intervention", so that is the worst pair
   in the app to lose. Every place a band appears now carries a second channel
   (band name as text, legend, per-mark tooltip, and counts in the section
   table), which is the accepted mitigation, but the hues themselves are still
   the weak point. Swapping Normal to a teal `#0f766e` lifts that pair to
   ΔE 12.9 and passes; the cost is that teal then sits ΔE 10.2 from the Tall
   blue `#0369a1` on the height-for-age scale, and green-for-normal is the
   DepEd and WHO convention. Unresolved on purpose: it is a clinical
   convention call, not a styling one.

## Next

- Hash-chained audit writer and chain verifier, then `/audit` can be restored
- Real QR encoding on the slip, in place of the deterministic placeholder
- A roster import, so the learner list stops being seeded
- Encryption at rest and TLS on whatever hosts the database

Done since this list was last honest: the WHO 2007 LMS tables and their
verification script, PostgreSQL behind an API with real accounts, and
`attended_at` stamping from a scanned stub on `/attendance`.
