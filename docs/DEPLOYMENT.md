# Deployment Guide

This guide describes one simple way to run AI Edu Workflow Tools in production
on a single Linux server with `systemd`. Adapt paths, ports, and the process
manager to your own environment.

> Never commit server IPs, SSH credentials, API keys, or database passwords.
> All secrets belong in the `.env` file on the server (which is git-ignored),
> or in your secret manager.

## 1. Prerequisites

- Node.js 20+ on the server
- (Optional) MySQL 8.0 if you want database-backed storage instead of the
  default local JSONL files
- (Optional) A CJK font installed for PDF export with Chinese text

## 2. Build the release locally

```bash
npm install
npm run check        # type-check + node --check
npm run build        # builds the frontend into dist/
```

Package the files you need to ship (everything except `node_modules`, `.env`,
and local data):

```bash
tar -czf release.tar.gz \
  --exclude='node_modules' --exclude='.env' --exclude='data' --exclude='output' \
  server.js package.json package-lock.json dist src docs README.md
```

## 3. Install on the server

```bash
APP=/opt/ai-edu-workflow-tools          # choose any directory
mkdir -p "$APP"
tar -xzf release.tar.gz -C "$APP"
cd "$APP"
npm ci --omit=dev --no-audit --no-fund
```

Create the production `.env` on the server (see [`.env.example`](../.env.example)),
set at least `AI_API_KEY` and a `PORT`, then test:

```bash
PORT=8080 node server.js
curl -I http://127.0.0.1:8080/
```

## 4. Run under systemd

Create `/etc/systemd/system/ai-edu-workflow-tools.service`:

```ini
[Unit]
Description=AI Edu Workflow Tools
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/ai-edu-workflow-tools
EnvironmentFile=/opt/ai-edu-workflow-tools/.env
ExecStart=/usr/bin/node /opt/ai-edu-workflow-tools/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
systemctl daemon-reload
systemctl enable --now ai-edu-workflow-tools.service
systemctl status ai-edu-workflow-tools.service
journalctl -u ai-edu-workflow-tools -f
```

## 5. PDF fonts (optional)

For Chinese text in exported PDFs, install a CJK font and point the app at it:

```bash
PDF_FONT_PATH=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
PDF_FONT_NAME=NotoSansCJKsc-Regular
```

## 6. Updating

1. Build a new release locally.
2. Upload and extract it into the app directory.
3. Run `npm ci --omit=dev`.
4. `systemctl restart ai-edu-workflow-tools.service`.

Put a reverse proxy (nginx / Caddy) with TLS in front of the app for public
deployments.
