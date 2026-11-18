import { QueryTypes } from 'sequelize';
import { sequelize, type CurrentRank } from './db.js';
import { similarDeveloper } from './match.js';
import type { Platform } from './segments.js';

export interface OtherStore {
    platform: Platform;
    url: string;
    title: string | null;
    match: 'exact' | 'likely'; // exact = same bundle id / package name; likely = same title + similar developer
}

interface Candidate {
    bundle_id: string;
    title_key: string | null;
    developer: string | null;
    title: string | null;
    url: string | null;
}

/**
 * For each ranked app, look for the same game in the other store, among everything we have
 * crawled there (any country, any chart). Prefers a link from the same country.
 */
export async function withOtherStore(ranks: CurrentRank[], platform: Platform, country: string) {
    const other: Platform = platform === 'android' ? 'ios' : 'android';
    const otherPrefix = other === 'ios' ? `ios\\_${country}\\_%` : `${country}\\_%`;

    const bundleIds = [...new Set(ranks.map(r => r.bundle_id).filter((v): v is string => !!v))];
    const titleKeys = [...new Set(ranks.map(r => r.title_key).filter((v): v is string => !!v))];

    // DISTINCT ON keeps one row per key, preferring one crawled from the viewer's country
    const exactRows = bundleIds.length === 0 ? [] : await sequelize.query<Candidate>(
        `SELECT DISTINCT ON (bundle_id) bundle_id, title_key, developer, title, url
         FROM current_ranks
         WHERE platform = :other AND bundle_id IN (:ids)
         ORDER BY bundle_id, (segment LIKE :prefix) DESC`,
        { replacements: { other, ids: bundleIds, prefix: otherPrefix }, type: QueryTypes.SELECT }
    );
    const exact = new Map(exactRows.map(r => [r.bundle_id, r]));

    const fuzzyRows = titleKeys.length === 0 ? [] : await sequelize.query<Candidate>(
        `SELECT DISTINCT ON (title_key, bundle_id) bundle_id, title_key, developer, title, url
         FROM current_ranks
         WHERE platform = :other AND title_key IN (:keys)
         ORDER BY title_key, bundle_id, (segment LIKE :prefix) DESC`,
        { replacements: { other, keys: titleKeys, prefix: otherPrefix }, type: QueryTypes.SELECT }
    );
    const fuzzy = new Map<string, Candidate[]>();
    for (const r of fuzzyRows) {
        if (!r.title_key) continue;
        const list = fuzzy.get(r.title_key) ?? [];
        list.push(r);
        fuzzy.set(r.title_key, list);
    }

    return ranks.map(rank => {
        let match: OtherStore | null = null;

        const hit = rank.bundle_id ? exact.get(rank.bundle_id) : undefined;
        if (hit?.url) {
            match = { platform: other, url: hit.url, title: hit.title, match: 'exact' };
        } else if (rank.title_key) {
            const candidate = (fuzzy.get(rank.title_key) ?? [])
                .find(c => c.url && similarDeveloper(c.developer, rank.developer));
            if (candidate?.url) {
                match = { platform: other, url: candidate.url, title: candidate.title, match: 'likely' };
            }
        }
        return { ...rank.toJSON(), other_store: match };
    });
}
