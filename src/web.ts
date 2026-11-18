import express, { type Request, type Response, type NextFunction } from 'express';
import { Op } from 'sequelize';
import { config } from './config.js';
import { initDb, sequelize, CurrentRank, RankHistory, DailySummary, TrackedCountry } from './db.js';
import { adminRouter } from './admin.js';
import { PLATFORMS, PLATFORM_LABELS, CATEGORIES, CATEGORY_LABELS, isPlatform, segmentKey } from './segments.js';
import { withOtherStore } from './crossstore.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// Private admin panel (HTTP Basic auth). Not part of the public static dir.
app.use('/admin', adminRouter);

app.use(express.static('public'));

app.get('/api/config', async (_req, res) => {
    const rows = await TrackedCountry.findAll({ where: { enabled: true }, order: [['code', 'ASC']] });
    res.json({
        countries: rows.map(c => c.code.toUpperCase()),
        platforms: PLATFORMS.map(id => ({
            id,
            label: PLATFORM_LABELS[id],
            categories: CATEGORIES[id].map(c => ({ id: c, label: CATEGORY_LABELS[c] }))
        }))
    });
});

app.get('/api/summary', async (_req, res) => {
    const latest = await DailySummary.findOne({ order: [['date', 'DESC']] });
    res.json(latest ?? { dropped_out_count: 0, returned_count: 0 });
});

app.get('/api/ranks', async (req, res) => {
    const { country, collection, category } = req.query;
    const platform = req.query.platform ?? 'android';
    if (!country || !collection || !category || !isPlatform(platform)) {
        res.status(400).json({ error: 'Missing or invalid query parameters.' });
        return;
    }
    const segment = segmentKey(platform, String(country), String(collection), String(category));
    const ranks = await CurrentRank.findAll({ where: { segment }, order: [['current_rank', 'ASC']] });
    res.json(await withOtherStore(ranks, platform, String(country).toLowerCase()));
});

app.get('/api/track/:appId', async (req, res) => {
    const segment = req.query.segment;
    if (typeof segment !== 'string' || !segment) {
        res.status(400).json({ error: 'Missing segment parameter.' });
        return;
    }
    const since = new Date(Date.now() - 30 * 86_400_000);
    res.json(await RankHistory.findAll({
        where: { segment, app_id: req.params.appId, date: { [Op.gte]: since } },
        order: [['date', 'ASC']]
    }));
});

// Express 5 forwards rejected async handlers here
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error.' });
});

await initDb();
const server = app.listen(config.port, config.host, () => {
    console.log(`Web server listening on ${config.host}:${config.port}`);
});

async function shutdown(): Promise<void> {
    server.close();
    await sequelize.close().catch(() => {});
    process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
