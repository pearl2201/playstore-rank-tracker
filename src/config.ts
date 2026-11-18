import dotenv from 'dotenv';

dotenv.config();

const config = {
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || '127.0.0.1',
    telegramToken: process.env.TELEGRAM_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    seedCountries: (process.env.TRACKED_COUNTRIES || 'us').split(',').map(c => c.trim().toLowerCase()).filter(Boolean),
    historyRetentionDays: Number(process.env.HISTORY_RETENTION_DAYS || 30),
    adminUser: process.env.ADMIN_USER,
    adminPassword: process.env.ADMIN_PASSWORD,
    db: {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        name: process.env.DB_NAME || 'playstore_tracker',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl: process.env.DB_SSL === 'true'
    }
};
export { config};