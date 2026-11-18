import gplay from 'google-play-scraper';
import type { Source } from './types.js';

// The package's typings declare these as types only, but they are plain objects at runtime
const collectionMap = gplay.collection as unknown as Record<string, typeof gplay.collection>;
const categoryMap = gplay.category as unknown as Record<string, typeof gplay.category>;

export const androidSource: Source = {
    platform: 'android',
    delayMs: 1000,

    async fetchChart(country, collection, category) {
        const collectionValue = collectionMap[collection];
        const categoryValue = categoryMap[category];
        if (collectionValue === undefined || categoryValue === undefined) {
            throw new Error(`Unknown Google Play collection/category: ${collection}/${category}`);
        }

        // list() already returns score and url: no per-app gplay.app() request needed
        const apps = await gplay.list({
            collection: collectionValue,
            category: categoryValue,
            num: 100,
            country,
            lang: 'en'
        });

        return apps.map(app => {
            const parsed = typeof app.score === 'number' ? app.score : parseFloat(app.scoreText);
            return {
                appId: app.appId,
                bundleId: app.appId,
                title: app.title,
                icon: app.icon,
                score: Number.isFinite(parsed) ? parsed : null,
                url: app.url || `https://play.google.com/store/apps/details?id=${app.appId}&hl=en&gl=${country.toUpperCase()}`,
                developer: app.developer ?? null
            };
        });
    }
};
