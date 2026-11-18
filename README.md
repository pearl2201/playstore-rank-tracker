# Playstore Rank Tracker

Google Play game chart tracker (TypeScript, Express, Sequelize, PostgreSQL). It runs as two separate processes:

- **web** (`src/web.ts`): public dashboard, read-only API, and a password-protected admin panel at `/admin`.
- **scraper** (`src/scraper.ts`): worker that crawls Google Play. It runs a full crawl every night at 00:00 and also runs crawl jobs queued from the admin panel or CLI. Jobs run one at a time.

The two processes only talk through PostgreSQL (the `crawl_jobs` table), so a heavy crawl can't freeze the web server.

## Requirements
- Node.js 20+
- PostgreSQL 13+ (`createdb playstore_tracker`; tables are created automatically on startup)

## Setup

```bash
npm install
cp .env.example .env   # then edit DB_* and ADMIN_* values
npm run build
```

Run each process (two terminals, or the systemd units below):

```bash
npm run start:web
npm run start:scraper
```

For development: `npm run dev:web` and `npm run dev:scraper` (tsx watch).

## Configuration (.env)

| Variable | Purpose |
|---|---|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` `DB_SSL` | PostgreSQL connection |
| `HOST` / `PORT` | Web bind address (default `127.0.0.1:3000`) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Admin panel login. **If either is empty, `/admin` is disabled.** |
| `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` | Optional rank-change alerts |
| `TRACKED_COUNTRIES` | Only used to seed the countries table on first start. After that, manage countries in `/admin`. |
| `HISTORY_RETENTION_DAYS` | History retention (default 30) |

## Admin panel

`/admin` (HTTP Basic auth) lets you add, enable/disable and delete tracked countries and queue a re-crawl (all countries, or one). Notes:

- Basic auth sends the password with every request. Put the site behind HTTPS (nginx/Caddy) before exposing it. The default bind address `127.0.0.1` keeps it private until you do.
- Failed logins are rate limited per IP (10 per 15 minutes), and state-changing calls require an `X-Requested-With` header (CSRF guard).
- Country codes are Google Play codes: use `gb` for the United Kingdom, not `uk`.

## Queue a crawl from the CLI

```bash
npm run scrape:now          # all enabled countries
npm run scrape:now -- vn    # one country
```

This only queues the job; the scraper worker picks it up within ~10 seconds.

## Deploy with systemd (Linux)

```bash
sudo cp playstore-tracker-web.service playstore-tracker-scraper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now playstore-tracker-web playstore-tracker-scraper
journalctl -u playstore-tracker-scraper -f
```

Adjust `WorkingDirectory`, `EnvironmentFile` and `User` in the unit files to match your server. The units cap memory (`MemoryMax`) so a runaway process restarts instead of taking the 2GB server down.

## API
- `GET /api/config`: enabled countries
- `GET /api/ranks?country=us&collection=TOP_FREE&category=GAME`: current ranks of a segment
- `GET /api/track/:appId?segment=<segment>`: 30-day history
- `GET /api/summary`: latest dropped/returned counts

## Schema management

Tables are created with `sequelize.sync()` (create-if-missing only). It does not alter existing tables, so future schema changes will need migrations.
