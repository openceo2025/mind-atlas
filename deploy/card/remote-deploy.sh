#!/usr/bin/env bash
# MindAtlas β の VPS 側デプロイ。root で実行する: bash /tmp/mind-atlas-beta-deploy.sh <sha>
#
# 本体（/opt/mind-atlas, :8788）には触れない。同じ PostgreSQL を共有し、β 用のテーブルを
# 追加するだけ（spatial:migrate）。マイグレーションの前に必ず pg_dump でバックアップを取る。
# .env.service は本体の .env.service から毎回作り直し、β 用の値だけ上書きする（値は表示しない）。
set -euo pipefail

SHA="${1:?usage: remote-deploy.sh <sha>}"
APP=/opt/mind-atlas-beta
BACKUPS=/opt/mind-atlas-beta-backups
DB_BACKUPS="$BACKUPS/db"
LEGACY_ENV=/opt/mind-atlas/.env.service
UNIT=mind-atlas-beta
PORT=8789
DOMAIN=beta.mind-atlas.org
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUPS/$SHA.tar.gz"

[ -f "$ARCHIVE" ] || { echo "archive not found: $ARCHIVE" >&2; exit 1; }
[ -f "$LEGACY_ENV" ] || { echo "legacy env not found: $LEGACY_ENV" >&2; exit 1; }
mkdir -p "$BACKUPS" "$DB_BACKUPS"
chmod 700 "$BACKUPS" "$DB_BACKUPS"

KEEP=""
if [ -d "$APP" ]; then
  OLD=$(cut -c1-12 "$APP/.deploy-commit" 2>/dev/null || echo unknown)
  KEEP="$STAMP-$OLD"
  echo "== backing up the live tree to $BACKUPS/$KEEP =="
  cp -a "$APP" "$BACKUPS/$KEEP"
fi

echo "== laying commit $SHA over $APP =="
mkdir -p "$APP"
# git archive carries only tracked files, so clear the paths it owns first: a file
# deleted in this commit would otherwise survive here and break the build.
tar -tzf "$ARCHIVE" | cut -d/ -f1 | sort -u | while read -r entry; do
  case "$entry" in
    "" | node_modules | .env.service | .deploy-commit | dist | dist-spatial) continue ;;
  esac
  rm -rf "${APP:?}/$entry"
done
tar -xzf "$ARCHIVE" -C "$APP"
echo "$SHA" > "$APP/.deploy-commit"

echo "== env: derived from the legacy service with beta overrides (values not shown) =="
OVERRIDE_KEYS='MIND_ATLAS_SERVICE_HOST|MIND_ATLAS_SERVICE_PORT|MIND_ATLAS_PUBLIC_ORIGIN|MIND_ATLAS_ALLOWED_ORIGIN|MIND_ATLAS_DIST_DIR|MIND_ATLAS_ANALYTICS_ENABLED|MIND_ATLAS_CLIENT_ANALYTICS_ENABLED|MIND_ATLAS_MAINTENANCE_INTERVAL_MS'
TMP_ENV=$(mktemp)
grep -vE "^(${OVERRIDE_KEYS})=" "$LEGACY_ENV" > "$TMP_ENV" || true
{
  echo
  echo "# --- MindAtlas beta overrides (deploy/beta/remote-deploy.sh) ---"
  echo "MIND_ATLAS_SERVICE_HOST=127.0.0.1"
  echo "MIND_ATLAS_SERVICE_PORT=$PORT"
  echo "MIND_ATLAS_PUBLIC_ORIGIN=https://$DOMAIN"
  echo "MIND_ATLAS_ALLOWED_ORIGIN=https://$DOMAIN"
  echo "MIND_ATLAS_DIST_DIR=dist-spatial"
  # β のアクセスで本体のアナリティクスを汚さない
  echo "MIND_ATLAS_ANALYTICS_ENABLED=0"
  echo "MIND_ATLAS_CLIENT_ANALYTICS_ENABLED=0"
  # セッション掃除・クレジット返金は本体だけが行う（共有 DB で二重に走らせない）
  echo "MIND_ATLAS_MAINTENANCE_INTERVAL_MS=0"
} >> "$TMP_ENV"
install -o root -g www-data -m 640 "$TMP_ENV" "$APP/.env.service"
rm -f "$TMP_ENV"
echo "keys: $(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$APP/.env.service")"

