import { useEffect, useRef, useState } from 'react';
import {
  closeWindow,
  createBlankSpace,
  createDemoSpace,
  deleteSpace,
  duplicateCurrentSpace,
  importDrafts,
  importSpace,
  openCloudSpace,
  openSpaceById,
  refreshCloudList,
  renameSpace,
  toast,
  toastError,
  useStore,
} from '../../store';
import { AXIS_PRESETS } from '../../data/concepts';
import { parseText } from '../../lib/importExport';
import { formatDateTime, t } from '../../i18n';
import type { FloatWin } from '../../types';
import { Icon } from '../Icons';

export function SpacesWindow({ win }: { win: FloatWin }) {
  const spaces = useStore((s) => s.spaces);
  const current = useStore((s) => s.spaceId);
  const title = useStore((s) => s.title);
  const authenticated = useStore((s) => s.session.authenticated);
  const [newTitle, setNewTitle] = useState('');
  const [preset, setPreset] = useState(AXIS_PRESETS[0].id);
  const [editing, setEditing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (authenticated) void refreshCloudList().catch(() => undefined);
  }, [authenticated]);

  const open = async (id: string, cloudId?: string, cloudOnly?: boolean) => {
    try {
      if (cloudOnly && cloudId) await openCloudSpace(cloudId);
      else await openSpaceById(id);
      closeWindow(win.id);
    } catch (e) {
      toastError(e);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      if (/\.json$/i.test(file.name) || text.trim().startsWith('{')) {
        await importSpace(JSON.parse(text));
        toast(t('spaces.imported'));
      } else {
        const drafts = parseText(text);
        importDrafts(drafts);
        toast(t('spaces.importedCards', { n: drafts.length }));
      }
      closeWindow(win.id);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      <div className="fwin-body">
        <div className="sec-title" style={{ marginTop: 0 }}>
          {t('spaces.current')}
        </div>
        {editing ? (
          <input
            className="title-input"
            autoFocus
            defaultValue={title}
            onBlur={(e) => {
              renameSpace(e.target.value);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              e.preventDefault();
              e.stopPropagation();
              (e.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <div className="row-gap">
            <b className="ellipsis" style={{ flex: 1 }}>
              {title}
            </b>
            <button className="btn small ghost" onClick={() => setEditing(true)}>
              <Icon name="edit" size={12} /> {t('spaces.rename')}
            </button>
            <button className="btn small ghost" onClick={() => void duplicateCurrentSpace()}>
              <Icon name="copy" size={12} />
            </button>
          </div>
        )}

        <div className="sec-title">{t('spaces.all', { n: spaces.length })}</div>
        <div className="space-list">
          {spaces.map((m) => (
            <div key={m.id} className={`space-row ${m.id === current ? 'current' : ''}`}>
              <button className="space-open" onClick={() => void open(m.id, m.cloudId, m.cloudOnly)} disabled={m.id === current}>
                <Icon name={m.cloudOnly ? 'cloud' : 'layers'} size={14} />
                <span className="ellipsis">
                  <b>{m.title}</b>
                  <small>
                    {t('spaces.meta', { n: m.cardCount, time: formatDateTime(m.updatedAt) })}
                    {m.cloudId && !m.cloudOnly ? ` · ${t('spaces.synced')}` : ''}
                    {m.cloudOnly ? ` · ${t('spaces.cloudOnly')}` : ''}
                  </small>
                </span>
              </button>
              {!m.cloudOnly && (
                <button
                  className="icon-btn small"
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                  onClick={() => {
                    const alsoCloud = Boolean(m.cloudId) && window.confirm(t('spaces.deleteCloudConfirm'));
                    if (!alsoCloud && !window.confirm(t('spaces.deleteConfirm', { title: m.title }))) return;
                    void deleteSpace(m.id, alsoCloud);
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="sec-title">{t('spaces.new')}</div>
        <div className="form-grid">
          <input className="input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t('spaces.newPlaceholder')} />
          <div className="row-gap">
            <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)} aria-label={t('spaces.startAxes')}>
              {AXIS_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t('spaces.startWith', { name: t(p.name) })}
                </option>
              ))}
            </select>
            <button
              className="btn small primary"
              onClick={() => {
                void createBlankSpace(newTitle.trim() || t('space.untitled'), preset).then(() => closeWindow(win.id));
              }}
            >
              <Icon name="plus" size={12} /> {t('spaces.create')}
            </button>
          </div>
        </div>
      </div>
      <div className="fwin-foot">
        <button className="btn small" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={12} /> {t('spaces.import')}
        </button>
        <button className="btn small ghost" onClick={() => void createDemoSpace().then(() => closeWindow(win.id))}>
          {t('spaces.demo')}
        </button>
        <input ref={fileRef} type="file" accept=".json,.md,.markdown,.txt,application/json,text/markdown,text/plain" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
    </>
  );
}
