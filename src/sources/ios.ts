import type { ChartApp, Source } from './types.js';

// Apple's public iTunes RSS charts (title, icon, developer, bundle id) plus the lookup API
// (average rating). No API key needed.

const FEEDS: Record<string, string> = {
    TOP_FREE: 'topfreeapplications',
    TOP_PAID: 'toppaidapplications',
    GROSSING: 'topgrossingapplications'
};

// Genre ids verified against the live feeds (6014 = Games, 70xx = game sub-genres)
const GENRES: Record<string, number> = {
    GAME: 6014,
    GAME_ACTION: 7001,
    GAME_ADVENTURE: 7002,
    GAME_CASUAL: 7003,
    GAME_BOARD: 7004,
    GAME_CARD: 7005,
    GAME_CASINO: 7006,
    GAME_MUSIC: 7011,
    GAME_PUZZLE: 7012,
    GAME_RACING: 7013,
    GAME_ROLE_PLAYING: 7014,
    GAME_SIMULATION: 7015,
    GAME_SPORTS: 7016,
    GAME_STRATEGY: 7017,
    GAME_TRIVIA: 7018,
    GAME_WORD: 7019
};

interface RssEntry {
    id: { label: string; attributes: { 'im:id': string; 'im:bundleId'?: string } };
    'im:name': { label: string };
    'im:artist'?: { label: string };
    'im:image'?: { label: string }[];
    link?: { attributes: { rel: string; href: string } } | { attributes: { rel: string; href: string } }[];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** GET JSON with a timeout and retries on rate limiting / transient errors. */
async function getJson<T>(url: string): Promise<T> {
    let lastError: Error = new Error('unknown error');
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
            if (res.ok) return await res.json() as T;
            lastError = new Error(`HTTP ${res.status} for ${url}`);
            if (res.status !== 403 && res.status !== 429 && res.status < 500) break; // not retryable
        } catch (err) {
            lastError = err as Error;
        }
        await sleep(5000 * attempt);
    }
    throw lastError;
}

function storeUrl(entry: RssEntry): string {
    const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
    const href = links.find(l => l.attributes.rel === 'alternate')?.attributes.href ?? entry.id.label;
    return href.split('?')[0];
}

/** Average user rating per track id; failures only cost us the scores. */
async function fetchRatings(ids: string[], country: string): Promise<Map<string, number>> {
    const ratings = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        try {
            const data = await getJson<{ results: { trackId: number; averageUserRating?: number }[] }>(
                `https://itunes.apple.com/lookup?id=${chunk.join(',')}&country=${country}&entity=software`
            );
            for (const r of data.results) {
                if (typeof r.averageUserRating === 'number') ratings.set(String(r.trackId), r.averageUserRating);
            }
        } catch (err) {
            console.warn(`iTunes lookup failed (${country}): ${(err as Error).message}`);
        }
    }
    return ratings;
}

export const iosSource: Source = {
    platform: 'ios',
    delayMs: Number(process.env.IOS_DELAY_MS || 3000), // Apple rate-limits lookups much harder than Google Play

    async fetchChart(country, collection, category): Promise<ChartApp[]> {
        const feed = FEEDS[collection];
        const genre = GENRES[category];
        if (!feed || !genre) throw new Error(`Unknown App Store collection/category: ${collection}/${category}`);

        const data = await getJson<{ feed: { entry?: RssEntry | RssEntry[] } }>(
            `https://itunes.apple.com/${country}/rss/${feed}/limit=100/genre=${genre}/json`
        );
        const raw = data.feed.entry;
        const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
        if (entries.length === 0) return [];

        const ratings = await fetchRatings(entries.map(e => e.id.attributes['im:id']), country);

        return entries.map(e => {
            const appId = e.id.attributes['im:id'];
            const images = e['im:image'] ?? [];
            return {
                appId,
                bundleId: e.id.attributes['im:bundleId'] ?? appId,
                title: e['im:name'].label,
                icon: images[images.length - 1]?.label ?? '',
                score: ratings.get(appId) ?? null,
                url: storeUrl(e),
                developer: e['im:artist']?.label ?? null
            };
        });
    }
};
