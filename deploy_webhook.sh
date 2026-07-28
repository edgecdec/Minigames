#!/bin/bash

# Deploy script for Minigames
# Matches the TopTenGame pattern: no pm2 stop before build, so the old
# server keeps serving traffic until the final restart swaps in new code.

APP_DIR="/var/www/Minigames"
LOG_FILE="/var/log/webhook_deploy_minigames.log"
LOCK_FILE="/tmp/minigames-deploy.lock"
PM2_NAME="minigames"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Prevent concurrent deploys
exec 200>"$LOCK_FILE"
flock -n 200 || { log "Deploy already in progress, skipping"; exit 0; }

log "Webhook triggered! Starting deployment..."

cd "$APP_DIR" || { log "Failed to cd to $APP_DIR"; exit 1; }

OLD_PKG_HASH=$(md5sum package.json 2>/dev/null | cut -d' ' -f1)

log "Fetching changes..."
git fetch origin main >> "$LOG_FILE" 2>&1
git reset --hard origin/main >> "$LOG_FILE" 2>&1

NEW_PKG_HASH=$(md5sum package.json 2>/dev/null | cut -d' ' -f1)
if [ "$OLD_PKG_HASH" != "$NEW_PKG_HASH" ] || [ ! -d "node_modules" ]; then
    log "package.json changed — reinstalling dependencies..."
    rm -rf node_modules
    npm install --production=false >> "$LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
        log "npm install failed, trying without lockfile..."
        rm -rf node_modules package-lock.json
        npm install --production=false >> "$LOG_FILE" 2>&1
        if [ $? -ne 0 ]; then
            log "DEPLOY FAILED: npm install failed"
            pm2 restart "$PM2_NAME" >> "$LOG_FILE" 2>&1
            exit 1
        fi
    fi
else
    log "package.json unchanged — skipping npm install"
fi

log "Building..."
rm -rf .next
npm run build >> "$LOG_FILE" 2>&1
if [ $? -ne 0 ]; then
    log "DEPLOY FAILED: build failed"
    pm2 restart "$PM2_NAME" >> "$LOG_FILE" 2>&1
    exit 1
fi

# A successful exit code is not enough — Next.js can emit a broken build.
CHUNK_COUNT=$(ls .next/static/chunks/*.js 2>/dev/null | wc -l)
if [ "$CHUNK_COUNT" -lt 5 ]; then
    log "DEPLOY FAILED: build produced only $CHUNK_COUNT chunks"
    pm2 restart "$PM2_NAME" >> "$LOG_FILE" 2>&1
    exit 1
fi

log "Build OK — $CHUNK_COUNT chunks produced"

log "Starting App..."
NODE_ENV=production pm2 restart "$PM2_NAME" --update-env >> "$LOG_FILE" 2>&1

log "Deployment Complete."
