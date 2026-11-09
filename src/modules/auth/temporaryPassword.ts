import { randomInt } from 'node:crypto'

// No look-alike characters (0/O, 1/l/I), so a password read out loud or copied by
// hand still works.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const DIGITS = '23456789'
const SYMBOLS = '@#$%&*?!'
const ALL = UPPER + LOWER + DIGITS + SYMBOLS

export const TEMPORARY_PASSWORD_LENGTH = 14

function pick(chars: string) {
  return chars[randomInt(chars.length)]!
}

// A random password with at least one upper-case letter, lower-case letter, digit
// and symbol. It is shown to the super admin once and never stored by the backend.
export function generateTemporaryPassword(length = TEMPORARY_PASSWORD_LENGTH): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < length) chars.push(pick(ALL))
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1)
    ;[chars[index], chars[swap]] = [chars[swap]!, chars[index]!]
  }
  return chars.join('')
}