cd "$APP"
echo "== npm ci =="
npm ci --no-audit --no-fund
echo "== spatial:build:hosted =="
npm run spatial:build:hosted
echo "== verify:spatial-dist =="
npm run verify:spatial-dist

echo "== database backup before migration =="
DB_NAME=$(node -e '
const fs = require("fs");
const line = fs.readFileSync(".env.service", "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
const url = new URL(line.slice("DATABASE_URL=".length).trim().replace(/^["\x27]|["\x27]$/g, ""));
if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) { console.error("database is not local"); process.exit(1); }
process.stdout.write(decodeURIComponent(url.pathname.slice(1)));
')
DUMP="$DB_BACKUPS/$STAMP-$DB_NAME.dump"
runuser -u postgres -- pg_dump -Fc "$DB_NAME" > "$DUMP"
chmod 600 "$DUMP"
pg_restore --list "$DUMP" > /dev/null
echo "dump: $DUMP ($(du -h "$DUMP" | cut -f1))"
# 直近 3 世代だけ残す（利用者データの複製を増やさない）
ls -1t "$DB_BACKUPS"/*.dump | tail -n +4 | xargs -r rm -f

echo "== spatial:migrate (create table if not exists only) =="
npm run spatial:migrate

echo "== ownership =="
chown -R www-data:www-data "$APP"
chown root:www-data "$APP/.env.service"
chmod 640 "$APP/.env.service"

echo "== systemd =="
install -m 644 "$APP/deploy/beta/$UNIT.service" "/etc/systemd/system/$UNIT.service"
systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null 2>&1
systemctl restart "$UNIT"

echo "== nginx =="
SITE=/etc/nginx/sites-available/mind-atlas-beta
if [ ! -f "$SITE" ]; then
  install -m 644 "$APP/deploy/beta/nginx-beta.conf" "$SITE"
  ln -sf "$SITE" /etc/nginx/sites-enabled/mind-atlas-beta
  if ! nginx -t; then
    # 本体の nginx を壊さない: β の設定を外して終了する
    rm -f /etc/nginx/sites-enabled/mind-atlas-beta "$SITE"
    echo "nginx -t failed; beta site removed" >&2
    exit 1
  fi
  systemctl reload nginx
  echo "installed $SITE"
else
  echo "keeping existing $SITE (certbot manages its TLS lines)"
fi

echo "== TLS =="
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "certificate present"
else
  install -m 644 "$APP/deploy/beta/mind-atlas-beta-tls.service" /etc/systemd/system/mind-atlas-beta-tls.service
  install -m 644 "$APP/deploy/beta/mind-atlas-beta-tls.timer" /etc/systemd/system/mind-atlas-beta-tls.timer
  systemctl daemon-reload
  systemctl enable --now mind-atlas-beta-tls.timer >/dev/null 2>&1
  systemctl start mind-atlas-beta-tls.service || true
  if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then echo "certificate issued"; else echo "waiting for DNS: mind-atlas-beta-tls.timer retries every 5 minutes"; fi
fi

echo "== health =="
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 5 "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then break; fi
  sleep 2
done
systemctl is-active "$UNIT"
curl -fsS -m 10 "http://127.0.0.1:$PORT/health"
echo
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  curl -fsS -m 10 --resolve "$DOMAIN:443:127.0.0.1" -o /dev/null -w "nginx (https) -> %{http_code}\n" "https://$DOMAIN/.mind-atlas-build.json"
else
  curl -fsS -m 10 -H "Host: $DOMAIN" -o /dev/null -w "nginx (http) -> %{http_code}\n" http://127.0.0.1/.mind-atlas-build.json
fi
echo "legacy: $(systemctl is-active mind-atlas) $(curl -fsS -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:8788/health)"

echo "== pruning to one generation =="
find "$BACKUPS" -maxdepth 1 -type f -name '*.tar.gz' -print -delete
for old in "$BACKUPS"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-*; do
  if [ -d "$old" ] && [ "$(basename "$old")" != "$KEEP" ]; then
    echo "removing $(basename "$old")"
    rm -rf "$old"
  fi
done

echo "== deployed =="
cat "$APP/.deploy-commit"
cat "$APP/dist-spatial/.mind-atlas-build.json"
if [ -n "$KEEP" ]; then
  echo "rollback: systemctl stop $UNIT && rm -rf $APP && mv $BACKUPS/$KEEP $APP && systemctl start $UNIT"
fi
