/* The rule for a person's name (2026-10-22, the user's request: a surname
   such as "12345" was accepted). Letters - ñ and accented letters included -
   spaces, hyphens, apostrophes and periods, starting with a letter. No
   digits or other symbols. "Dela Cruz", "O'Neil", "Sto. Niño", "Jr." and
   "III" all pass.

   The server checks the same pattern (server/src/routes/learners.ts and
   users.ts); this copy is so the form says so before anything is sent. */

const NAME = /^\p{L}[\p{L}\p{M} .'’-]*$/u

export function isValidName(value: string): boolean {
  return NAME.test(value.trim())
}

/** The message for a name box, or undefined when it is fine. `label` is
    lower case: "surname", "first name". Blank is the caller's to judge. */
export function nameError(value: string, label: string): string | undefined {
  const v = value.trim()
  if (!v || NAME.test(v)) return undefined
  return `The ${label} can only have letters, spaces, hyphens, apostrophes and periods.`
}
