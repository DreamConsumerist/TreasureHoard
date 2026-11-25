// Prompts for a password (twice, without echoing it) and prints its scrypt
// hash, ready to paste into the APP_PASSWORD_HASH environment variable.
//
// Usage: npm run hash-password
//
// The password is never passed as a command-line argument, so it doesn't end
// up in your shell history.

import { hashPassword } from '../lib/auth/password.ts'

const MIN_LENGTH = 12

// Reads a line without echoing it. "Raw mode" hands us each keystroke
// directly instead of letting the terminal print it, so nothing is shown.
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin
  process.stdout.write(question)
  return new Promise((resolve) => {
    let input = ''
    const finish = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stdout.write('\n')
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish()
          resolve(input)
          return
        }
        if (char === '\u0003') {
          // Ctrl+C
          finish()
          process.exit(130)
        }
        if (char === '\u007f' || char === '\b') {
          // Backspace
          input = Array.from(input).slice(0, -1).join('')
          continue
        }
        input += char
      }
    }
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.on('data', onData)
    stdin.resume()
  })
}

if (!process.stdin.isTTY) {
  console.error('Run this in an interactive terminal (it reads hidden input).')
  process.exit(1)
}

console.log('Typing is hidden: nothing will appear as you type.')
const password = await promptHidden('New password: ')
if (password.length < MIN_LENGTH) {
  console.error(`Password must be at least ${MIN_LENGTH} characters.`)
  process.exit(1)
}
if ((await promptHidden('Confirm password: ')) !== password) {
  console.error('Passwords did not match.')
  process.exit(1)
}

console.log('\nAPP_PASSWORD_HASH value:\n')
console.log(await hashPassword(password))
