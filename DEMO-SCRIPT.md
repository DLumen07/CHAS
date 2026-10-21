# CHAS - Demo / Screen-Recording Script

Child Health Assessment System, Detailen Elementary School, Maria Aurora, Aurora.
Capstone 2026. Build 0.1.0 (pre-test).

Target running time: **8 to 10 minutes**. Everything below is written to be read
aloud. Bracketed lines are stage directions - do not read those.

---

## 0. Before you hit record

Check these once. Every one of them has broken a run-through before.

| Check | Why |
|---|---|
| Run `CHAS-0.1.0-portable.exe` (or the installed build), not `npm run dev` | Dev shows a Vite banner and hot-reload flicker on camera |
| Leave the window at the app's own size | The layout is tuned for 1264x689 CSS pixels. Do not maximise onto a second monitor with different scaling |
| A **printer or "Microsoft Print to PDF"** is installed | The Slips step opens the system print dialog. A machine with no printer shows an error instead |
| Pick a save folder for the PDF and the SF8 ahead of time | Do not go hunting through Explorer on camera |
| Have Excel ready | You will open the exported SF8 at the end |
| Close Slack, mail, notification toasts | |
| Record at 1080p, cursor highlight ON | The weigh-in step is keyboard-driven and hard to follow without it |
| Decide your two demo learners in advance | One flagged learner for the slip, one to re-measure. Note their names on paper |

If you are recording rather than presenting live, record in **five takes**, one
per section below, and cut them together. Nothing carries state between sections
that a restart would lose.

---

## 1. Cold open - what this is (0:00 - 0:45)

[Desktop, app not yet open. Or a title card.]

> This is CHAS, the Child Health Assessment System, built for Detailen
> Elementary School in Maria Aurora, Aurora.
>
> The problem it addresses is a paper one. Twice a year a school nurse weighs
> and measures every learner, works out each child's nutritional status by hand
> against DepEd's tables, writes it into the SF8 form, and sends an advisory
> home to the parents of the children who need one. That is roughly a hundred
> and eighty learners, done with a calculator and a printed table, and the
> classification step is where the errors live.
>
> CHAS does the arithmetic, produces the school's SF8 as a PDF, prints the
> parent invitation, and tracks the feeding program that follows from it. It
> runs on a **school server** on the school's own network: the head, the nurse
> and each class adviser sign in from their own machine and see exactly the
> learners their account is entitled to.
>
> It began as a single offline laptop, and that build still exists for a school
> with no network at all. What moved it was the obvious problem: six advisers
> weighing six classes into six separate files that nobody could add up.

[Double-click the CHAS icon. Let the window open on camera - it is fast, and it
makes the "this is a real installed application, not a website" point for you.]

**If SmartScreen appears** ("Windows protected your PC"): do not hide it, use it.

> That warning is Windows telling you this build is not code-signed. A signing
> certificate costs money and is not part of a capstone. More info, Run anyway.

---

## 2. Sign-in (0:45 - 1:45)

[The sign-in card. Do not type yet - let it sit for three seconds.]

### What is on screen

A single card. Navy rail on the left, white form on the right. The rail is the
same 220 pixels and the same navy as the sidebar you are about to see, so the
door and the room are visibly the same building.

### Script

> The rail shows the state of the records **before** you unlock them: how many
> learners are on the roster, how many measurements are already saved, and two
> standing facts - the link to the school server is encrypted, and the records
> are covered by RA 10173, the Data Privacy Act.
>
> That line used to read "offline, local records only". It does not any more,
> and changing it mattered: a claim about where data lives has to follow the
> data.
>
> The amber line says "running on sample data", and I want to be precise about
> what that means, because it is the honest caveat of this build. The learner
> **names and LRNs are generated** - we do not hold the school's real roster
> yet. Everything I type today is real and is saved to the school server.

[Cursor on the role block.]

