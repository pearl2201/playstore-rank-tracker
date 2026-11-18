// Standalone scraper worker: consumes the crawl_jobs queue one job at a time.
import cron from 'node-cron';
import { initDb, sequelize, enqueueCrawl, CrawlJob } from './db.js';
import { runScrapingPipeline } from './pipeline.js';
import { isPlatform } from './segments.js';

const POLL_MS = 10_000;
let busy = false;
let stopping = false;

async function processNextJob(): Promise<void> {
    if (busy || stopping) return;
    busy = true;
    try {
        const job = await CrawlJob.findOne({ where: { status: 'pending' }, order: [['id', 'ASC']] });
        if (!job) return;

        await job.update({ status: 'running', started_at: new Date() });
        try {
            const message = await runScrapingPipeline({ country: job.country, platform: isPlatform(job.platform) ? job.platform : null });
            await job.update({ status: 'done', finished_at: new Date(), message });
        } catch (err) {
            console.error('Scrape job failed:', err);
            await job.update({ status: 'failed', finished_at: new Date(), message: (err as Error).message });
        }
    } catch (err) {
        console.error('Worker loop error:', (err as Error).message);
    } finally {
        busy = false;
    }
}

async function main(): Promise<void> {
    await initDb();

    // Anything still 'running' belongs to a previous worker that died
    await CrawlJob.update(
        { status: 'failed', finished_at: new Date(), message: 'Interrupted by worker restart' },
        { where: { status: 'running' } }
    );

    // Nightly full crawl at 00:00 (skipped if a crawl is already queued/running)
    cron.schedule('0 0 * * *', () => {
        enqueueCrawl('cron').catch(err => console.error('Failed to enqueue nightly crawl:', err.message));
    });

    setInterval(() => void processNextJob(), POLL_MS);
    void processNextJob();
    console.log('Scraper worker started.');
}

async function shutdown(): Promise<void> {
    stopping = true;
    console.log('Shutting down scraper worker...');
    await sequelize.close().catch(() => {});
    process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

main().catch(err => {
    console.error('Fatal worker error:', err);
    process.exit(1);
});
