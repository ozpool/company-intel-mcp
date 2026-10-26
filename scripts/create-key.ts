import { createApiKey } from '../src/auth/apiKeys.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';

const name = process.argv[2]?.trim() || 'default';
const db = openDatabase(loadConfig().databasePath);
const { account, key } = createApiKey(db, name);
console.log(`Created API key for account "${name}" (${account.id}). Shown once, store it now:\n\n  ${key}\n`);
db.close();
