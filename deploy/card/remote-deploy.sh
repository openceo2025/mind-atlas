#!/usr/bin/env bash
# マインドアトラス（カード）単独版の VPS 側デプロイ。root で実行する: bash /tmp/mind-atlas-card-deploy.sh <sha>
#
# card.mind-atlas.org（と旧 beta.mind-atlas.org）→ 127.0.0.1:8789。
# 本体（/opt/mind-atlas, :8788）には触れない。本体もカードアプリを /card/ で配信しているので、
# ここはカードから始めたい人のための入口。同じ PostgreSQL を共有し、カード用のテーブルを
# 追加するだけ（spatial:migrate）。マイグレーションの前に必ず pg_dump でバックアップを取る。
# .env.service は本体の .env.service から毎回作り直し、カード用の値だけ上書きする（値は表示しない）。
#
# 旧 β（mind-atlas-beta / /opt/mind-atlas-beta）からの移行も行う：新しい木を組み立て終えてから
# β のサービスを止め、同じポートでカードのサービスを起動する。beta.mind-atlas.org の nginx 設定は
# そのまま残し、同じポートへ流す（β で端末に保存したスペースを新しい場所へ移せるように）。
set -euo pipefail

SHA="${1:?usage: remote-deploy.sh <sha>}"
APP=/opt/mind-atlas-card
BACKUPS=/opt/mind-atlas-card-backups
DB_BACKUPS="$BACKUPS/db"
MAIN_ENV=/opt/mind-atlas/.env.service
UNIT=mind-atlas-card
PORT=8789
DOMAIN=card.mind-atlas.org
LEGACY_DOMAIN=beta.mind-atlas.org
LEGACY_UNIT=mind-atlas-beta
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUPS/$SHA.tar.gz"

[ -f "$ARCHIVE" ] || { echo "archive not found: $ARCHIVE" >&2; exit 1; }
[ -f "$MAIN_ENV" ] || { echo "main service env not found: $MAIN_ENV" >&2; exit 1; }
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

# 公開の origin は、card の証明書ができるまでは beta のまま（ログインの戻り先が名前解決できるように）。
# 証明書ができたら tls-when-dns-ready.sh が card に切り替えてサービスを再起動する。
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  PUBLIC_DOMAIN=$DOMAIN
else
  PUBLIC_DOMAIN=$LEGACY_DOMAIN
fi

echo "== env: derived from the main service with card overrides (values not shown) =="
OVERRIDE_KEYS='MIND_ATLAS_SERVICE_HOST|MIND_ATLAS_SERVICE_PORT|MIND_ATLAS_PUBLIC_ORIGIN|MIND_ATLAS_ALLOWED_ORIGIN|MIND_ATLAS_DIST_DIR|MIND_ATLAS_CARD_DIST_DIR|MIND_ATLAS_ANALYTICS_ENABLED|MIND_ATLAS_CLIENT_ANALYTICS_ENABLED|MIND_ATLAS_MAINTENANCE_INTERVAL_MS'
TMP_ENV=$(mktemp)
grep -vE "^(${OVERRIDE_KEYS})=" "$MAIN_ENV" > "$TMP_ENV" || true
{
  echo
  echo "# --- Mind Atlas (Cards) overrides (deploy/card/remote-deploy.sh) ---"
  echo "MIND_ATLAS_SERVICE_HOST=127.0.0.1"
  echo "MIND_ATLAS_SERVICE_PORT=$PORT"
  echo "MIND_ATLAS_PUBLIC_ORIGIN=https://$PUBLIC_DOMAIN"
  echo "MIND_ATLAS_ALLOWED_ORIGIN=https://$DOMAIN,https://$LEGACY_DOMAIN"
  # / と /card/ のどちらもカードアプリを返す
  echo "MIND_ATLAS_DIST_DIR=dist-spatial"
  echo "MIND_ATLAS_CARD_DIST_DIR=dist-spatial"
  # カード単独版のアクセスで本体のアナリティクスを汚さない
  echo "MIND_ATLAS_ANALYTICS_ENABLED=0"
  echo "MIND_ATLAS_CLIENT_ANALYTICS_ENABLED=0"
  # セッション掃除・クレジット返金は本体だけが行う（共有 DB で二重に走らせない）
  echo "MIND_ATLAS_MAINTENANCE_INTERVAL_MS=0"
} >> "$TMP_ENV"
install -o root -g www-data -m 640 "$TMP_ENV" "$APP/.env.service"
rm -f "$TMP_ENV"
echo "keys: $(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$APP/.env.service")"
echo "public origin: https://$PUBLIC_DOMAIN"

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
# 旧 β のサービスは同じポートを使う。新しい木ができてから止める
if systemctl list-unit-files "$LEGACY_UNIT.service" >/dev/null 2>&1 && systemctl is-enabled "$LEGACY_UNIT" >/dev/null 2>&1; then
  echo "retiring $LEGACY_UNIT (its tree stays at /opt/mind-atlas-beta for rollback)"
  systemctl disable --now "$LEGACY_UNIT" >/dev/null 2>&1 || true
