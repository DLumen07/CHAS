# CHAS: Child Health Assessment System

**An offline desktop system for nutritional status monitoring and parent meeting invitations at Detailen Elementary School, Maria Aurora, Aurora**

Capstone project, School Year 2026–2027

> This document describes the system: what it is for, who uses it, what it does and how it fits the school's work. It leaves out the programming details, which are in `README.md`. It is written as source material for the capstone paper (Chapter 1 onward), and it describes the system **as it is now built**. The last section lists where the earlier Chapters 1–2 draft no longer matches the system.

---

## 1. Summary

CHAS is a desktop application installed on one school computer. The school nurse and the school head use it to record learners' height and weight, find each learner's nutritional status automatically, and act on the result.

For every learner whose status is not normal, CHAS prints an **invitation slip** asking the parent or guardian to attend a meeting at the school. The bottom half of the slip is an **attendance stub**. The parent brings it to the meeting, and the nurse scans or types its code, so the school knows exactly which parents attended. CHAS also produces **School Form 8 (SF8)**, the Learner's Basic Health and Nutrition Report, as a PDF laid out like the school's own SF8 form and computed from that form's own tables.

The system works without an internet connection. All records stay on the one computer where it is installed.

---

## 2. The setting

| | |
|---|---|
| School | Detailen Elementary School |
| District / Division / Region | Maria Aurora East District, Division of Aurora, Region III – Central Luzon |
| Learners covered | Grades 1 to 6, one section per grade level |
| Users | The school nurse and the school head |
| Equipment | One Windows computer; a printer is optional |
| Connectivity | None required |

---

## 3. The problem CHAS addresses

Twice a school year, every learner is weighed and measured. In the current manual practice:

1. **Measurements are written on paper and encoded later** into an Excel workbook. Every value is copied at least twice, and each copy can introduce errors.
2. **Each learner's age must be computed in completed months** from the birth date to the weighing date before the classification tables can be read. Done by hand for a whole school, this is slow and easy to get wrong. A wrong age gives a wrong classification.
3. **Nutritional status is read off printed tables** for every learner, one at a time, under time pressure.
4. **School Form 8 is prepared by hand** from those results.
5. **Parents are usually told verbally, if at all.** The school has no written record that a parent was informed, and no record of whether the parent came in to discuss the child's condition.
6. **There is no quick way to see who still needs attention**: who has not been measured, which learners are severe cases, which parents have not responded.

---

## 4. What CHAS does: the process

CHAS follows the process the school already uses and automates its steps:

1. **Measure.** The nurse enters the learner's height and weight at the weigh-in station.
2. **Compute automatically.** CHAS computes the age in completed months, the Body Mass Index (BMI), and the two WHO 2007 indicators: BMI-for-age and height-for-age.
3. **Save.** The measurement is saved under the nurse's account, with the date.
4. **Show nutritional status.** The learner's status is shown at once, together with where the reading falls on the learner's growth chart.
5. **Invite the parent.** Every learner who is not normal gets an invitation slip for a parent meeting. When the parent arrives with the stub, the nurse scans it, and the parent is recorded as having attended.

Around this core, CHAS keeps learner records, highlights the cases that need attention first, prepares SF8, and moves the school into the next school year.

---

## 5. Users and what each one can do

There are two kinds of accounts. Each person signs in with their own username and password.

| Feature | School nurse | School head |
|---|:---:|:---:|
| Health overview / School overview | ✔ (nurse view) | ✔ (school view) |
| Learners (enrol, view, edit records) | ✔ | ✔ |
| Weigh-in | ✔ | ✔ |
| Invitation slips | ✔ | ✔ |
| Meeting attendance | ✔ | ✔ |
| SF8 export | ✔ | ✔ |
| Staff accounts (Roles) | – | ✔ |
| Backup and restore | – | ✔ |
| New school year | – | ✔ |

Both accounts can see every grade level. Class advisers do not sign in. Each class's adviser name is kept only because it is printed on SF8.

---

## 6. The modules

### 6.1 Sign-in
Each user signs in with a username and password. Passwords are stored in scrambled (hashed) form, never as readable text. A new installation starts with one school head account and one school nurse account. Both should change their passwords on first use.

**Forgot password?** Both ways back in work without internet:
- **Recovery code.** On the sign-in screen, *Forgot password?* asks for the username, one of the account's eight printed single-use codes, and a new password. The head and the nurse each create their own set on **My account** (sidebar, above Sign out). Creating a new set cancels the old one.
- **Reset by the head.** The head can always set a new password on the Roles screen.

