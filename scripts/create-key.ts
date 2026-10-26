import { createAccount, findAccountByEmail } from '../src/auth/accounts.js';
import { createApiKey } from '../src/auth/apiKeys.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { AppError } from '../src/errors.js';

// Usage: npm run create-key -- <email> [key name]
const email = process.argv[2]?.trim();
const keyName = process.argv[3]?.trim() || 'default';
if (!email) {
  console.error('Usage: npm run create-key -- <email> [key name]');
  process.exit(1);
}

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    console.error('No terminal to ask for a password. Set ACCOUNT_PASSWORD instead.');
    process.exit(1);
  }
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  let value = '';
  return new Promise((resolve) => {
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        value = ch === '\u007f' ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on('data', onData);
  });
}

const db = openDatabase(loadConfig().databasePath);
let account = findAccountByEmail(db, email);
if (!account) {
  // A new account also gets a password, so the same person can sign in through the browser (OAuth).
  const password = process.env.ACCOUNT_PASSWORD ?? (await promptHidden(`New account ${email}. Choose a password (8+ characters): `));
  try {
    account = createAccount(db, email, password);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
  console.log(`Created account ${account.email}.`);
}
const { key } = createApiKey(db, account.id, keyName);
console.log(`API key for ${account.email} (shown once, store it now):\n\n  ${key}\n`);
db.close();
