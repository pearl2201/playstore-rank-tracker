import {
    Sequelize, DataTypes, Model,
    type InferAttributes, type InferCreationAttributes, type CreationOptional
} from 'sequelize';
import { config } from './config.js';

const opts = {
    host: config.db.host,
    port: config.db.port,
    dialect: 'postgres' as const,
    logging: false,
    pool: { max: 4, min: 0, idle: 30000 },
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false,
        }
    },
    define: { timestamps: false, freezeTableName: true }
};
// Small pool: target server is 1 core / 2GB RAM
export const sequelize = new Sequelize(config.db.name, config.db.user, config.db.password, opts);

// Attribute names are snake_case on purpose: they are serialized as-is to the dashboard API.

export class CurrentRank extends Model<InferAttributes<CurrentRank>, InferCreationAttributes<CurrentRank>> {
    declare segment: string;
    declare app_id: string;
    declare title: string | null;
    declare icon: string | null;
    declare current_rank: number;
    declare score: number | null;
    declare url: string | null;
    declare last_updated: Date;
}
CurrentRank.init({
    segment: { type: DataTypes.TEXT, primaryKey: true },
    app_id: { type: DataTypes.TEXT, primaryKey: true },
    title: DataTypes.TEXT,
    icon: DataTypes.TEXT,
    current_rank: { type: DataTypes.INTEGER, allowNull: false },
    score: DataTypes.REAL,
    url: DataTypes.TEXT,
    last_updated: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize, tableName: 'current_ranks',
    indexes: [{ fields: ['segment', 'current_rank'] }]
});

export class RankHistory extends Model<InferAttributes<RankHistory>, InferCreationAttributes<RankHistory>> {
    declare segment: string;
    declare app_id: string;
    declare date: Date;
    declare title: string | null;
    declare rank: number;
    declare score: number | null;
    declare url: string | null;
}
RankHistory.init({
    segment: { type: DataTypes.TEXT, primaryKey: true },
    app_id: { type: DataTypes.TEXT, primaryKey: true },
    date: { type: DataTypes.DATE, primaryKey: true },
    title: DataTypes.TEXT,
    rank: { type: DataTypes.INTEGER, allowNull: false },
    score: DataTypes.REAL,
    url: DataTypes.TEXT
}, {
    sequelize, tableName: 'rank_history',
    indexes: [{ fields: ['date'] }]
});

export class DailySummary extends Model<InferAttributes<DailySummary>, InferCreationAttributes<DailySummary>> {
    declare date: Date;
    declare dropped_out_count: number;
    declare returned_count: number;
}
DailySummary.init({
    date: { type: DataTypes.DATE, primaryKey: true },
    dropped_out_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    returned_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
}, { sequelize, tableName: 'daily_summaries' });

export class TrackedCountry extends Model<InferAttributes<TrackedCountry>, InferCreationAttributes<TrackedCountry>> {
    declare code: string;
    declare name: CreationOptional<string | null>;
    declare enabled: CreationOptional<boolean>;
}
TrackedCountry.init({
    code: { type: DataTypes.STRING(2), primaryKey: true },
    name: DataTypes.TEXT,
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, { sequelize, tableName: 'tracked_countries' });

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * Crawl queue. The web/admin process only inserts 'pending' rows; the single scraper
 * worker consumes them one at a time, which doubles as the "only one crawl at once" lock.
 */
export class CrawlJob extends Model<InferAttributes<CrawlJob>, InferCreationAttributes<CrawlJob>> {
    declare id: CreationOptional<number>;
    declare status: CreationOptional<JobStatus>;
    declare country: CreationOptional<string | null>; // null = all enabled countries
    declare trigger: CreationOptional<string>;        // 'cron' | 'admin' | 'cli'
    declare message: CreationOptional<string | null>;
    declare requested_at: CreationOptional<Date>;
    declare started_at: CreationOptional<Date | null>;
    declare finished_at: CreationOptional<Date | null>;
}
CrawlJob.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    status: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'pending' },
    country: DataTypes.STRING(2),
    trigger: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'admin' },
    message: DataTypes.TEXT,
    requested_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    started_at: DataTypes.DATE,
    finished_at: DataTypes.DATE
}, { sequelize, tableName: 'crawl_jobs', indexes: [{ fields: ['status'] }] });

/** Create tables if missing and seed tracked countries from TRACKED_COUNTRIES on first run. */
export async function initDb(): Promise<void> {
    const lockId = 84729104; // Arbitrary unique integer lock ID for this app
    await sequelize.query(`SELECT pg_advisory_lock(${lockId});`);
    try {
        await sequelize.sync();
        if ((await TrackedCountry.count()) === 0) {
            await TrackedCountry.bulkCreate(
                config.seedCountries.filter(c => /^[a-z]{2}$/.test(c)).map(code => ({ code }))
            );
        }
    } finally {
        await sequelize.query(`SELECT pg_advisory_unlock(${lockId});`);
    }
}

/** Queue a crawl unless one is already pending/running. Returns null when rejected. */
export async function enqueueCrawl(trigger: string, country: string | null = null): Promise<CrawlJob | null> {
    const active = await CrawlJob.findOne({ where: { status: ['pending', 'running'] } });
    if (active) return null;
    return CrawlJob.create({ trigger, country });
}