fi
systemctl disable --now mind-atlas-beta-tls.timer >/dev/null 2>&1 || true
install -m 644 "$APP/deploy/card/$UNIT.service" "/etc/systemd/system/$UNIT.service"
systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null 2>&1
systemctl restart "$UNIT"

echo "== nginx =="
SITE=/etc/nginx/sites-available/mind-atlas-card
if [ ! -f "$SITE" ]; then
  install -m 644 "$APP/deploy/card/nginx-card.conf" "$SITE"
  ln -sf "$SITE" /etc/nginx/sites-enabled/mind-atlas-card
  if ! nginx -t; then
    # 本体の nginx を壊さない: カードの設定を外して終了する
    rm -f /etc/nginx/sites-enabled/mind-atlas-card "$SITE"
    echo "nginx -t failed; card site removed" >&2
    exit 1
  fi
  systemctl reload nginx
  echo "installed $SITE"
else
  echo "keeping existing $SITE (certbot manages its TLS lines)"
fi
if [ -f /etc/nginx/sites-enabled/mind-atlas-beta ]; then
  echo "keeping $LEGACY_DOMAIN -> 127.0.0.1:$PORT (now served by $UNIT)"
fi

echo "== TLS =="
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "certificate present"
else
  install -m 644 "$APP/deploy/card/mind-atlas-card-tls.service" /etc/systemd/system/mind-atlas-card-tls.service
  install -m 644 "$APP/deploy/card/mind-atlas-card-tls.timer" /etc/systemd/system/mind-atlas-card-tls.timer
  systemctl daemon-reload
  systemctl enable --now mind-atlas-card-tls.timer >/dev/null 2>&1
  systemctl start mind-atlas-card-tls.service || true
  if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then echo "certificate issued"; else echo "waiting for DNS: mind-atlas-card-tls.timer retries every 5 minutes"; fi
fi

echo "== health =="
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 5 "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then break; fi
  sleep 2
done
systemctl is-active "$UNIT"
curl -fsS -m 10 "http://127.0.0.1:$PORT/health"
echo
for host in "$DOMAIN" "$LEGACY_DOMAIN"; do
  if [ -d "/etc/letsencrypt/live/$host" ]; then
    curl -fsS -m 10 --resolve "$host:443:127.0.0.1" -o /dev/null -w "$host (https) -> %{http_code}\n" "https://$host/card/" || true
  else
    curl -fsS -m 10 -H "Host: $host" -o /dev/null -w "$host (http) -> %{http_code}\n" http://127.0.0.1/card/ || true
  fi
done
echo "main: $(systemctl is-active mind-atlas) $(curl -fsS -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:8788/health)"

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
elif [ -d /opt/mind-atlas-beta ]; then
  echo "rollback to beta: systemctl disable --now $UNIT && systemctl enable --now $LEGACY_UNIT"
fi
