/* Recovery codes: the way back in when a password is forgotten.

   Each account - head and nurse alike - makes its own set of eight on My
   account and keeps the printed sheet somewhere safe. They work offline,
   which is the point: CHAS runs on one machine with no internet.

   Twelve characters from an alphabet with no look-alikes (no 0/O, 1/I/L),
   printed as XXXX-XXXX-XXXX so they can be read off paper and typed. About
   60 bits each, and Argon2id-hashed like a password, because they last until
   used. */

import { randomInt } from 'node:crypto'

export const RECOVERY_CODE_COUNT = 8

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function newRecoveryCode(): string {
  let s = ''
  for (let i = 0; i < 12; i++) s += ALPHABET[randomInt(0, ALPHABET.length)]
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

/** What is hashed and compared: upper case, dashes and spaces removed. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '')
}