> All three roles are real now, and they are three different jobs rather than
> three levels of the same one. A **Class Adviser** holds one section and sees
> only those learners. The **School Nurse** reads every section, because a
> flagged child is sent to her out of any class. The **Administrator** is the
> head: she reads the school as well, and the accounts, the notices, the SF8
> and the backup are hers.
>
> The nurse is deliberately not a second head. Scope and privilege are two
> different questions, and the server keeps them apart.

[Click **Sign in** with both fields empty. The validation errors appear.]

> The form validates. Every account is one person's, so every action is
> recorded against a named user rather than against a machine.

[Type `m.ocampo`, then a passphrase. **Turn Caps Lock on**, type two more
characters - the "Caps Lock is on" warning appears. Turn it off. Optionally click
the eye icon to reveal the passphrase.]

> Caps Lock warning, on a field you cannot read back. Small thing, but a nurse
> typing a long passphrase blind is the commonest reason a
> sign-in fails twice in a row.

[Click **Sign in**. The card expands into the full application.]

> The passphrase authenticates you to the school server. It is never stored in
> the clear - the database holds an Argon2id hash - and it cannot be recovered,
> only reset by the head.

**Do not say "the database is encrypted" as a finished fact.** Encryption at
rest moved with the data: it is now whatever the machine hosting PostgreSQL
provides, and it is a deployment decision rather than something the app does.
If asked: *"Passphrases are hashed, the link is TLS, and encryption at rest is
the host's to provide. The application does not claim to do it itself."*

---

## 3. Dashboard - the state of the work (1:45 - 3:15)

[Route `/dashboard`. Let it land. Nothing animates on mount - worth pointing out:
a screen the nurse opens forty times a day must be readable at once, not
assembled over a second.]

### What is on screen

- Header: greeting, "S.Y. 2026-2027, 1st weigh-in", and the amber **Sample roster** chip
- Four summary cards: **Learners enrolled**, **Weighed in**, **Flagged**, **Slips printed**
- Left column: **By grade level** table, and the **Nutritional status** distribution
- Right rail, full height: **Needs attention** - the actual names

### Script

> This is what the nurse opens on. The four cards across the top are the four
> numbers somebody asks for at the door: how many learners, how many have been
> weighed, how many came back flagged, and how many advisory slips have gone
> out. Each one carries its denominator - a figure without one is not a finding.

[Hover the Flagged card and read its note.]

> Flagged is anyone whose BMI-for-age or height-for-age is outside Normal. The
> note underneath separates the ones who need a **referral**, not just a slip -
> that is severely wasted or severely stunted.

[Move to the grade table.]

> By grade level, sorted by **most work outstanding first**, so the grade with
> seven children still to measure is at the top. The small bar is that grade's
> BMI-for-age mix.

[Click a grade row. It navigates to `/learners` filtered to that grade.]

> And the row is a way in, not just a readout - it opens the roster already
> filtered to that grade.

[Back to the dashboard. Toggle **BMI-for-age / Height-for-age** on the
Nutritional status panel.]

> One panel, two indices, drawn the same way so you can compare them. This
> matters more than it looks: **height-for-age and BMI-for-age answer different
> questions.** BMI-for-age is the child's condition now - wasted, normal,
> overweight. Height-for-age is stunting, which is accumulated history. A child
> can be perfectly normal on one and stunted on the other, and the intervention
> is different.

[Move to the Needs attention rail.]

> The right column carries the **names**, not just the counts, because "who needs
> help" should be answered here and not one screen away. Referrals sit at the
> top, then everyone flagged who still has no slip. That is the actual order of
> work: refer, then advise.

[If the severe banner is showing, read it. Then click a name - it opens that
learner in the roster.]

**Colour note, if a panel member asks:** the four cards use three depths of the
school seal's royal blue plus the seal's yellow. Nothing decorative borrows from
the status scale - on this screen green means Normal, orange means Wasted,
violet means Overweight, and nothing else is allowed to say those words.

---

## 4. Weigh-in - the core loop (3:15 - 5:15)

**This is the most important two minutes of the recording.** Slow down here.

