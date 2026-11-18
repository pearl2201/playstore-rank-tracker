export type Platform = 'android' | 'ios';

export const PLATFORMS: Platform[] = ['android', 'ios'];

export const PLATFORM_LABELS: Record<Platform, string> = {
    android: 'Google Play',
    ios: 'App Store'
};

export const COLLECTIONS = ['TOP_FREE', 'TOP_PAID', 'GROSSING'] as const;
export type CollectionName = typeof COLLECTIONS[number];

export const CATEGORY_LABELS: Record<string, string> = {
    GAME: 'All Games',
    GAME_ACTION: 'Action',
    GAME_ADVENTURE: 'Adventure',
    GAME_ARCADE: 'Arcade',
    GAME_BOARD: 'Board',
    GAME_CARD: 'Card',
    GAME_CASINO: 'Casino',
    GAME_CASUAL: 'Casual',
    GAME_EDUCATIONAL: 'Educational',
    GAME_MUSIC: 'Music',
    GAME_PUZZLE: 'Puzzle',
    GAME_RACING: 'Racing',
    GAME_ROLE_PLAYING: 'Role Playing',
    GAME_SIMULATION: 'Simulation',
    GAME_SPORTS: 'Sports',
    GAME_STRATEGY: 'Strategy',
    GAME_TRIVIA: 'Trivia',
    GAME_WORD: 'Word'
};

// The App Store has no Arcade or Educational game genre, so iOS has two fewer categories.
export const CATEGORIES: Record<Platform, string[]> = {
    android: Object.keys(CATEGORY_LABELS),
    ios: Object.keys(CATEGORY_LABELS).filter(c => c !== 'GAME_ARCADE' && c !== 'GAME_EDUCATIONAL')
};

/**
 * Segment key stored in current_ranks / rank_history.
 * Android keys keep the original format (no prefix) so data from before iOS support stays valid.
 */
export function segmentKey(platform: Platform, country: string, collection: string, category: string): string {
    const base = `${country.toLowerCase()}_${collection}_${category}`;
    return platform === 'ios' ? `ios_${base}` : base;
}

export function isPlatform(value: unknown): value is Platform {
    return value === 'android' || value === 'ios';
}
