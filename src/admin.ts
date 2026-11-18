import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { TrackedCountry, CrawlJob, enqueueCrawl } from './db.js';

export const adminRouter = Router();

const sha = (v: string) => crypto.createHash('sha256').update(v).digest();
const safeEqual = (a: string, b: string) => crypto.timingSafeEqual(sha(a), sha(b));

// Naive per-IP brute-force limiter: 10 failures / 15 minutes
const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (!config.adminUser || !config.adminPassword) {
        res.status(503).send('Admin panel is disabled: set ADMIN_USER and ADMIN_PASSWORD.');
        return;
    }

    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rec = failures.get(ip);
    if (rec && rec.resetAt > now && rec.count >= MAX_FAILURES) {
        res.status(429).send('Too many failed attempts. Try again later.');
        return;
    }

    const header = req.get('authorization') || '';
    let ok = false;
    if (header.startsWith('Basic ')) {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        if (idx >= 0) {
            const userOk = safeEqual(decoded.slice(0, idx), config.adminUser);
            const passOk = safeEqual(decoded.slice(idx + 1), config.adminPassword);
            ok = userOk && passOk;
        }
    }

    if (!ok) {
        const cur = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + WINDOW_MS };
        cur.count++;
        failures.set(ip, cur);
        res.set('WWW-Authenticate', 'Basic realm="Admin", charset="UTF-8"').status(401).send('Authentication required.');
        return;
    }
    failures.delete(ip);

    // CSRF guard: browsers auto-attach Basic credentials, so state-changing calls must carry
    // a custom header that cross-site pages cannot send without a (denied) CORS preflight.
    if (req.method !== 'GET' && req.get('x-requested-with') !== 'admin-panel') {
        res.status(403).json({ error: 'Missing X-Requested-With header.' });
        return;
    }
    next();
}

adminRouter.use(requireAdmin);

adminRouter.get('/', (_req, res) => {
    res.sendFile(path.resolve('admin', 'admin.html'));
});

const CODE_RE = /^[a-z]{2}$/;

adminRouter.get('/api/countries', async (_req, res) => {
    res.json(await TrackedCountry.findAll({ order: [['code', 'ASC']] }));
});

adminRouter.post('/api/countries', async (req, res) => {
    const code = String(req.body?.code ?? '').trim().toLowerCase();
    const name = req.body?.name ? String(req.body.name).trim().slice(0, 100) : null;
    if (!CODE_RE.test(code)) {
        res.status(400).json({ error: 'code must be a 2-letter country code (e.g. us, gb).' });
        return;
    }
    const [country, created] = await TrackedCountry.findOrCreate({ where: { code }, defaults: { code, name } });
    res.status(created ? 201 : 409).json(created ? country : { error: 'Country already tracked.' });
});

adminRouter.patch('/api/countries/:code', async (req, res) => {
    const country = await TrackedCountry.findByPk(req.params.code.toLowerCase());
    if (!country) {
        res.status(404).json({ error: 'Not found.' });
        return;
    }
    if (typeof req.body?.enabled === 'boolean') country.enabled = req.body.enabled;
    if (typeof req.body?.name === 'string') country.name = req.body.name.trim().slice(0, 100) || null;
    await country.save();
    res.json(country);
});

adminRouter.delete('/api/countries/:code', async (req, res) => {
    const deleted = await TrackedCountry.destroy({ where: { code: req.params.code.toLowerCase() } });
    res.status(deleted ? 200 : 404).json({ deleted });
});

adminRouter.get('/api/jobs', async (_req, res) => {
    res.json(await CrawlJob.findAll({ order: [['id', 'DESC']], limit: 20 }));
});

// Queue a re-crawl. Body: { country?: 'us' } (omit for all enabled countries)
adminRouter.post('/api/jobs', async (req, res) => {
    const country = req.body?.country ? String(req.body.country).trim().toLowerCase() : null;
    if (country && !(await TrackedCountry.findByPk(country))) {
        res.status(400).json({ error: 'Country is not in the tracked list.' });
        return;
    }
    const job = await enqueueCrawl('admin', country);
    if (!job) {
        res.status(409).json({ error: 'A crawl is already pending or running.' });
        return;
    }
    res.status(201).json(job);
});
