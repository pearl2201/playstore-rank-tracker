// db.js
import Datastore from 'nedb-promises';
import path from 'path';

const dataDir = './data';

export const db = {
    current_ranks: Datastore.create({ filename: path.join(dataDir, 'current_ranks.db'), autoload: true }),
    rank_history: Datastore.create({ filename: path.join(dataDir, 'rank_history.db'), autoload: true }),
    daily_summaries: Datastore.create({ filename: path.join(dataDir, 'daily_summaries.db'), autoload: true })
};

// Ensure performance indexes are built on startup
db.rank_history.ensureIndex({ fieldName: 'app_id' });
db.rank_history.ensureIndex({ fieldName: 'date' });