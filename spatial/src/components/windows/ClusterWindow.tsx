import { fitView, group, proposeClusters, select, set, useStore } from '../../store';
import { t } from '../../i18n';
import type { FloatWin } from '../../types';
import { Icon } from '../Icons';
import { useAiBlock } from './common';

export function ClusterWindow(_: { win: FloatWin }) {
  const clusters = useStore((s) => s.clusters);
  const cards = useStore((s) => s.cards);
  const readOnly = useStore((s) => s.readOnly);
  const block = useAiBlock();

  if (!clusters) {
    return (
      <div className="fwin-body">
        <p className="hint-block">{t('cluster.cleared')}</p>
        <button className="btn primary" onClick={() => void proposeClusters(!block)}>
          <Icon name="organize" size={14} /> {t('cluster.recompute')}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="fwin-body">
        <p className="hint-block">{t('cluster.intro', { n: clusters.length })}</p>
        {clusters.map((cl) => {
          const ms = cl.cardIds.map((id) => cards[id]).filter((c) => c?.place === 'canvas');
          const col = `hsl(${cl.hue} 90% 65%)`;
          return (
            <div key={cl.id} className="cluster-row" style={{ borderColor: `hsl(${cl.hue} 90% 65% / .45)` }}>
              <b style={{ color: col }}>{cl.label}</b>
              <p>{ms.map((c) => c.title).join(' · ')}</p>
              <div className="row-gap">
                <button
                  className="btn small"
                  onClick={() => {
                    select(ms.map((c) => c.id));
                    fitView(ms.map((c) => c.id));
                  }}
                >
                  {t('cluster.focus')}
                </button>
                {!readOnly && (
                  <button className="btn small" disabled={ms.length < 2} onClick={() => group(ms.map((c) => c.id), cl.label)}>
                    <Icon name="bundle" size={12} /> {t('cluster.bundle')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="fwin-foot">
        <button className="btn small" onClick={() => void proposeClusters(!block)}>
          <Icon name="refresh" size={12} /> {t('cluster.recompute')}
        </button>
        <button className="btn small ghost" style={{ marginInlineStart: 'auto' }} onClick={() => set({ clusters: null })}>
          {t('cluster.hide')}
        </button>
      </div>
    </>
  );
}