**When codes run low.** After each use the sign-in screen says how many are left. When an account has two or fewer left, or has never made any, a notice appears at the top of every screen until a new set is created. This matters most for the school head: if the only head account forgets its password and has no codes left, nobody can reset it.

Every reset signs the account out everywhere and is recorded in the activity log.

### 6.2 Overview (home screen)
- **Nurse – Health overview.** A calendar; *Need monitoring by grade*, comparing each grade with the school average; *Priority cases*, the learners to see first (section 7.4); and the next parent meeting.
- **Head – School overview.** The school's weigh-in progress, the share of learners in each nutritional status, a chart of status by grade level, and parent follow-up figures with the next meeting.

### 6.3 Learners
The register of every enrolled learner, nine to a page.
- Tabs: **All**, **Needs follow-up**, **Not measured**, **Normal**, each with its count. There are also a grade filter and a search by name or LRN.
- Each learner card shows the learner's basic details, and a quick-look chart shows the growth trend.
- **Enrol learner** collects:
  - **Learner information:** LRN, name, sex and date of birth (the age is calculated).
  - **Enrolment:** school year, grade level and enrolment status (enrolled, transferred in, returning, transferred out, dropped).
  - **Parent or guardian:** name, relationship, mobile number and a secondary contact.
  - **Health history:** existing conditions and their status, treatment or medication, and important health notes.
  - **Immunization card:** vaccine, dose, date given, status and remarks.
- Opening a learner shows the full record, including every measurement taken, and allows corrections.

### 6.4 Weigh-in
The weigh-in station, used while a child is on the scale.
- **The current weigh-in round** follows the calendar automatically:
  - **Baseline weigh-in:** June 1 – December 31.
  - **Endline weigh-in:** January 1 – May 31.
- The nurse picks a learner, or follows the queue, and types the height and weight. The classification appears as the numbers are typed; there is no "compute" button. The reading is shown on the learner's growth chart before it is saved.
- **Safety checks.** Values outside the expected range are flagged before saving. If the learner's age is outside the WHO reference range (5 years 1 month to 19 years), CHAS gives no classification and asks the nurse to check the birth date.
- **Queue:** To measure, Measured and Absent. A learner who is not present can be marked **Absent**.
- **Re-measuring.** A learner can be re-measured as a *new measurement* (a re-weigh) or have the latest figures *corrected*. Corrections do not erase anything: the earlier figures are kept on record.
- **Follow-up weigh-in.** With one click, the nurse can start a follow-up weigh-in for the learners who need monitoring. Earlier measurements are kept, and the station shows only those learners until the follow-up is ended.

### 6.5 Invitation slips
Prepares and prints the parent meeting invitations.
- **Parent meeting:** the date, time and venue printed on every slip, set with **Edit**.
- Three tabs:
  - **To invite:** learners needing follow-up who have not been sent a slip. All are ticked by default.
  - **Invited:** a slip has been issued. Ticking one prints a spare copy.
  - **Attended:** the parent has attended.
- The slip preview can be paged through (*Slip 1 of 9*). **Print slips** sends the slips to the printer, and **Save as PDF** saves them as a file to print later. Either way, the learners move to *Invited*.

### 6.6 Meeting attendance
Used at the door on the day of the meeting.
- The nurse scans the QR code on the stub, or types the stub ID printed beside it, and presses **Record attendance**.
- The result appears at once:
  - **Attended**, with the learner's name, grade and time.
  - **Already recorded:** the stub was scanned before; the first time is kept.
  - **No invitation found:** the code is wrong, or the learner was never invited.
- A tally ring shows how many invited parents have attended. The **Expected** list shows those who have not yet arrived.

### 6.7 SF8 export
Prepares School Form 8 for each grade level.
- **Print:** a working copy of the grade's SF8 table, for review and signatures.
- **Export PDF:** saves the grade's SF8 as a PDF laid out like the school's **own DepEd SF8 form**, with age, BMI and both classifications worked out from the form's own tables. A PDF cannot be edited like a spreadsheet, so the submitted figures stay as recorded. Each sheet holds 50 rows per sex.
- Submitting to the DepEd Learner Information System (LIS) is still done manually.

### 6.8 Staff accounts (head only)
The head creates accounts for the nurse or another head, resets forgotten passwords, and disables or deletes accounts. The system always keeps at least one active head.


