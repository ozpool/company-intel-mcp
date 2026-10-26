import { Faker, en } from '@faker-js/faker';

const LOCATIONS: Record<string, string[]> = {
  Australia: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide'],
  'United States': ['San Francisco', 'New York', 'Austin', 'Seattle', 'Boston'],
  'United Kingdom': ['London', 'Manchester', 'Edinburgh'],
  India: ['Bengaluru', 'Pune', 'Hyderabad'],
  Singapore: ['Singapore'],
  Germany: ['Berlin', 'Munich'],
  Canada: ['Toronto', 'Vancouver'],
  'New Zealand': ['Auckland', 'Wellington'],
};
// Australia is weighted up so country filters have plenty to work with.
const COUNTRY_WEIGHTS: [string, number][] = [
  ['Australia', 30], ['United States', 20], ['United Kingdom', 12], ['India', 10],
  ['Singapore', 8], ['Germany', 7], ['Canada', 7], ['New Zealand', 6],
];
const PINNED_AU_AI_COMPANIES = 4;

type IndustryProfile = { industry: string; tags: string[]; products: string[]; customers: string[] };

const INDUSTRIES: IndustryProfile[] = [
  {
    industry: 'Artificial Intelligence',
    tags: ['ai', 'machine learning', 'llm'],
    products: ['an AI platform that automates document review', 'machine learning models that forecast demand',
      'LLM-powered agents for customer support', 'computer vision for quality inspection', 'an AI copilot for analysts'],
    customers: ['enterprise teams', 'insurers', 'manufacturers', 'retailers', 'legal firms'],
  },
  {
    industry: 'Software',
    tags: ['saas', 'b2b'],
    products: ['workflow automation software', 'a sales intelligence platform', 'project management software',
      'an AI-assisted CRM', 'B2B data and prospecting tools'],
    customers: ['mid-market companies', 'sales teams', 'agencies', 'professional services firms'],
  },
  {
    industry: 'Fintech',
    tags: ['payments', 'finance'],
    products: ['AI-driven fraud detection', 'a payments API', 'automated bookkeeping', 'a lending platform',
      'real-time treasury tools'],
    customers: ['small businesses', 'online merchants', 'banks', 'CFOs'],
  },
  {
    industry: 'Cybersecurity',
    tags: ['security', 'compliance'],
    products: ['threat detection using machine learning', 'identity and access management', 'cloud security posture tools',
      'automated compliance audits', 'phishing simulation'],
    customers: ['enterprises', 'government agencies', 'healthcare providers', 'fintechs'],
  },
  {
    industry: 'Healthtech',
    tags: ['health', 'medical'],
    products: ['AI diagnostics for radiology', 'telehealth software', 'patient scheduling tools', 'clinical trial analytics'],
    customers: ['hospitals', 'clinics', 'pharma companies', 'aged care providers'],
  },
  {
    industry: 'E-commerce',
    tags: ['retail', 'marketplace'],
    products: ['a headless commerce platform', 'AI product recommendations', 'returns management', 'a B2B marketplace'],
    customers: ['online brands', 'retailers', 'wholesalers'],
  },
  {
    industry: 'Logistics',
    tags: ['supply chain', 'freight'],
    products: ['route optimisation software', 'warehouse robotics', 'freight visibility tools', 'last-mile delivery software'],
    customers: ['3PLs', 'retailers', 'manufacturers', 'couriers'],
  },
  {
    industry: 'Climate Tech',
    tags: ['sustainability', 'energy'],
    products: ['carbon accounting software', 'battery analytics', 'grid optimisation using AI', 'EV charging management'],
    customers: ['utilities', 'property owners', 'fleet operators', 'enterprises'],
  },
  {
    industry: 'EdTech',
    tags: ['education', 'learning'],
    products: ['an adaptive learning platform', 'AI tutoring', 'a learning management system', 'skills assessment tools'],
    customers: ['universities', 'schools', 'corporate L&D teams'],
  },
  {
    industry: 'Developer Tools',
    tags: ['devtools', 'cloud', 'open source'],
    products: ['an observability platform', 'CI/CD pipelines', 'an API gateway', 'AI code review', 'feature flag tooling'],
    customers: ['engineering teams', 'platform teams', 'startups'],
  },
  {
    industry: 'Marketing Technology',
    tags: ['marketing', 'adtech'],
    products: ['customer data platform', 'AI-generated ad creative', 'email automation', 'attribution analytics'],
    customers: ['marketers', 'agencies', 'consumer brands'],
  },
  {
    industry: 'Data & Analytics',
    tags: ['data', 'analytics', 'bi'],
    products: ['a cloud data warehouse', 'self-serve BI dashboards', 'data quality monitoring', 'predictive analytics with machine learning'],
    customers: ['data teams', 'finance teams', 'enterprises'],
  },
];

