import type { Platform } from '../segments.js';

export interface ChartApp {
    appId: string;            // Android package name, or iOS numeric track id
    bundleId: string;         // Android package name == appId; iOS bundle identifier
    title: string;
    icon: string;
    score: number | null;
    url: string;
    developer: string | null;
}

export interface Source {
    platform: Platform;
    /** Pause between two segments, to stay under the store's rate limits. */
    delayMs: number;
    /** Returns the chart in rank order (index 0 = rank 1). */
    fetchChart(country: string, collection: string, category: string): Promise<ChartApp[]>;
}
