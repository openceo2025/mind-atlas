import { useState } from 'react';
import { refreshSession, saveToCloud, toastError, useStore } from '../../store';
import { HOSTED, logout, openBillingPortal, startCheckout, startLogin } from '../../lib/service';
import { embeddingStatus } from '../../lib/embeddings';
import { formatDateTime, t } from '../../i18n';
import type { FloatWin } from '../../types';
import { Icon } from '../Icons';

/** AIの残りは契約の期間ごとに満タンへ戻る。次に戻る日時と、あと何日か */
export function creditResetText(periodEnd: string) {
  const at = new Date(periodEnd).getTime();
  if (!Number.isFinite(at)) return '';
  const days = Math.max(0, Math.ceil((at - Date.now()) / 86_400_000));
  return t('account.creditResetsAt', { date: formatDateTime(at), n: days });
}

export function AccountWindow(_: { win: FloatWin }) {
  const session = useStore((s) => s.session);
  const cloudState = useStore((s) => s.cloudState);
  const scoreSource = useStore((s) => s.scoreSource);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn()
      .catch(toastError)
      .finally(() => setBusy(false));
  };
  const emb = embeddingStatus();

  if (!HOSTED) {
    return (
      <div className="fwin-body">
        <div className="account-card">
          <Icon name="terminal" size={22} />
          <div>
            <b>{t('account.localTitle')}</b>
            <p className="muted">{t('account.localBody')}</p>
          </div>
        </div>
        <div className="kv">
          <span>{t('account.bridge')}</span>
          <b className={session.bridgeOnline ? 'ok' : 'bad'}>{session.bridgeOnline ? t('account.online') : t('account.offline')}</b>
          <span>{t('account.semantic')}</span>
          <b>{scoreSource === 'server' ? t('account.semanticServer', { model: emb.model }) : t('account.semanticLocal')}</b>
        </div>
        {!session.bridgeOnline && <div className="ai-note warn">{t('account.bridgeHint')}</div>}
        <button className="btn small" style={{ marginTop: 10 }} onClick={() => run(refreshSession)} disabled={busy}>
          <Icon name="refresh" size={12} /> {t('account.recheck')}
        </button>
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <div className="fwin-body">
        <p className="lead">{t('account.pitch')}</p>
        <ul className="bullets">
          <li>{t('account.benefitSync')}</li>
          <li>{t('account.benefitShare')}</li>
          <li>{t('account.benefitAi')}</li>
        </ul>
        <button className="btn primary google" style={{ width: '100%', marginTop: 12 }} onClick={startLogin}>
          <Icon name="user" size={15} /> {t('account.login')}
        </button>
        <p className="muted small" style={{ marginTop: 10 }}>
          {t('account.freeNote')}
        </p>
      </div>
    );
  }

  const user = session.user!;
  const percent = session.creditPercent;
  return (
    <>
      <div className="fwin-body">
        <div className="account-card">
          {user.pictureUrl ? <img className="avatar" src={user.pictureUrl} alt="" referrerPolicy="no-referrer" /> : <Icon name="user" size={22} />}
          <div className="ellipsis">
            <b>{user.name || user.email}</b>
            <div className="muted small ellipsis">{user.email}</div>
          </div>
        </div>
        <dl className="kv">
          <dt>{t('account.plan')}</dt>
          <dd>
            {session.subscriptionActive ? (
              <b className="ok">{t('account.planActive')}</b>
            ) : (
              <span>{t('account.planFree')}</span>
            )}
            {session.subscription?.cancelAtPeriodEnd && <span className="muted"> · {t('account.cancelling')}</span>}
          </dd>
          {session.subscriptionActive && (
            <>
              <dt>{t('account.credit')}</dt>
              <dd>
                <div className="meter" style={{ marginTop: 6 }}>
                  <i style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%`, background: (percent ?? 0) > 15 ? 'var(--accent)' : 'var(--danger)' }} />
                </div>
                <span className="small">{percent === null ? '—' : `${Math.round(percent)}%`}</span>
              </dd>
              {session.subscription?.currentPeriodEnd && (
                <>
                  <dt>{t('account.creditResets')}</dt>
                  <dd>{creditResetText(session.subscription.currentPeriodEnd)}</dd>
                </>
              )}
            </>
          )}
          {/* 購読中は「次のリセット」が同じ日を示すので、更新日は重ねて出さない */}
          {session.subscription?.currentPeriodEnd && !session.subscriptionActive && (
            <>
              <dt>{t('account.renews')}</dt>
              <dd>{new Date(session.subscription.currentPeriodEnd).toLocaleDateString()}</dd>
            </>
          )}
          <dt>{t('account.cloud')}</dt>
          <dd>
            {t(`account.cloud.${cloudState}` as 'account.cloud.off')}{' '}
            <button className="btn small ghost" onClick={() => run(saveToCloud)} disabled={busy}>
              <Icon name="cloud" size={12} /> {t('account.syncNow')}
            </button>
          </dd>
          <dt>{t('account.semantic')}</dt>
          <dd>{scoreSource === 'server' ? t('account.semanticServer', { model: emb.model }) : t('account.semanticLocal')}</dd>
        </dl>
        {!session.subscriptionActive && (
          <div className="ai-note" style={{ marginTop: 10 }}>
            <Icon name="sparkle" size={16} />
            <span>{t('account.subscribePitch')}</span>
          </div>
        )}
      </div>
      <div className="fwin-foot">
        {session.subscriptionActive ? (
          <button className="btn small" disabled={busy} onClick={() => run(openBillingPortal)}>
            {t('account.manageBilling')}
          </button>
        ) : (
          <button className="btn small primary" disabled={busy} onClick={() => run(startCheckout)}>
            {t('account.subscribe')}
          </button>
        )}
        <button className="btn small ghost" style={{ marginInlineStart: 'auto' }} disabled={busy} onClick={() => run(async () => { await logout(); await refreshSession(); })}>
          <Icon name="logout" size={12} /> {t('account.logout')}
        </button>
      </div>
    </>
  );
}