[Sidebar > Weigh-in.]

### What is on screen

- Left rail: the **Queue** for one grade - "Up next", "Recorded", "Absent", with a running count
- Centre: the learner's name, sex and age, then **two very large number fields** - Height and Weight
- Directly under them: the **verdict**, both indices
- Foot: **Save and next learner**, **Skip (absent)**, the keyboard hint, and Undo

### Script

> This is where the nurse actually spends her morning. She does one thing here,
> forty times an hour, with a child standing on a scale in front of her: read two
> numbers off an instrument and type them.
>
> So the two numbers **are** the screen. They are set at fifty-two pixels, the
> largest type anywhere in the application, because she is reading them back
> against the instrument at arm's length with a child waiting.

[Pick the grade in the rail dropdown. Type a height - e.g. `128.5` - then Tab.]

> Height first. And watch the panel underneath -

[Pause on the verdict. Height-for-age has already resolved.]

> **Height-for-age already has an answer**, because that index needs the height
> alone. It does not wait for the weight.

[Type the weight - e.g. `24.2`.]

> And now BMI-for-age lands, with the computed BMI and the z-score, **before
> anything is saved**. The nurse sees the classification while the child is still
> in front of her. If it says severely wasted, she can act on it there rather
> than finding out at print time three days later.

[Press Enter. It saves and advances to the next learner.]

> Tab between the fields, Enter saves and moves on. She never touches the mouse
> in a normal run.

Now demonstrate the three real-world escapes. **Do all three** - they are what
separates this from a mockup.

**a) Out-of-order arrival.** [Click any name in the "Up next" list.]

> Children do not arrive in roster order. Any name in the queue is clickable, so
> she takes the child who is actually standing there instead of marking six
> learners absent to get to them.

**b) Correction.** [Click a name under "Recorded". Its values load back into the
fields. Change one digit - the button now reads "Save correction".]

> A mistyped number is not a disaster. Recorded learners stay in the queue with
> their values, and clicking one re-opens it for correction.

**c) Absent, and Undo.** [Use **Skip (absent)** on one learner - they move to the
Absent group, and can be put back. Then save a measurement and press **Undo** at
the foot.]

> Absent moves the queue on without inventing a measurement. And the last save
> can always be undone.

**d) The implausible-value guard.** [Type a clearly wrong reading - e.g. a height
of `250`.]

> The screen pushes back on a physically implausible reading rather than filing
> it silently. A transposed digit is the error this whole design is trying to
> catch.

### Say this out loud - it is the technical heart of the demo

> I want to be explicit about what is happening behind that classification,
> because it is the part reviewers should test hardest.
>
> The app carries the **WHO 2007 growth reference** - the L, M and S parameters
> for BMI-for-age and height-for-age, ages five to nineteen, both sexes, one row
> for every completed month. It computes the z-score properly: **z equals value
> over M, raised to L, minus one, divided by L times S.**
>
> Three details matter.
>
> First, **age is completed months at the date of weighing**, which is DepEd's
> rule and where most manual SF8 errors come from.
>
> Second, the engine was validated against WHO's own published standard-deviation
> tables - all 4,704 lines round-tripped through the shipped code, largest
> disagreement about five times ten to the minus fifteen. That is floating-point
> noise, not error.
>
> Third, and this is the interesting one: we then compared it against **the
> school's actual SF8 workbook**, which carries its own cut-off tables inside it.
> The numbers agree everywhere within one rounding step. But the workbook's **BMI
> banding differs from the WHO convention** - it runs Normal from minus two to
> plus two SD, where WHO for this age group uses plus one and plus two. CHAS
> follows the form the school is actually filling in, so the screen and the
> submitted SF8 cannot disagree with each other. That decision is recorded in one
> place in the code, and it is a two-line change if a DepEd memo says otherwise.
>
> And outside five years one month to nineteen years, the engine returns
> **nothing** rather than a guess, and this screen says so.

---

