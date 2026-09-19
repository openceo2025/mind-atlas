#!/usr/bin/env bash
# MindAtlas β を beta.mind-atlas.org（ConoHa VPS）へデプロイする。Git Bash から実行する:
#   bash deploy/beta/deploy-beta.sh
#
# 単位は push 済みコミットの git archive。VPS 側の手順は deploy/beta/remote-deploy.sh。
# スクリプトは ssh の標準入力に流さず、scp で送ってからパスで実行する（改行や BOM が壊れないように）。
set -euo pipefail

HOST="${MIND_ATLAS_VPS_HOST:-160.251.141.158}"
USER_AT="root@$HOST"
KEY="${MIND_ATLAS_VPS_KEY_PATH:-$HOME/.ssh/mind-atlas-api-key-01.pem}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20 -i "$KEY")

cd "$(git rev-parse --show-toplevel)"
[ -f "$KEY" ] || { echo "SSH key not found: $KEY" >&2; exit 1; }

if [ -n "$(git status --porcelain)" ] && [ "${ALLOW_DIRTY:-0}" != 1 ]; then
  echo "The working tree has uncommitted changes. Commit them, or set ALLOW_DIRTY=1 to deploy HEAD anyway." >&2
  exit 1
fi
BRANCH=$(git rev-parse --abbrev-ref HEAD)
SHA=$(git rev-parse HEAD)
git fetch -q origin "$BRANCH"
AHEAD=$(git rev-list --count "origin/$BRANCH..HEAD")
if [ "$AHEAD" != 0 ]; then
  echo "HEAD is $AHEAD commit(s) ahead of origin/$BRANCH. Push first." >&2
  exit 1
fi
echo "deploying $BRANCH @ $SHA to $HOST"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
git archive --format=tar.gz -o "$STAGE/$SHA.tar.gz" HEAD
git show "HEAD:deploy/beta/remote-deploy.sh" > "$STAGE/remote-deploy.sh"
echo "archive: $(du -h "$STAGE/$SHA.tar.gz" | cut -f1)"

ssh "${SSH_OPTS[@]}" "$USER_AT" "mkdir -p /opt/mind-atlas-beta-backups && chmod 700 /opt/mind-atlas-beta-backups"
scp "${SSH_OPTS[@]}" "$STAGE/$SHA.tar.gz" "$USER_AT:/opt/mind-atlas-beta-backups/$SHA.tar.gz"
scp "${SSH_OPTS[@]}" "$STAGE/remote-deploy.sh" "$USER_AT:/tmp/mind-atlas-beta-deploy.sh"
ssh "${SSH_OPTS[@]}" "$USER_AT" "bash /tmp/mind-atlas-beta-deploy.sh $SHA && rm -f /tmp/mind-atlas-beta-deploy.sh"
echo "deploy finished: $SHA"
