import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { parseEnv } from '../config/env.js';
import { createDb } from './client.js';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, client } = createDb(databaseUrl, 1);
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)),
    });
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = parseEnv();
  await runMigrations(env.DATABASE_URL);
  console.log('Migrations applied');
}
