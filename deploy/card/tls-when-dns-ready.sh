#!/usr/bin/env bash
# card.mind-atlas.org がこのサーバーを指したら証明書を取得し、公開 origin を card に切り替えて、
# 以後はタイマーを止める。mind-atlas-card-tls.timer から 5 分おきに呼ばれる。
# DNS 未設定の間は何もしないで終わる。
set -euo pipefail

DOMAIN=card.mind-atlas.org
APP=/opt/mind-atlas-card
UNIT=mind-atlas-card

switch_public_origin() {
  # ログインの戻り先・共有リンク・支払いの戻り先を card のドメインにする
  if [ -f "$APP/.env.service" ] && ! grep -q "^MIND_ATLAS_PUBLIC_ORIGIN=https://$DOMAIN$" "$APP/.env.service"; then
    sed -i "s|^MIND_ATLAS_PUBLIC_ORIGIN=.*|MIND_ATLAS_PUBLIC_ORIGIN=https://$DOMAIN|" "$APP/.env.service"
    systemctl restart "$UNIT"
    echo "public origin switched to https://$DOMAIN"
  fi
}

if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  switch_public_origin
  systemctl disable --now mind-atlas-card-tls.timer >/dev/null 2>&1 || true
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
switch_public_origin
systemctl disable --now mind-atlas-card-tls.timer >/dev/null 2>&1 || true
echo "certificate installed for $DOMAIN"
