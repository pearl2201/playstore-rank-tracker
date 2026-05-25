import gplay from 'google-play-scraper';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { db } from './db.js';

dotenv.config();

const botToken = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const bot = botToken ? new TelegramBot(botToken) : null;

// Target options mapping requested
const CATEGORIES = [
    'GAME', 'GAME_ACTION', 'GAME_ADVENTURE', 'GAME_ARCADE', 'GAME_BOARD',
    'GAME_CARD', 'GAME_CASINO', 'GAME_CASUAL', 'GAME_EDUCATIONAL', 'GAME_MUSIC',
    'GAME_PUZZLE', 'GAME_RACING', 'GAME_ROLE_PLAYING', 'GAME_SIMULATION',
    'GAME_SPORTS', 'GAME_STRATEGY', 'GAME_TRIVIA', 'GAME_WORD'
];

const COLLECTIONS = [
    { name: 'TOP_FREE', value: gplay.collection.TOP_FREE },
    { name: 'TOP_PAID', value: gplay.collection.TOP_PAID },
    { name: 'GROSSING', value: gplay.collection.GROSSING }
];

// Read country array from env configuration setup
const COUNTRIES = (process.env.TRACKED_COUNTRIES || 'us').split(',').map(c => c.trim().toLowerCase());

// 1. Update the helper function to use HTML parsing
async function sendTelegramAlert(message) {
    if (!bot || !chatId) return;
    try {
        // Switch parse_mode from 'Markdown' to 'HTML'
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
        console.error("Telegram notification failed:", err.message);
    }
}

