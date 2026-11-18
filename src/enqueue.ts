// CLI: `npm run scrape:now [-- <country>]` queues a crawl for the running worker.
import { initDb, sequelize, enqueueCrawl } from './db.js';

const country = process.argv[2]?.toLowerCase() || null;
if (country && !/^[a-z]{2}$/.test(country)) {
    console.error('Country must be a 2-letter code.');
    process.exit(1);
}

await initDb();
const job = await enqueueCrawl('cli', country);
console.log(job ? `Queued crawl job #${job.id}.` : 'A crawl is already pending or running.');
await sequelize.close();
process.exit(job ? 0 : 2);
