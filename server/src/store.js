import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
const storeFile = path.join(dataDir, 'store.json');

export function createDefaultGarage() {
  return {
    id: 'garage_01',
    name: 'Northside Garage',
    time_zone: 'UTC',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: 1,
  };
}

export async function ensureStore() {
  await mkdir(dataDir, { recursive: true });

  try {
    const content = await readFile(storeFile, 'utf8');
    if (!content.trim()) {
      const empty = {
        garage: createDefaultGarage(),
        owner: null,
        sessions: [],
        mechanics: [],
        jobs: [],
        jobHistory: [],
        nextJobSequence: {},
      };
      await writeFile(storeFile, JSON.stringify(empty, null, 2));
      return empty;
    }

    const parsed = JSON.parse(content);
    parsed.garage ??= createDefaultGarage();
    parsed.owner ??= null;
    parsed.sessions ??= [];
    parsed.mechanics ??= [];
    parsed.jobs ??= [];
    parsed.jobHistory ??= [];
    parsed.nextJobSequence ??= {};
    return parsed;
  } catch {
    const fresh = {
      garage: createDefaultGarage(),
      owner: null,
      sessions: [],
      mechanics: [],
      jobs: [],
      jobHistory: [],
      nextJobSequence: {},
    };
    await writeFile(storeFile, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

export async function saveStore(store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(storeFile, JSON.stringify(store, null, 2));
}
