import gplay from 'google-play-scraper';
import TelegramBot from 'node-telegram-bot-api';
import { Op } from 'sequelize';
import { config } from './config.js';
import { sequelize, CurrentRank, RankHistory, DailySummary, TrackedCountry } from './db.js';

const bot = config.telegramToken ? new TelegramBot(config.telegramToken) : null;

const CATEGORIES = [
    'GAME', 'GAME_ACTION', 'GAME_ADVENTURE', 'GAME_ARCADE', 'GAME_BOARD',
    'GAME_CARD', 'GAME_CASINO', 'GAME_CASUAL', 'GAME_EDUCATIONAL', 'GAME_MUSIC',
    'GAME_PUZZLE', 'GAME_RACING', 'GAME_ROLE_PLAYING', 'GAME_SIMULATION',
    'GAME_SPORTS', 'GAME_STRATEGY', 'GAME_TRIVIA', 'GAME_WORD'
] as const;

// The package's typings declare these as types only, but they are plain objects at runtime
const collectionMap = gplay.collection as unknown as Record<string, typeof gplay.collection>;
const categoryMap = gplay.category as unknown as Record<string, typeof gplay.category>;

const COLLECTIONS = ['TOP_FREE', 'TOP_PAID', 'GROSSING'].map(name => ({ name, value: collectionMap[name] }));

interface SnapshotApp {
    rank: number;
    title: string;
    icon: string;
    score: number | null;
    url: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function escapeHTML(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegramAlert(message: string): Promise<void> {
    if (!bot || !config.telegramChatId) return;
    try {
        await bot.sendMessage(config.telegramChatId, message, { parse_mode: 'HTML' });
    } catch (err) {
        console.error('Telegram notification failed:', (err as Error).message);
    }
}

/** Atomically replace one segment's current ranks and upsert today's history. */
async function saveSegment(segment: string, apps: Map<string, SnapshotApp>, today: Date): Promise<void> {
    const current = [...apps].map(([app_id, a]) => ({
        segment, app_id, title: a.title, icon: a.icon, current_rank: a.rank,
        score: a.score, url: a.url, last_updated: today
    }));
    const history = [...apps].map(([app_id, a]) => ({
        segment, app_id, date: today, title: a.title, rank: a.rank, score: a.score, url: a.url
    }));

    await sequelize.transaction(async (transaction) => {
        await CurrentRank.destroy({ where: { segment }, transaction });
        await CurrentRank.bulkCreate(current, { transaction });
        await RankHistory.bulkCreate(history, {
            transaction,
            updateOnDuplicate: ['title', 'rank', 'score', 'url']
        });
    });
}

/**
 * Crawl all enabled countries (or just `onlyCountry`). Called by the scraper worker only,
 * which guarantees a single crawl at a time.
 */
export async function runScrapingPipeline(onlyCountry: string | null = null): Promise<string> {
    console.log(`[${new Date().toISOString()}] Scrape started${onlyCountry ? ` (country=${onlyCountry})` : ''}`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const countries = onlyCountry
        ? [onlyCountry]
        : (await TrackedCountry.findAll({ where: { enabled: true }, order: [['code', 'ASC']] })).map(c => c.code);

    let dropped = 0;
    let returned = 0;
    let failedSegments = 0;
    const alerts: string[] = [];

    for (const country of countries) {
        for (const coll of COLLECTIONS) {
            for (const cat of CATEGORIES) {
                const segment = `${country}_${coll.name}_${cat}`;
                try {
                    console.log(`[-] ${segment}`);

                    // list() already returns score and url: no per-app gplay.app() request needed
                    const liveApps = await gplay.list({
                        collection: coll.value,
                        category: categoryMap[cat],
                        num: 100,
                        country,
                        lang: 'en'
                    });

                    const snapshot = new Map<string, SnapshotApp>();
                    liveApps.forEach((app, index) => {
                        const parsed = typeof app.score === 'number' ? app.score : parseFloat(app.scoreText);
                        snapshot.set(app.appId, {
                            rank: index + 1,
                            title: app.title,
                            icon: app.icon,
                            score: Number.isFinite(parsed) ? parsed : null,
                            url: app.url || `https://play.google.com/store/apps/details?id=${app.appId}&hl=en&gl=${country.toUpperCase()}`
                        });
                    });

                    // Empty result is almost certainly a scrape failure: keep the previous data
                    if (snapshot.size === 0) {
                        console.error(`Empty result for ${segment}, keeping previous data.`);
                        failedSegments++;
                        continue;
                    }

                    const previous = new Map(
                        (await CurrentRank.findAll({ where: { segment }, attributes: ['app_id', 'title'] }))
                            .map(r => [r.app_id, r.title ?? ''] as [string, string])
                    );

                    const where = `${coll.name} -> ${cat} (${country.toUpperCase()})`;
                    const segDropped: string[] = [];
                    const segReturned: string[] = [];

                    for (const [appId, title] of previous) {
                        if (!snapshot.has(appId)) {
                            segDropped.push(`❌ <b>${escapeHTML(title)}</b> (<code>${appId}</code>) dropped out of ${where}`);
                            dropped++;
                        }
                    }

                    // New apps that were seen in this segment before (one query per segment)
                    const newIds = [...snapshot.keys()].filter(id => !previous.has(id));
                    if (newIds.length > 0) {
                        const seen = await RankHistory.findAll({
                            attributes: ['app_id'],
                            where: { segment, app_id: { [Op.in]: newIds } },
                            group: ['app_id']
                        });
                        for (const { app_id } of seen) {
                            const a = snapshot.get(app_id)!;
                            segReturned.push(`🔄 <b>${escapeHTML(a.title)}</b> (<code>${app_id}</code>) returned to ${where} at Rank #${a.rank}`);
                            returned++;
                        }
                    }

                    if (segDropped.length) alerts.push(segDropped.join('\n'));
                    if (segReturned.length) alerts.push(segReturned.join('\n'));

                    await saveSegment(segment, snapshot, today);
                    await sleep(1000); // be gentle with Google Play
                } catch (err) {
                    failedSegments++;
                    console.error(`Error scraping ${segment}:`, (err as Error).message);
                }
            }
        }
    }

    if (alerts.length > 0) {
        const more = alerts.length > 15 ? '\n<i>...and more metrics available via dashboard panel</i>' : '';
        await sendTelegramAlert(`<b>Daily Rank Status Report Update</b>\n\n${alerts.slice(0, 15).join('\n')}${more}`);
    }

    // A single-country re-crawl adds to the day's totals; a full crawl replaces them
    const existing = await DailySummary.findOne({ where: { date: today } });
    if (onlyCountry && existing) {
        await existing.update({
            dropped_out_count: existing.dropped_out_count + dropped,
            returned_count: existing.returned_count + returned
        });
    } else {
        await DailySummary.upsert({ date: today, dropped_out_count: dropped, returned_count: returned });
    }

    const cutoff = new Date(Date.now() - config.historyRetentionDays * 86_400_000);
    const purged = await RankHistory.destroy({ where: { date: { [Op.lt]: cutoff } } });

    const summary = `${countries.length} countries, dropped=${dropped}, returned=${returned}, failed segments=${failedSegments}, purged=${purged}`;
    console.log(`[${new Date().toISOString()}] Scrape finished: ${summary}`);
    return summary;
}