### 6.9 Backup and restore (head only)
- **Back up:** saves a full copy of all records to a folder or USB drive.
- **Automatic backup:** each time CHAS closes, a full copy is saved on the computer. One copy per day is kept for the last 7 days. The Backup screen shows when the last one was made.
- **Restore:** replaces the records on the computer with a backup copy. If the backup cannot be opened, the system returns to the records it had before.
- **Password first:** both ask the head to enter their password again before they start, so a computer left signed in cannot be used to copy or replace the records. Each attempt is recorded in the activity log.

### 6.10 New school year (head only)
A guided step that moves the school into the next year.
- Every learner is **promoted** by default. Grade 6 learners are marked **Completed**.
- The head marks the exceptions: **Retained**, **Transferred out** or **Dropped**.
- Nothing is deleted; leavers are archived. The step can be **undone** until something is recorded in the new year.

---

## 7. How nutritional status is determined

### 7.1 Inputs
Sex, date of birth, the date of weighing, height in centimetres and weight in kilograms.

### 7.2 Computation
1. **Age in completed months** at the date of weighing.
2. **BMI** = weight (kg) ÷ height (m)².
3. **Z-scores** for BMI-for-age and height-for-age, using the **WHO 2007 Growth Reference for school-aged children and adolescents (5–19 years)**. A z-score says how far the learner is from the median of children of the same sex and age.

### 7.3 Status bands

| BMI-for-age | z-score | | Height-for-age | z-score |
|---|---|---|---|---|
| Severely wasted | below −3 | | Severely stunted | below −3 |
| Wasted | −3 to below −2 | | Stunted | −3 to below −2 |
| Normal | −2 to +2 | | Normal | −2 to +2 |
| Overweight | above +2 to +3 | | Tall | above +2 |
| Obese | above +3 | | | |

**An important design decision.** For school-age children, the WHO convention places *overweight* above +1 and *obese* above +2. The DepEd SF8 workbook the school uses bands them at +2 and +3. CHAS follows **the school's SF8 workbook**, so the status shown on screen is always the same as the status on the submitted form. The height-for-age bands agree with the workbook exactly.

### 7.4 Groups the system uses
- **Normal:** both indicators are normal.
- **Needs follow-up (needs monitoring):** at least one indicator is not normal. These learners receive invitation slips.
- **Priority case:** a severe band (severely wasted, severely stunted or obese), or two problems at once (wasted *and* stunted). The nurse sees these first, sorted from most to least severe.
- **Not measured:** no measurement yet in the current school year.

CHAS reports a classification. **It does not diagnose, prescribe or treat.** Clinical judgment stays with the school nurse and the health workers she refers learners to.

---

## 8. The invitation slip and attendance stub

The slip is a **half sheet (8.5 × 5.5 inches)**, one learner per slip, styled as a formal school letter:

- **Letterhead:** Republic of the Philippines · Department of Education, with the school's name and address.
- **Title:** *Paanyaya sa Magulang* (Parent / Guardian Invitation).
- **Letter:** in Filipino with an English translation, inviting the parent or guardian to a meeting about the child's health and the help the school can give. It is signed off by the School Nurse.
- **Meeting details:** date, time and venue, in a ruled table. The date is written the way the school writes letters home, for example *Oktubre 24, 2026 (Sabado)*.
- **Cut line**, then the **attendance stub:** the learner's name and grade, the meeting date, a parent's signature line, a "date attended" line, and the **QR code with its stub ID**.

**Privacy by design:**
- The slip shows **no measurement and no nutritional status**. It goes home in a child's bag, so it names only the learner and the grade; the result is explained at the meeting.
- The QR code carries **only the stub ID**, a code that means nothing outside CHAS. It is also printed as readable text, so attendance can be recorded by typing when no scanner is available.

**Why a printed slip rather than a text message?** The school has no official channel for sending health information about a named child by phone. A slip issued by the school, with a stub the parent brings back, is a record the school can keep and show later. It also turns "the letter was sent" into "the parent attended", which is what the school actually needs to know.

---

## 9. Data the system keeps

