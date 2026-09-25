#!/usr/bin/env bash
# beta.mind-atlas.org がこのサーバーを指したら証明書を取得し、以後はタイマーを止める。
# mind-atlas-beta-tls.timer から 5 分おきに呼ばれる。DNS 未設定の間は何もしないで終わる。
set -euo pipefail

DOMAIN=beta.mind-atlas.org

if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  systemctl disable --now mind-atlas-beta-tls.timer >/dev/null 2>&1 || true
  exit 0
fi

RESOLVED=$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)
if [ -z "$RESOLVED" ]; then
  echo "$DOMAIN does not resolve yet"
  exit 0
fi
if ! ip -4 -o addr show | grep -q " $RESOLVED/"; then
  echo "$DOMAIN resolves to $RESOLVED, which is not this server"
  exit 0
fi

echo "$DOMAIN resolves to this server ($RESOLVED); requesting a certificate"
certbot --nginx -d "$DOMAIN" --redirect --non-interactive --keep-until-expiring
nginx -t
systemctl reload nginx
systemctl disable --now mind-atlas-beta-tls.timer >/dev/null 2>&1 || true
echo "certificate installed for $DOMAIN"
