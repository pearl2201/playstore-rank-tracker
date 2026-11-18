// CLI: `npm run scrape:now [-- <country>]` queues a crawl for the running worker.
import { initDb, sequelize, enqueueCrawl } from './db.js';
import { isPlatform } from './segments.js';

// Usage: scrape:now [country] [android|ios]   (any order, both optional)
let country: string | null = null;
let platform: string | null = null;
for (const arg of process.argv.slice(2).map(a => a.toLowerCase())) {
    if (isPlatform(arg)) platform = arg;
    else if (/^[a-z]{2}$/.test(arg)) country = arg;
    else {
        console.error('Usage: npm run scrape:now -- [2-letter country] [android|ios]');
        process.exit(1);
    }
}

await initDb();
const job = await enqueueCrawl('cli', country, platform);
console.log(job ? `Queued crawl job #${job.id}.` : 'A crawl is already pending or running.');
await sequelize.close();
process.exit(job ? 0 : 2);
