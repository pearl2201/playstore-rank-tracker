# Playstore Rank Tracker

A lightweight Google Play Store game rank tracker that scrapes category/collection charts, stores rank history, and exposes a small dashboard and APIs.

## Features
- Periodic scraping of Google Play charts (multi-country, collections, categories)
- Stores current ranks and 30-day history (local DB)
- Web dashboard at `/` with filters and history timeline
- Telegram alerts support for changes

## Requirements
- Node.js 18+ (or current LTS)
- npm

## Quick start (development)

1. Clone the repository and install dependencies:

```bash
git clone <repo-url> playstore-tracker
cd playstore-tracker
npm install
```

2. Create a `.env` in the project root with the following values (example):

```env
TELEGRAM_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
TRACKED_COUNTRIES=us,gb,jp
PORT=3000
```

3. Run the app locally:

```bash
npm start
# open http://localhost:3000
```

4. Run a one-off scrape immediately (fills DB with current data):

```bash
npm run scrape:now
```

## Systemd service (Linux)

To run the tracker as a background service on a Linux systemd host, create a service file at `/etc/systemd/system/playstore-tracker.service`.

Example `playstore-tracker.service`:

```ini
[Unit]
Description=Playstore Rank Tracker
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/playstore-tracker
Environment=NODE_ENV=production
EnvironmentFile=/path/to/playstore-tracker/.env
ExecStart=/usr/bin/node /path/to/playstore-tracker/server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Replace `/path/to/playstore-tracker` and `youruser` with appropriate values for your system.

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable playstore-tracker.service
sudo systemctl start playstore-tracker.service
```

Follow logs (live tail):

```bash
sudo journalctl -u playstore-tracker.service -n 50 -f
```

## API Endpoints
- `GET /api/config` — returns configured countries
- `GET /api/ranks?country=us&collection=TOP_FREE&category=GAME` — current segment ranks
- `GET /api/track/:appId?segment=<segmentKey>` — 30-day history for an app
- `POST /api/trigger-scrape` — trigger a background scrape run

## Files of interest
- [cron.js](cron.js) — scraping pipeline and DB writes
- [server.js](server.js) — HTTP server and API routes
- [public/index.html](public/index.html) — frontend UI

## Troubleshooting
- If scraping fails with dependency errors, ensure modules are installed: `npm ci` or `npm install`.
- To reproduce a single run and view errors, run:

```bash
npm run scrape:now
```

Check logs for more details and inspect stack traces printed to console or `journalctl` when running as a service.

## Contributing
Feel free to open issues or PRs. Keep changes focused and add tests where appropriate.

## License
MIT
