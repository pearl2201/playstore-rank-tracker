// server.js
import express from 'express';
import dotenv from 'dotenv';
import { db } from './db.js';
import { runScrapingPipeline } from './cron.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

/**
 * Expose server runtime environment parameters to configure UI components dynamically
 */
app.get('/api/config', (req, res) => {
    const countries = (process.env.TRACKED_COUNTRIES || 'us').split(',').map(c => c.trim().toUpperCase());
    res.json({ countries });
});

app.get('/api/summary', async (req, res) => {
    try {
        const summaries = await db.daily_summaries.find({}).sort({ date: -1 }).limit(1);
        res.json(summaries[0] || { dropped_out_count: 0, returned_count: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Filter ranks dynamically matching request segment specifications
 */
app.get('/api/ranks', async (req, res) => {
    try {
        const { country, collection, category } = req.query;
        if (!country || !collection || !category) {
            return res.status(400).json({ error: "Missing required query segment parameters." });
        }
        
        const trackingKey = `${country.toLowerCase()}_${collection}_${category}`;
        const ranks = await db.current_ranks.find({ segment: trackingKey }).sort({ current_rank: 1 });
        res.json(ranks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Historical rank tracking timeline for a specific app within a segment
 */
app.get('/api/track/:appId', async (req, res) => {
    try {
        const { appId } = req.params;
        const { segment } = req.query;
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const history = await db.rank_history.find({
            app_id: appId,
            segment: segment,
            date: { $gte: thirtyDaysAgo }
        }).sort({ date: 1 });

        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/trigger-scrape', (req, res) => {
    runScrapingPipeline(); // Run asynchronously in background
    res.json({ message: "Global scrape job matrix loop execution started in background context." });
});

app.listen(PORT, () => {
    console.log(`Standalone Application executing on port ${PORT}`);
});