type Role = { title: string; department: string; seniority: string };
const ROLES: Role[] = [
  { title: 'Software Engineer', department: 'Engineering', seniority: 'Mid' },
  { title: 'Senior Software Engineer', department: 'Engineering', seniority: 'Senior' },
  { title: 'Staff Engineer', department: 'Engineering', seniority: 'Senior' },
  { title: 'Engineering Manager', department: 'Engineering', seniority: 'Manager' },
  { title: 'VP of Engineering', department: 'Engineering', seniority: 'VP' },
  { title: 'Machine Learning Engineer', department: 'Data', seniority: 'Mid' },
  { title: 'Data Scientist', department: 'Data', seniority: 'Mid' },
  { title: 'Head of Data', department: 'Data', seniority: 'Director' },
  { title: 'Product Manager', department: 'Product', seniority: 'Mid' },
  { title: 'Head of Product', department: 'Product', seniority: 'Director' },
  { title: 'Account Executive', department: 'Sales', seniority: 'Mid' },
  { title: 'Sales Director', department: 'Sales', seniority: 'Director' },
  { title: 'VP of Sales', department: 'Sales', seniority: 'VP' },
  { title: 'Marketing Manager', department: 'Marketing', seniority: 'Manager' },
  { title: 'Head of Growth', department: 'Marketing', seniority: 'Director' },
  { title: 'Operations Manager', department: 'Operations', seniority: 'Manager' },
  { title: 'Customer Success Manager', department: 'Customer Success', seniority: 'Mid' },
  { title: 'Finance Manager', department: 'Finance', seniority: 'Manager' },
];
const FOUNDERS: Role[] = [
  { title: 'Chief Executive Officer', department: 'Executive', seniority: 'C-Level' },
  { title: 'Chief Technology Officer', department: 'Executive', seniority: 'C-Level' },
];

export type SeedCompany = {
  id: string; name: string; domain: string; website: string; industry: string; country: string; city: string;
  employees: number; founded_year: number; description: string; tags: string;
};
export type SeedContact = {
  id: string; company_id: string; first_name: string; last_name: string; title: string; department: string;
  seniority: string; location: string;
};

const NAME_ROOTS = [
  'Acacia', 'Amber', 'Apex', 'Aster', 'Atlas', 'Beacon', 'Birch', 'Bluegum', 'Cedar', 'Cobalt', 'Coral', 'Delta',
  'Ember', 'Fern', 'Flint', 'Granite', 'Harbour', 'Helix', 'Indigo', 'Juniper', 'Kestrel', 'Lumen', 'Maple', 'Meridian',
  'Nimbus', 'Northwind', 'Opal', 'Orbit', 'Pinnacle', 'Quartz', 'Riverstone', 'Saltbush', 'Sierra', 'Summit', 'Tidal',
  'Vertex', 'Wattle', 'Willow', 'Zephyr', 'Lyre', 'Magpie', 'Banksia', 'Halcyon', 'Ironbark',
];
// Suffixes per industry keep names believable ("Cedar AI" should not be an ad-tech firm).
const NAME_SUFFIXES: Record<string, string[]> = {
  'Artificial Intelligence': [' AI', ' Labs', ' Intelligence'],
  Software: [' Software', 'ly', ' Works'],
  Fintech: [' Pay', ' Finance', ' Ledger'],
  Cybersecurity: [' Security', ' Shield', ' Sentinel'],
  Healthtech: [' Health', ' Care', ' Medical'],
  'E-commerce': [' Commerce', ' Market', ' Shop'],
  Logistics: [' Logistics', ' Freight', ' Supply'],
  'Climate Tech': [' Energy', ' Climate', ' Grid'],
  EdTech: [' Learning', ' Academy', ' Edu'],
  'Developer Tools': [' Cloud', ' Dev', 'io'],
  'Marketing Technology': [' Media', ' Growth', ' Marketing'],
  'Data & Analytics': [' Analytics', ' Data', ' Insights'],
};

