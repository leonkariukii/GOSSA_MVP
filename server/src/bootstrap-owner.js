import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { hash } from '@node-rs/argon2';
import { ensureStore, saveStore } from './store.js';

function envValue(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

const rl = readline.createInterface({ input, output });

async function readPrompt(label, fallback, isSecret = false) {
  const answer = await rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `);
  const value = answer.trim();
  if (value) {
    return value;
  }

  if (fallback) {
    return fallback;
  }

  if (isSecret) {
    console.error(`${label} is required.`);
    process.exit(1);
  }

  return value;
}

async function main() {
  const store = await ensureStore();

  if (store.owner) {
    console.log('Owner already exists; bootstrap skipped.');
    rl.close();
    return;
  }

  const garageName = process.env.GOSSA_GARAGE_NAME?.trim() || await readPrompt('Garage name', 'Northside Garage');
  const timeZone = process.env.GOSSA_GARAGE_TIMEZONE?.trim() || await readPrompt('Garage time zone', 'UTC');
  const ownerName = process.env.GOSSA_OWNER_NAME?.trim() || await readPrompt('Owner name', 'Owner User');
  const ownerEmail = (process.env.GOSSA_OWNER_EMAIL?.trim() || await readPrompt('Owner email', 'owner@example.com')).toLowerCase();
  const password = process.env.GOSSA_OWNER_PASSWORD?.trim() || await readPrompt('Owner password', '', true);

  const supportedZones = Intl.supportedValuesOf('timeZone');
  if (timeZone !== 'UTC' && !supportedZones.includes(timeZone)) {
    console.error('Invalid time_zone. Use a valid IANA time zone name.');
    process.exit(1);
  }

  if (password.length < 12 || password.length > 128) {
    console.error('Password must be 12-128 characters long.');
    process.exit(1);
  }

  store.garage = {
    ...store.garage,
    name: garageName.trim(),
    time_zone: timeZone,
    updated_at: new Date().toISOString(),
    version: (store.garage?.version ?? 1),
  };

  store.owner = {
    id: `owner_${Date.now()}`,
    garage_id: store.garage.id,
    name: ownerName.trim(),
    email: ownerEmail,
    password_hash: await hash(password),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: 1,
  };

  await saveStore(store);
  console.log(`Bootstrap complete. Garage "${garageName}" and owner "${ownerEmail}" are ready.`);
  rl.close();
}

main().catch((error) => {
  console.error('Bootstrap failed.', error);
  process.exit(1);
});
