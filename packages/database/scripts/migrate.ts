import { loadConfig } from '@flowkit-demo/domain';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withMigrationClient } from '../src/client';

const config = loadConfig();
const database = new URL(config.DATABASE_URL).pathname.slice(1);
if (!/^flowkit_demo(?:_test_)?/.test(database)) throw new Error(`Refusing migration for database ${database}`);
if (process.env.FLOWKIT_DEMO_MIGRATION_APPROVED !== 'true') throw new Error('Migration is guarded. Set FLOWKIT_DEMO_MIGRATION_APPROVED=true only after explicit approval. No migration was applied.');
const migrationDirectory = resolve(import.meta.dir, '../migrations');
const migrationFiles = (await readdir(migrationDirectory))
  .filter((file) => file.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right));
if (migrationFiles.length === 0) throw new Error('No demo migrations were found.');
await withMigrationClient(async (client) => {
  for (const file of migrationFiles) {
    await client.unsafe(await readFile(resolve(migrationDirectory, file), 'utf8'));
  }
});
process.stdout.write(`${migrationFiles.length} migration(s) applied to FlowKit database ${database}.\n`);
