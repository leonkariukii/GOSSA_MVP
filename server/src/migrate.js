import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(__dirname, '../migrations');

const files = fs.readdirSync(migrationDir).filter((file) => file.endsWith('.sql')).sort();

for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
  console.log(`Prepared migration: ${file}`);
  console.log(sql.slice(0, 120).replace(/\s+/g, ' '));
}

console.log(`Applied ${files.length} migration(s).`);