## 5. Learners and the SF8 export (5:15 - 7:00)

[Sidebar > Learners.]

### What is on screen

- Toolbar: search, grade picker, and four filters - All / Flagged only / Not yet measured / No slip printed
- The roster table, dominant
- Right column: the **breakdown of whatever is currently selected**, or one learner's record once a row is picked
- **Export SF8** button

### Script

> The roster. Filters across the top, and the side column is never empty - with
> no learner picked it shows the breakdown of whatever the filters currently
> select, and it swaps to the learner's own record when you pick a row.

[Use the header search - type part of a name or an LRN.]

> The search in the header is the only search in the application, and it writes
> into the URL, so a filtered view is a view you can link to and it survives a
> reload.

[Click **Flagged only**, then click a flagged learner. The record panel fills.]

> One learner's record: the measurement, both indices with their z-scores, and
> slip status.

### The SF8 - do this deliberately

[Choose a grade in the grade picker. Click **Export PDF**. Save it, then **open
the PDF on camera.**]

> This is the part I would ask you to look at hardest, because it is where the
> project stops being a screen and starts being paperwork somebody submits.
>
> What comes out is **the school's SF8 form, as a PDF**. Same columns, same
> fifty rows per sex, same summary table and signature lines as the school's
> own SF8 workbook. Males first, then females, alphabetical, everyone enrolled.
> A learner who was not on the scale gets their name and birthdate and leaves
> weight and height blank, which is exactly what a half-finished SF8 looks like.
>
> It is a PDF on purpose. A spreadsheet is a file anyone can retype a cell in on
> the way to the division office; a PDF carries the figures as they were recorded.

[Point at an Age, BMI Category and Height-for-Age value.]

> The numbers are still **the workbook's arithmetic**. At export time CHAS reads
> the school's workbook for its own per-month cut-off tables and applies its own
> formulas - the same age rule, the same table lookups. We checked it against
> Excel on a full hundred-learner sheet: every row agrees.

**If asked how:** an .xlsx is a ZIP of XML. A small reader with no third-party
dependency opens the template, takes the BMI and height tables and the two DepEd
pictures out of it, and the form is drawn and printed to PDF by the app.

**Extras worth naming if you have time:**

- The template has a broken cell: the third boy's Age formula is missing, so
  in Excel that learner shows no age and #N/A. The PDF gives him his age. We
  found it by checking against Excel.
- An age the tables do not cover (under five) shows **#N/A**, exactly as the
  workbook would, rather than a guessed band.
- The **School ID cell is left empty on purpose.** A DepEd School ID is issued,
  not invented, and ours is not on file.

---

## 6. Advisory slips - what the parent sees (7:00 - 8:45)

[Sidebar > Advisory slips.]

### What is on screen

- Left: the **Print queue** - flagged learners, with select-all and a running count
- Right, dominant: the **half-sheet preview**, on a grey wash so the edge of the paper is visible
- Buttons: **Print** and **Save as PDF**

### Script

> The preview is the biggest thing on this screen for one reason: **it is the
> only part of this system a parent ever sees.**

[Zoom the recording, or move the cursor down the sheet, and walk it top to
bottom.]

> It is a half-sheet, 8.5 by 5.5 inches, one slip per page. School header. The
> learner's details, then age at date of weighing, date weighed, height, weight,
> BMI.
>
> Then the nutritional status block - **both** indices, BMI-for-age and
> height-for-age, written out as words, not just a colour.
>
> The body text is **Filipino first, English underneath**. This goes home to a
> parent in Maria Aurora. English-first would be the wrong choice for the
> audience.
>
> Down the side is a QR code and a reference code. Read what it says beneath it:
> *"Contains a reference code only - no health data."* The QR encodes an **opaque
> stub ID and nothing else**. If this slip is dropped in a corridor, it discloses
> nothing about the child. That is a deliberate privacy decision, not an
> oversight.
>
> Below the tear line is the acknowledgment stub: parent's signature, date, and
> the same reference code again. The parent signs and returns that half, the
> adviser scans it, and the system knows the advisory actually arrived home.

