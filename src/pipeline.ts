import TelegramBot from 'node-telegram-bot-api';
import { Op } from 'sequelize';
import { config } from './config.js';
import { sequelize, CurrentRank, RankHistory, DailySummary, TrackedCountry } from './db.js';
import { COLLECTIONS, CATEGORIES, PLATFORMS, PLATFORM_LABELS, segmentKey, type Platform } from './segments.js';
import { titleKey } from './match.js';
import { androidSource } from './sources/android.js';
import { iosSource } from './sources/ios.js';
import type { ChartApp, Source } from './sources/types.js';

const bot = config.telegramToken ? new TelegramBot(config.telegramToken) : null;

const SOURCES: Record<Platform, Source> = { android: androidSource, ios: iosSource };

interface SnapshotApp extends ChartApp {
    rank: number;
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
async function saveSegment(platform: Platform, segment: string, apps: Map<string, SnapshotApp>, today: Date): Promise<void> {
    const current = [...apps].map(([app_id, a]) => ({
        segment, app_id, title: a.title, icon: a.icon, current_rank: a.rank,
        score: a.score, url: a.url, last_updated: today,
        platform, bundle_id: a.bundleId, developer: a.developer, title_key: titleKey(a.title)
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

export interface CrawlScope {
    country?: string | null;   // null = all enabled countries
    platform?: Platform | null; // null = both stores
}

/**
 * Crawl Google Play and the App Store for all enabled countries (or a narrower scope).
 * Called by the scraper worker only, which guarantees a single crawl at a time.
 */
export async function runScrapingPipeline(scope: CrawlScope = {}): Promise<string> {
    const onlyCountry = scope.country ?? null;
    const onlyPlatform = scope.platform ?? null;
    console.log(`[${new Date().toISOString()}] Scrape started (country=${onlyCountry ?? 'all'}, platform=${onlyPlatform ?? 'all'})`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const countries = onlyCountry
        ? [onlyCountry]
        : (await TrackedCountry.findAll({ where: { enabled: true }, order: [['code', 'ASC']] })).map(c => c.code);
    const platforms = onlyPlatform ? [onlyPlatform] : PLATFORMS;

    let dropped = 0;
    let returned = 0;
    let failedSegments = 0;
    const alerts: string[] = [];

    for (const platform of platforms) {
        const source = SOURCES[platform];
        const label = PLATFORM_LABELS[platform];

        for (const country of countries) {
            for (const collection of COLLECTIONS) {
                for (const category of CATEGORIES[platform]) {
                    const segment = segmentKey(platform, country, collection, category);
                    try {
                        console.log(`[-] ${segment}`);

                        const chart = await source.fetchChart(country, collection, category);

                        // Empty result is almost certainly a scrape failure: keep the previous data
                        if (chart.length === 0) {
                            console.error(`Empty result for ${segment}, keeping previous data.`);
                            failedSegments++;
                            await sleep(source.delayMs);
                            continue;
                        }

                        const snapshot = new Map<string, SnapshotApp>();
                        chart.forEach((app, index) => {
                            if (!snapshot.has(app.appId)) snapshot.set(app.appId, { ...app, rank: index + 1 });
                        });

                        const previous = new Map(
                            (await CurrentRank.findAll({ where: { segment }, attributes: ['app_id', 'title'] }))
                                .map(r => [r.app_id, r.title ?? ''] as [string, string])
                        );

                        const where = `${collection} -> ${category} (${country.toUpperCase()})`;
                        const segDropped: string[] = [];
                        const segReturned: string[] = [];

                        for (const [appId, title] of previous) {
                            if (!snapshot.has(appId)) {
                                segDropped.push(`❌ [${label}] <b>${escapeHTML(title)}</b> (<code>${appId}</code>) dropped out of ${where}`);
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
                                segReturned.push(`🔄 [${label}] <b>${escapeHTML(a.title)}</b> (<code>${app_id}</code>) returned to ${where} at Rank #${a.rank}`);
                                returned++;
                            }
                        }

                        if (segDropped.length) alerts.push(segDropped.join('\n'));
                        if (segReturned.length) alerts.push(segReturned.join('\n'));

                        await saveSegment(platform, segment, snapshot, today);
                        await sleep(source.delayMs); // be gentle with the stores
                    } catch (err) {
                        failedSegments++;
                        console.error(`Error scraping ${segment}:`, (err as Error).message);
                        await sleep(source.delayMs);
                    }
                }
            }
        }
    }

    if (alerts.length > 0) {
        const more = alerts.length > 15 ? '\n<i>...and more metrics available via dashboard panel</i>' : '';
        await sendTelegramAlert(`<b>Daily Rank Status Report Update</b>\n\n${alerts.slice(0, 15).join('\n')}${more}`);
    }

    // A partial re-crawl adds to the day's totals; a full crawl replaces them
    const partial = Boolean(onlyCountry || onlyPlatform);
    const existing = await DailySummary.findOne({ where: { date: today } });
    if (partial && existing) {
        await existing.update({
            dropped_out_count: existing.dropped_out_count + dropped,
            returned_count: existing.returned_count + returned
        });
    } else {
        await DailySummary.upsert({ date: today, dropped_out_count: dropped, returned_count: returned });
    }

    const cutoff = new Date(Date.now() - config.historyRetentionDays * 86_400_000);
    const purged = await RankHistory.destroy({ where: { date: { [Op.lt]: cutoff } } });

    const summary = `${platforms.join('+')}, ${countries.length} countries, dropped=${dropped}, returned=${returned}, failed segments=${failedSegments}, purged=${purged}`;
    console.log(`[${new Date().toISOString()}] Scrape finished: ${summary}`);
    return summary;
}
