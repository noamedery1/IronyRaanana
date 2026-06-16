// Loads .env (so DATABASE_URL is set) then runs node-pg-migrate.
// Usage: node scripts/migrate.mjs [up|down]   (default: up)
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const dir = process.argv[2] || 'up';
const r = spawnSync('npx', ['node-pg-migrate', dir], {
    stdio: 'inherit',
    env: process.env,
    shell: true,
});
process.exit(r.status ?? 1);