| Record | What it holds |
|---|---|
| School | Name, district, division, region; grade levels and sections with adviser names |
| Learner | LRN, name, sex, date of birth, grade level and section, enrolment status |
| Parent or guardian | Name, relationship, mobile number, secondary contact |
| Health history | Conditions and their status, treatment or medication, important notes |
| Immunization card | Vaccine, dose, date given, status, remarks |
| Measurements | Date, height and weight, who recorded them; corrections keep the earlier figures |
| Absences | Learners marked absent on a weigh-in day |
| Parent meeting | Date, time and venue |
| Slips | Per learner and school year: invited (and when), attended (and when), and which meeting |
| Follow-up weigh-ins | Which learners were included, and when it started and ended |
| School year history | Promotions and year-end outcomes, so a rollover can be undone |
| Staff accounts | Name, username, role, hashed password, hashed recovery codes, last sign-in |
| Activity log | Who did what and when: sign-ins, measurements, slips printed, attendance recorded, exports, account changes |

---

## 10. Data privacy and security

CHAS handles health information about minors, which the **Data Privacy Act of 2012 (Republic Act No. 10173)** treats as sensitive personal information. The system protects it as follows:

- **Stays on one computer.** The records live only on the computer where CHAS is installed. Nothing is sent over the internet, and nothing on the network can reach the system.
- **Personal accounts.** Every user signs in with their own account. Passwords are stored only in hashed form.
- **Roles.** Account management, backup and the school-year rollover are limited to the school head. The system refuses these actions to the nurse's account, not just hides them.
- **Accountability.** Every measurement, slip and attendance record names the account that made it. The activity log is **append-only**: the system never edits or deletes an entry. (It is not yet *tamper-evident*; see section 12.)
- **Minimal disclosure on paper.** Slips carry no health data, and the QR code holds only an opaque stub ID.
- **Backups** are full copies the head saves to a folder or USB drive. Keeping that drive safe is the school's responsibility.

---

## 11. Operating environment

- **Computer:** one Windows 10 or Windows 11 (64-bit) computer.
- **Installation:** a single installer. The database is included and set up automatically on first launch.
- **Internet:** not required.
- **Printer:** optional. Slips and SF8 can be saved as PDF and printed elsewhere.
- **Scanner:** optional. A handheld scanner speeds up attendance, but stub IDs can be typed.
- **A PDF reader** (any web browser will do) to open the exported SF8.

---

## 12. Scope and delimitations

