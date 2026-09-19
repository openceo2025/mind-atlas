import { useState } from 'react';
import { REL_STYLE, relLabel } from '../lib/relStyle';
import { t } from '../i18n';
import type { RelationType } from '../types';

const SHOWN: RelationType[] = ['related', 'derived', 'source', 'supports', 'contradicts', 'compared-with', 'contains'];

export function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="legend" onPointerDown={(e) => e.stopPropagation()}>
      <button className="legend-head" onClick={() => setOpen((v) => !v)}>
        <span>{t('legend.title')}</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <>
          {SHOWN.map((type) => (
            <div key={type} className="legend-row">
              <svg width="30" height="8">
                <line x1="1" y1="4" x2="29" y2="4" stroke={REL_STYLE[type].color} strokeWidth="2" strokeDasharray={REL_STYLE[type].dash} strokeLinecap="round" />
              </svg>
              {relLabel(type)}
            </div>
          ))}
          <div className="legend-row">
            <svg width="30" height="8">
              <line x1="1" y1="4" x2="29" y2="4" stroke="#6ae3ff" strokeWidth="2" strokeDasharray="5 6" />
            </svg>
            {t('legend.suggested')}
          </div>
          <div className="legend-row" style={{ marginTop: 4 }}>
            <span style={{ display: 'inline-flex', gap: 2, width: 30 }}>
              {[0, 1, 2].map((i) => (
                <i key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-2)' }} />
              ))}
            </span>
            {t('legend.meaning')}
          </div>
          <div className="legend-row">
            <span style={{ width: 30, display: 'inline-flex', justifyContent: 'center', color: 'var(--gold)' }}>✋</span>
            {t('legend.human')}
          </div>
          <div className="legend-row">
            <span style={{ width: 30, height: 10, border: '1.5px solid var(--gold)', borderRadius: 3 }} />
            {t('legend.axis')}
          </div>
        </>
      )}
    </div>
  );
}
