import { loadConfig } from '@flowkit-demo/domain';
import { withMigrationClient } from '../src/client';
const config = loadConfig();
if (!config.FLOWKIT_DEMO_ALLOW_SEED || !['development', 'test'].includes(config.NODE_ENV)) throw new Error('Demo seed requires development/test and FLOWKIT_DEMO_ALLOW_SEED=true');
await withMigrationClient(async (client) => {
  await client`
    INSERT INTO roles (role_key, readonly) VALUES
      ('employee', false), ('manager', false), ('hr', false), ('readonly_auditor', true)
    ON CONFLICT (role_key) DO UPDATE SET readonly = EXCLUDED.readonly
  `;
  await client`
    INSERT INTO users (id, email, role_key) VALUES
      ('employee-1', 'employee-1@example.test', 'employee'),
      ('manager-1', 'manager-1@example.test', 'manager'),
      ('manager-2', 'manager-2@example.test', 'manager'),
      ('hr-1', 'hr-1@example.test', 'hr'),
      ('auditor-1', 'auditor-1@example.test', 'readonly_auditor')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role_key = EXCLUDED.role_key
  `;
});
process.stdout.write('Seeded identities: employee-1, manager-1, manager-2, hr-1, auditor-1.\n');
