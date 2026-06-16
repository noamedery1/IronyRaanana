// Publish a club's live Google Sheet into the local DB. Usage: npm run db:publish [slug]
import 'dotenv/config';
import { publishClub } from '../server/publish.js';

const slug = process.argv[2] || 'raanana';
publishClub(slug, { publishedBy: 'cli' })
    .then((r) => { console.log('Published:', JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((e) => { console.error('Publish failed:', e.message); process.exit(1); });