[Tick two or three learners in the queue - point at the running count. Then click
**Save as PDF**, save it, and open the PDF on camera.]

> Selecting a batch renders every ticked slip and hands the whole set to the
> printer or to PDF - and both routes produce the identical document, because it
> is the same rendered page.

[Show the multi-page PDF - flick through two pages so the "one slip per page"
claim is visible on screen.]

> Saving a PDF stamps the printed timestamp on each learner. Printing to paper
> does not, and I will say why: the Windows print dialog reports nothing back to
> the application. It cannot tell us the paper came out. Rather than record
> something we do not know, we record nothing.

[Return to the dashboard for two seconds. The "Slips printed" card has moved.]

> And the funnel closes: those learners now count as printed.

---

## 6b. The feeding program - what happens to the flagged children

[Sidebar, under **Advise**, click **Feeding program**.]

### What is on screen

Programs down the left, the selected program on the right with three tabs:
Beneficiaries, Attendance, Summary.

### Script

> Everything so far has been measuring and telling. This is the part where the
> school actually does something, and it is the one module that came out of
> asking what happens after the parent meeting.
>
> A feeding program has a name and a window, and that window is what every
> figure here is counted against.

[Beneficiaries tab. Click **Select learners**.]

> The picker opens with the wasted and severely wasted children already ticked.
> That is who a supplementary program is for, and retyping that list every term
> is how a name gets missed.
>
> But it is a suggestion, not a rule. The nurse can take anyone on, and she can
> say why. A school takes children on for reasons the WHO tables cannot see -
> a family situation, a referral from the class adviser - and an app that
> refused would be deciding a clinical question it has no business deciding.

[Attendance tab. Pick a serving day. Mark one child served, one missed. Record.]

> One day at a time, because that is how it is served: the adviser stands at
> the table and goes down her list once. The whole day saves in one request.
>
> And notice there are two buttons, not one. **Missed** is recorded, not left
> blank. A child who was on the list and did not come is a fact the school
> needs - it is the difference between a program that is not being served and
> one that is not reaching the children.

[Summary tab.]

> This is what a division office asks for. Beneficiaries, serving days,
> servings given, missed.
>
> The number I want to point at is the rate, because the denominator is the
> honest part. It is measured against **the days the school actually recorded**,
> not the length of the window. A program that ran on eighteen of its sixty
> days reads as eighteen. Dividing by sixty would report a school that fed its
> children diligently as negligent, and that is exactly the sort of figure that
> gets a school in trouble for a spreadsheet's mistake.
>
> And servings nobody marked either way are counted separately, as unmarked.
> That is a gap in the record. Calling it an absence would blame the school for
> a day it may well have fed them.

---

## 7. What is not finished (8:45 - 9:45)

**Do not skip this section.** Volunteering the gaps is what makes the rest
credible, and a panel will find them anyway.

[Back on the dashboard, or on a plain slide.]

