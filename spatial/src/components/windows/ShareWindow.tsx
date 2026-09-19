import { useState } from 'react';
import { duplicateCurrentSpace, serializeSpace, setSharing, toast, toastError, useStore } from '../../store';
import { HOSTED, startLogin } from '../../lib/service';
import { exportJson, exportMarkdown } from '../../lib/importExport';
import { t } from '../../i18n';
import type { FloatWin } from '../../types';
import { Icon } from '../Icons';

export function shareUrl(token: string) {
  return `${window.location.origin}/s/${encodeURIComponent(token)}`;
}

export function ShareWindow(_: { win: FloatWin }) {
  const session = useStore((s) => s.session);
  const shareToken = useStore((s) => s.shareToken);
  const readOnly = useStore((s) => s.readOnly);
  const [busy, setBusy] = useState(false);
  const url = shareToken ? shareUrl(shareToken) : '';

  const toggle = (enabled: boolean) => {
    setBusy(true);
    void setSharing(enabled)
      .then((r) => {
        if (r?.shareToken) {
          void navigator.clipboard?.writeText(shareUrl(r.shareToken)).catch(() => undefined);
          toast(t('share.created'));
        } else if (!enabled) toast(t('share.disabled'));
      })
      .catch(toastError)
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className="fwin-body">
        {readOnly ? (
          <>
            <p className="lead">{t('share.viewing')}</p>
            <button className="btn primary" style={{ width: '100%' }} onClick={() => void duplicateCurrentSpace()}>
              <Icon name="copy" size={14} /> {t('share.remix')}
            </button>
          </>
        ) : !HOSTED ? (
          <p className="hint-block">{t('share.localOnly')}</p>
        ) : !session.authenticated ? (
          <>
            <p className="hint-block">{t('share.loginNeeded')}</p>
            <button className="btn primary" onClick={startLogin}>
              {t('account.login')}
            </button>
          </>
        ) : (
          <>
            <p className="hint-block">{t('share.intro')}</p>
            {url ? (
              <>
                <div className="row-gap">
                  <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} />
                  <button className="btn small" onClick={() => void navigator.clipboard?.writeText(url).then(() => toast(t('share.copied')))}>
                    <Icon name="copy" size={12} />
                  </button>
                </div>
                <button className="btn small ghost" style={{ marginTop: 8 }} disabled={busy} onClick={() => toggle(false)}>
                  {t('share.stop')}
                </button>
              </>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => toggle(true)}>
                <Icon name="link" size={14} /> {busy ? t('common.working') : t('share.create')}
              </button>
            )}
          </>
        )}
        <div className="sec-title">{t('share.export')}</div>
        <div className="row-gap">
          <button className="btn small" onClick={() => exportJson(serializeSpace())}>
            <Icon name="download" size={12} /> JSON
          </button>
          <button className="btn small" onClick={() => exportMarkdown(serializeSpace())}>
            <Icon name="download" size={12} /> Markdown
          </button>
        </div>
        <p className="muted small">{t('share.exportNote')}</p>
      </div>
    </>
  );
}