// 2. Add a simple HTML escaping utility helper
function escapeHTML(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export async function runScrapingPipeline() {
    console.log(`[${new Date().toISOString()}] Initiating global multi-target scrape job...`);
    const todayDate = new Date();
    todayDate.setUTCHours(0, 0, 0, 0);

    let totalDroppedOut = 0;
    let totalReturnedBack = 0;
    let alertsLog = [];

    // Main multi-dimensional matrix iteration loop
    for (const country of COUNTRIES) {
        for (const coll of COLLECTIONS) {
            for (const cat of CATEGORIES) {
                try {
                    const trackingKey = `${country}_${coll.name}_${cat}`;

                    // Defensive checks: ensure collection and category exist before scraping
                    const collectionValue = coll && coll.value;
                    const categoryValue = gplay && gplay.category ? gplay.category[cat] : undefined;
                    if (typeof collectionValue === 'undefined') {
                        console.error(`Skipping scrape: unknown collection value for ${coll && coll.name}`);
                        continue;
                    }
                    if (typeof categoryValue === 'undefined') {
                        console.error(`Skipping scrape: unknown category '${cat}' for country ${country} and collection ${coll.name}`);
                        continue;
                    }

                    // 1. Live Google Play Chart Scrape execution
                    const liveApps = await gplay.list({
                        collection: collectionValue,
                        category: categoryValue,
                        num: 100,
                        country: country,
                        lang: 'en'
                    });

                    // Build lookup dictionary for the batch (include score and url)
                    const todaySnapshot = {};
                    for (let index = 0; index < liveApps.length; index++) {
                        const app = liveApps[index];
                        let score = undefined;
                        let url = `https://play.google.com/store/apps/details?id=${app.appId}&hl=en&gl=${country.toUpperCase()}`;
                        try {
                            const details = await gplay.app({ appId: app.appId, country: country, lang: 'en' });
                            score = typeof details.score === 'number' ? details.score : (details.scoreText ? parseFloat(details.scoreText) : undefined);
                            if (details.url) url = details.url;
                        } catch (e) {
                            // If detailed fetch fails, fall back to constructed URL and undefined score
                        }

                        todaySnapshot[app.appId] = {
                            rank: index + 1,
                            title: app.title,
                            icon: app.icon,
                            score: score,
                            url: url
                        };
                    }

                    // 2. Query relative historical segment matching this criteria matrix subset 
                    const yesterdayDocs = await db.current_ranks.find({ segment: trackingKey });
                    const yesterdayApps = {};
                    yesterdayDocs.forEach(doc => { yesterdayApps[doc.app_id] = doc; });

                    let segmentDropped = [];
                    let segmentReturned = [];

                    // 3. Status checks inside segment boundary lines
                    for (const appId in yesterdayApps) {
                        if (!todaySnapshot[appId]) {
                            const safeTitle = escapeHTML(yesterdayApps[appId].title);
                            segmentDropped.push(`❌ <b>${safeTitle}</b> (<code>${appId}</code>) dropped out of ${coll.name} -> ${cat} (${country.toUpperCase()})`);
                            totalDroppedOut++;
                        }
                    }

                    for (const appId in todaySnapshot) {
                        if (!yesterdayApps[appId]) {
                            const historicMatch = await db.rank_history.findOne({ app_id: appId, segment: trackingKey });
                            if (historicMatch) {
                                const safeTitle = escapeHTML(todaySnapshot[appId].title);
                                segmentReturned.push(`🔄 <b>${safeTitle}</b> (<code>${appId}</code>) returned to ${coll.name} -> ${cat} (${country.toUpperCase()}) at Rank #${todaySnapshot[appId].rank}`);
                                totalReturnedBack++;
                            }
                        }
                    }

                    if (segmentDropped.length > 0) alertsLog.push(segmentDropped.join('\n'));
                    if (segmentReturned.length > 0) alertsLog.push(segmentReturned.join('\n'));

                    // 4. Batch Clear and write local data partitions 
                    await db.current_ranks.remove({ segment: trackingKey }, { multi: true });

                    const currentRanksDocs = [];
                    const historyDocs = [];

                    for (const appId in todaySnapshot) {
                        // Compound identification keys for tracking accuracy
                        currentRanksDocs.push({
                            segment: trackingKey,
                            app_id: appId,
                            title: todaySnapshot[appId].title,
                            icon: todaySnapshot[appId].icon,
                            current_rank: todaySnapshot[appId].rank,
                            score: todaySnapshot[appId].score,
                            url: todaySnapshot[appId].url,
                            last_updated: todayDate
                        });

                        historyDocs.push({
                            segment: trackingKey,
                            app_id: appId,
                            title: todaySnapshot[appId].title,
                            rank: todaySnapshot[appId].rank,
                            score: todaySnapshot[appId].score,
                            url: todaySnapshot[appId].url,
                            date: todayDate
                        });
                    }

                    if (currentRanksDocs.length > 0) {
                        await db.current_ranks.insert(currentRanksDocs);
                        await db.rank_history.insert(historyDocs);
                    }

                    // Avoid aggressive rate limit timeouts on external scrapers
                    await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (err) {
                    console.error(`Error scraping pipeline matrix context [${country} | ${coll.name} | ${cat}]:`, err && err.message ? err.message : err);
                    if (err && err.stack) console.error(err.stack);
                }
            }
        }
    }

    // Dispatch accumulated summary changes to telegram
    if (alertsLog.length > 0) {
        await sendTelegramAlert(`<b>Daily Rank Status Report Update</b>\n\n${alertsLog.slice(0, 15).join('\n')}\n${alertsLog.length > 15 ? '<i>...and more metrics available via dashboard panel</i>' : ''}`);
    }

    // Write global metadata index snapshot point
    await db.daily_summaries.insert({
        date: todayDate,
        dropped_out_count: totalDroppedOut,
        returned_count: totalReturnedBack
    });

    // 30-day data purging retention rules maintenance execution
    // const thirtyDaysAgo = new Date();
    // thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    // await db.rank_history.remove({ date: { $lt: thirtyDaysAgo } }, { multi: true });

    console.log(`[${new Date().toISOString()}] Global pipeline scraping cycle execution completed.`);
}

// Automatically execute scheduler task execution routines on app context startup initialization
// This schedules the script natively inside the process to run every night at midnight (00:00)
cron.schedule('0 0 * * *', () => {
    runScrapingPipeline();
});