### Scope
- Grades 1 to 6 at Detailen Elementary School, one section per grade level, for the school year of the study.
- Learner registration, with guardian, health history and immunization card details.
- Height and weight capture; automatic age, BMI, BMI-for-age and height-for-age classification (WHO 2007, using the school's SF8 bands).
- Baseline, endline and follow-up weigh-ins; absences; corrections that keep earlier figures.
- Overview screens for the nurse and the head, including priority cases.
- Printing and PDF saving of bilingual invitation slips with attendance stubs; recording meeting attendance by scanning or typing the stub ID.
- SF8 working copy (print) and SF8 export as a PDF of the school's own form.
- Staff accounts, backup and restore, and the school-year rollover.

### Delimitations
- **Not a diagnostic tool.** CHAS classifies; it does not diagnose, prescribe or treat.
- **Two indicators only:** BMI-for-age and height-for-age. Weight-for-age, weight-for-height, arm circumference and micronutrient status are not covered.
- **Ages 5 years 1 month to 19 years.** Outside this range, no classification is given.
- **No feeding program module.** The School-Based Feeding Program and school announcements were removed from the scope. The system does not select beneficiaries or record feeding attendance.
- **No parent portal, SMS or email.** All communication with households is the printed slip.
- **No connection to the DepEd LIS.** SF8 submission remains manual.
- **Roster entered by hand.** Learners are enrolled one at a time; importing a class list from a file is future work.
- **One computer, one school.** Not a web, mobile or multi-school system.
- **Measuring instruments are outside the system.** CHAS assumes the values typed are the values read. It flags implausible figures but cannot detect a scale that is out of calibration.
- **The activity log is append-only but not tamper-evident.** The hash chaining that would detect alteration is not yet implemented.
- **Encryption of the stored records** depends on the computer's own protection (for example, Windows device encryption). CHAS does not claim to encrypt its database itself.

### Items to finish before evaluation
- **The QR code on the slip is currently a placeholder pattern, not a scannable code.** Until a real QR encoder is added, attendance is recorded by **typing** the stub ID. A scanner will only work once the real code is in place.
- **The wording of the invitation letter** was drafted for the system and **needs the school's approval**.

---

## 13. Significance of the study

- **Learners:** correct, timely classification means children who need help are identified and their parents called in sooner.
- **Parents and guardians:** a written, bilingual invitation from the school explains that their child's health will be discussed and when to come, without exposing the child's result on paper.
- **The school nurse:** the arithmetic, the table lookups and the re-encoding are gone from weighing week. Priority cases and parents not yet seen are listed for her.
- **The school head:** a school-wide view of nutritional status and follow-up, an SF8 produced as a PDF of the school's own form, and a record of who entered each figure.
- **DepEd and the Schools Division Office:** more reliable nutrition data at the source, the data that school nutrition programs rely on.
- **Future researchers:** a working example of WHO 2007 classification aligned with the SF8 workbook, a government form reproduced from its own template and tables, and a school process that ends in verified parent attendance.

---

## 14. Definition of terms (as used in the system)

- **Attendance stub:** the lower, detachable part of the invitation slip. It carries the learner's name, the meeting date, signature lines and the stub ID with its QR code. The parent brings it to the meeting, and recording it marks the parent as having attended.
- **Baseline / Endline weigh-in:** the two school-year weigh-in rounds: baseline from June 1 to December 31, endline from January 1 to May 31.
- **BMI-for-age:** the learner's BMI compared with the WHO 2007 reference for the same sex and age in completed months. Bands: severely wasted, wasted, normal, overweight, obese.
- **Completed months:** age as the whole number of months from the date of birth to the date of weighing.
- **Follow-up weigh-in:** an extra weigh-in of the learners who need monitoring, started by the nurse. Earlier measurements are kept.
- **Height-for-age:** the learner's height compared with the WHO 2007 reference for the same sex and age. Bands: severely stunted, stunted, normal, tall.
- **Invitation slip:** a half-sheet, bilingual letter inviting a parent or guardian to a school meeting about the child's health, with an attendance stub.
- **Needs follow-up (needs monitoring):** a learner with at least one indicator outside the normal band.
- **Offline operation:** the system does all its work without an internet connection, on one computer.
- **Priority case:** a learner with a severe band (severely wasted, severely stunted or obese) or with two problems at once (wasted and stunted).
- **School Form 8 (SF8):** the Learner's Basic Health and Nutrition Report prescribed by DepEd. In this study, the school's own SF8 Excel workbook, whose layout and tables CHAS uses for its PDF export.
- **Stub ID:** the short code printed on each attendance stub and held in its QR code. It identifies the slip without revealing any health information.
- **WHO 2007 Growth Reference:** the World Health Organization's reference for children and adolescents aged 5 to 19 years, used to compute the z-scores.
- **Z-score:** how many standard deviations a learner's measurement lies from the median for children of the same sex and age.

---

## 15. Suggested evaluation measures

These follow from what the system does and can be used in the methodology chapter:

1. **Classification accuracy:** CHAS results compared with the WHO 2007 published tables and with the school's SF8 workbook for the same learners.
2. **Software quality:** ISO/IEC 25010:2023, rated by the nurse, the head and IT evaluators (functional suitability, performance efficiency, interaction capability, reliability, security, maintainability).
3. **Before and after the system:**
   - time to prepare SF8 for a grade level;
   - encoding errors found at review;
   - number of days from measurement to the invitation reaching the parent;
   - **parent meeting attendance rate:** parents recorded as attended ÷ parents invited.

---

## 16. Where the Chapters 1–2 draft no longer matches the system

The draft in `docs/CHAS-Chapters-1-and-2-v2.docx` was written for an earlier design. Update these points so the paper describes what is being evaluated:

| The draft says | The system now |
|---|---|
| "A **networked** desktop system" on a small server inside the school, used by several staff at once | **Offline, one computer.** The database is installed with the app; no server and no network |
| Users: school head, nurse **and class advisers**, each adviser seeing only their section | **Two users only:** the school head and the school nurse, both seeing all grades. Advisers do not sign in |
| **Advisory slip** stating the result, with a **signed return stub** proving it reached home | **Invitation slip** to a parent meeting. It shows **no result**, and the stub is **recorded as attendance** when the parent arrives |
| Measure: "proportion of slips **returned signed**" | Measure: **parent meeting attendance rate** |
| **Feeding program module** (eligibility list, daily serving attendance) | **Removed** from scope |
| **School announcements** | **Removed** from scope |
| Six advisers working at the same time instead of queuing for one machine | No longer applies; data entry is done by the nurse |
| Not mentioned | **Follow-up weigh-in**, **priority cases**, **learner health history and immunization card**, **school-year rollover with undo**, **backup and restore** |
| "Records never leave the school" | Stronger: **records never leave the one computer** |
| The QR code on the slip is described as working | It is still a **placeholder pattern**; stub IDs are typed until a real QR encoder is added (section 12) |