const slugify = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '').slice(0, 30);

export function generateSeedData(companyCount = 60): { companies: SeedCompany[]; contacts: SeedContact[] } {
  // Fixed seed, fresh instance per call: every call produces the same companies and contacts,
  // so ids in docs and tests stay valid even when one process seeds several databases.
  const faker = new Faker({ locale: [en], seed: 20261023 });
  const companies: SeedCompany[] = [];
  const contacts: SeedContact[] = [];
  const usedDomains = new Set<string>();
  let pinnedAiCount = 0;

  for (let i = 1; i <= companyCount; i++) {
    const profile = INDUSTRIES[(i - 1) % INDUSTRIES.length]!;
    const drawn = faker.helpers.weightedArrayElement(COUNTRY_WEIGHTS.map(([value, weight]) => ({ value, weight })));
    // The brief's example query is "AI companies" in Australia, so most AI companies are pinned there.
    // One is left to the draw so the country filter visibly changes the answer. The draw still runs
    // for pinned companies to keep the random sequence, and so every later id and name, unchanged.
    const pinned = profile.industry === 'Artificial Intelligence' && pinnedAiCount < PINNED_AU_AI_COMPANIES;
    if (pinned) pinnedAiCount++;
    const country = pinned ? 'Australia' : drawn;
    const city = faker.helpers.arrayElement(LOCATIONS[country]!);

    let name: string;
    let domain: string;
    do {
      name = `${faker.helpers.arrayElement(NAME_ROOTS)}${faker.helpers.arrayElement(NAME_SUFFIXES[profile.industry]!)}`;
      // .example is reserved (RFC 2606): no seeded domain can belong to a real company.
      domain = `${slugify(name)}.example`;
    } while (usedDomains.has(domain));
    usedDomains.add(domain);

    // Log-uniform head count: mostly startups, a few large companies.
    const employees = Math.round(Math.exp(faker.number.float({ min: Math.log(8), max: Math.log(6000) })));
    const product = faker.helpers.arrayElement(profile.products);
    const customer = faker.helpers.arrayElement(profile.customers);
    const description =
      `${name} builds ${product} for ${customer}. Founded in ${city}, the team of ${employees} ` +
      `${faker.helpers.arrayElement(['serves customers across', 'is expanding across', 'works with clients in'])} ` +
      `${faker.helpers.arrayElement(['Asia-Pacific', 'North America', 'Europe', 'its home market', 'over 20 countries'])}.`;
    const extraTags = /\b(ai|machine learning|llm)\b/i.test(product) ? ['ai'] : [];

    const company: SeedCompany = {
      id: `cmp_${i}`,
      name,
      domain,
      website: `https://www.${domain}`,
      industry: profile.industry,
      country,
      city,
      employees,
      founded_year: faker.number.int({ min: 2005, max: 2024 }),
      description,
      tags: [...new Set([...profile.tags, ...extraTags])].join(','),
    };
    companies.push(company);

    const staff = [faker.helpers.arrayElement(FOUNDERS), ...faker.helpers.arrayElements(ROLES, { min: 3, max: 6 })];
    for (const role of staff) {
      contacts.push({
        id: `cnt_${contacts.length + 1}`,
        company_id: company.id,
        first_name: faker.person.firstName(),
        last_name: faker.person.lastName(),
        title: role.title,
        department: role.department,
        seniority: role.seniority,
        location: `${city}, ${country}`,
      });
    }
  }
  return { companies, contacts };
}
