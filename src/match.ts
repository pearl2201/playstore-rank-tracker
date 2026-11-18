// Helpers to decide whether an Android app and an iOS app are the same game.
//
// Strongest signal: the iOS bundle ID equals the Android package name (many studios reuse it).
// Fallback: same normalised title AND a similar developer name.

/** Lower-case, strip accents/punctuation. Subtitles ("Foo - Match 3 Puzzle", "Foo: Bar") are dropped. */
export function titleKey(title: string | null | undefined): string | null {
    if (!title) return null;
    const main = title.split(/\s[-–—|]\s|:\s/)[0];
    const key = main
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
    return key.length >= 2 ? key : null;
}

const DEV_STOPWORDS = new Set([
    'inc', 'llc', 'ltd', 'limited', 'co', 'corp', 'corporation', 'company', 'gmbh', 'sa', 'srl', 'bv', 'ab',
    'pte', 'pty', 'private', 'international', 'intl', 'games', 'game', 'studio', 'studios', 'the', 'as', 'oy', 'kk'
]);

export function developerKey(name: string | null | undefined): string {
    if (!name) return '';
    return name
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(t => t && !DEV_STOPWORDS.has(t))
        .join('');
}

export function similarDeveloper(a: string | null | undefined, b: string | null | undefined): boolean {
    const ka = developerKey(a);
    const kb = developerKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
    return short.length >= 4 && long.includes(short);
}
