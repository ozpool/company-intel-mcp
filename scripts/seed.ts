import { loadConfig } from '../src/config.js';
import { openDatabase, transaction } from '../src/db/database.js';
import { generateSeedData } from './seed-data.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const { companies, contacts } = generateSeedData();

// Replaces the sample data but keeps API keys and OAuth grants, so connected clients keep working.
transaction(db, () => {
  db.exec('DELETE FROM exports; DELETE FROM enrichments; DELETE FROM contacts; DELETE FROM companies;');
  const insertCompany = db.prepare(
    `INSERT INTO companies (id, name, domain, website, industry, country, city, employees, founded_year, description, tags)
     VALUES (:id, :name, :domain, :website, :industry, :country, :city, :employees, :founded_year, :description, :tags)`,
  );
  const insertContact = db.prepare(
    `INSERT INTO contacts (id, company_id, first_name, last_name, title, department, seniority, location)
     VALUES (:id, :company_id, :first_name, :last_name, :title, :department, :seniority, :location)`,
  );
  for (const c of companies) insertCompany.run(c);
  for (const c of contacts) insertContact.run(c);
});

console.log(`Seeded ${companies.length} companies and ${contacts.length} contacts into ${config.databasePath}`);

const { keys } = db.prepare('SELECT COUNT(*) AS keys FROM api_keys WHERE revoked_at IS NULL').get() as { keys: number };
if (keys === 0) console.log('No API keys yet. Create one with: npm run create-key -- <name>');
db.close();
