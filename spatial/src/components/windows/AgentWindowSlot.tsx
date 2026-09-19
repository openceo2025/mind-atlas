import { lazy, Suspense } from 'react';
import { HOSTED } from '../../lib/service';
import { t } from '../../i18n';
import type { FloatWin } from '../../types';

// 開発者モード（エージェント母艦）はローカル専用。公開ビルドではこのモジュールごと読み込まない。
const AgentWindow = HOSTED ? null : lazy(() => import('../../devmode/AgentWindow'));

export function AgentWindowSlot({ win }: { win: FloatWin }) {
  if (!AgentWindow) return <div className="fwin-body">{t('agent.hostedUnavailable')}</div>;
  return (
    <Suspense fallback={<div className="fwin-body">{t('common.loading')}</div>}>
      <AgentWindow win={win} />
    </Suspense>
  );
}