> I want to close on what this build does **not** do yet, in plain terms.
>
> **The roster is generated.** The names, LRNs and birth dates are fabricated,
> and roster import is not built. The classification engine is real, the
> measurements I typed today are real and are on the school server, but the
> list of children is not.
>
> **Encryption at rest is not done.** The records are in PostgreSQL on the
> school's server, and whether that disk is encrypted is a deployment question
> nobody has answered yet. Neither is TLS in front of the API. Both are on the
> list and neither is written.
>
> **The audit log is written but not chained.** Every meaningful action lands a
> row against a named account and nothing in the API updates or deletes one, so
> it is **append-only**. It is not yet **tamper-evident**: the columns for the
> hash chain are on the table and nothing fills them, so somebody with database
> access could edit a row and leave no trace. I will claim the first and not
> the second.
>
> **Two screens are held back, not deleted** - the audit log and settings. Each
> rests on a part that is still a stub, and a screen that states a guarantee the
> build cannot keep is worse than one that is not shown yet.
>
> **And three modules were removed on purpose**, not lost: follow-up
> monitoring, weigh-in rounds, and academic setup. The school asked for a
> smaller system, and the part it actually runs - measure, invite, feed - is
> what is left. Removing a feature you built is a harder decision than adding
> one, so it is worth saying out loud rather than hoping nobody notices.
>
> **The role model is only as strong as the passphrases.** Every account is one
> person's and the server scopes every query by it, so an audit entry names a
> person. What that cannot survive is a shared passphrase, or a deployment that
> keeps the development one the seed prints. That is a policy problem software
> cannot solve.
>
> **And the baselines are unmeasured.** How long SF8 preparation takes today,
> today's encoding error rate, today's reply rate - none of those have a recorded
> "before" yet, and without one, any improvement figure is unfalsifiable.
>
> What is done and defensible today: the growth reference is real and validated
> against WHO's own tables and against the school's workbook; the SF8 export
> fills the school's real form using the form's own arithmetic; and the parent
> advisory prints.

---

## 8. Q&A - answers to have ready

| Question | Answer |
|---|---|
| **Why a school server and not the cloud?** | The data is minors' health information and the school does not have reliable internet. It runs on the school's own network, so there is no hosting cost, no third party holding the records, and it keeps working when the line goes down. An offline single-laptop build still exists for a school with no network at all. |
| **Why Electron at all, if there is a server?** | Two capabilities a browser tab cannot have: saving the SF8 and the slips straight to PDF, and driving the printer directly. The head's machine runs the desktop build for those. Everyone else can use a browser. |
| **How do you know the z-scores are right?** | Two independent checks. All 4,704 of WHO's published SD lines round-tripped through the shipped code, largest error about 5e-15. Then every band edge compared against the school's own SF8 tables at all 168 ages, both sexes, both indices - agreement within one rounding step. |
| **Why does your BMI banding differ from WHO?** | It follows the school's actual SF8 workbook, so the screen and the submitted form cannot disagree. It is encoded in one place with a comment recording the departure, and it is a two-line change if a memo prescribes otherwise. Say plainly: that workbook is the school's, not a DepEd issuance. |
| **What is in the QR code?** | An opaque reference ID. No name, no measurement, no status. |
| **Is the data encrypted?** | In transit, yes, once TLS is in front of the API. At rest it is whatever the machine hosting PostgreSQL provides, and that is a deployment decision rather than something the application does. Do not overclaim this. Passphrases are a different question and those are Argon2id hashes, never stored in the clear. |
| **Can two people use it at once?** | Yes. That is the reason for the server. Six advisers, the head and the nurse can all be in it, and each sees only what their account is scoped to. |
| **What happens outside 5-19 years?** | The engine returns nothing rather than a guess, and the weigh-in screen says so. |
| **Why does printing not mark the slip as printed?** | The system print dialog reports nothing back. Saving a PDF does stamp it. Recording an unknown as a fact would be worse. |
| **Accessibility / colour blindness?** | Measured, not assumed. The Normal-against-Wasted pair is the weakest under protanopia, and it is the most important pair to get right. Every place a band appears carries a second channel - the band name in text, a legend, tooltips, and counts - so colour is never the only signal. Changing the hue itself is a clinical-convention call, so it is left open deliberately. |
| **What if the school has no printer?** | PDF export works regardless, and the slip is designed to print on a half sheet from any office printer. |
| **How long did the SF8 take before?** | Answer honestly: unmeasured. It is on the gap list. |

---

## 9. Recording checklist

- [ ] Portable or installed build, not `npm run dev`
- [ ] Printer or Print-to-PDF available
- [ ] Save folder chosen; Excel ready to open the SF8
- [ ] Two demo learners chosen and written down
- [ ] Cursor highlight on
- [ ] Notifications off
- [ ] Section 4 (weigh-in) and section 6 (slip) recorded slowly - these two carry the project
- [ ] Section 7 (gaps) not cut for time
