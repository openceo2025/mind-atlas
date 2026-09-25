import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  deleteCards,
  aiBlock,
  applyAxes,
  canvasCards,
  createBlankSpace,
  createCard,
  ensureConcept,
  fitView,
  createChild,
  group,
  openWindow,
  proposeClusters,
  redo,
  relayout,
  revealCard,
  screenToWorld,
  set,
  setDraftAxes,
  suggestRelations,
  toggleToolWindow,
  undo,
  useStore,
} from '../store';
import { AXIS_PRESETS } from '../data/concepts';
import { HOSTED } from '../lib/service';
import { t } from '../i18n';

interface Cmd {
  id: string;
  label: string;
  hint: string;
  run: () => void;
  enabled?: boolean;
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const selection = useStore((s) => s.selection);
  const readOnly = useStore((s) => s.readOnly);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
    }
  }, [open]);

  const cmds = useMemo<Cmd[]>(() => {
    if (!open) return [];
    const n = selection.length;
    const p = selection[selection.length - 1];
    const edit = !readOnly;
    const base: Cmd[] = [
      {
        id: 'new',
        label: t('cmd.newCard'),
        hint: 'N',
        enabled: edit,
        run: () => {
          const { viewport } = useStore.getState();
          const id = createCard({ kind: 'note', title: t('card.newTitle') }, screenToWorld(viewport.w / 2, viewport.h / 2));
          openWindow('detail', [id], { focusTitle: true });
        },
      },
      { id: 'sum', label: t('cmd.summary'), hint: 'AI', enabled: n > 0, run: () => openWindow('summary', selection) },
      { id: 'child', label: t('cmd.child'), hint: '', enabled: edit && n >= 1, run: () => createChild(p) },
      { id: 'chat', label: t('cmd.chat'), hint: 'AI', run: () => (n ? openWindow('chat', selection.slice(0, 12)) : toggleToolWindow('assistant')) },
      { id: 'web', label: t('cmd.search'), hint: 'Web', run: () => toggleToolWindow('search') },
      { id: 'voice', label: t('cmd.voice'), hint: 'AI', run: () => toggleToolWindow('voice') },
      { id: 'grp', label: t('cmd.group'), hint: 'Ctrl+G', enabled: edit && n >= 2, run: () => group(selection) },
      { id: 'del', label: n > 1 ? t('cmd.deleteMany', { n }) : t('common.delete'), hint: 'Delete', enabled: edit && n >= 1, run: () => deleteCards(selection) },
      { id: 'ext', label: t('cmd.extract'), hint: '', enabled: n > 0, run: () => openWindow('extract', [p]) },
      { id: 'rel', label: t('cmd.relations'), hint: '✦', enabled: edit, run: () => (openWindow('relations', selection), void suggestRelations(n ? selection : undefined, !aiBlock())) },
      { id: 'cl', label: t('cmd.clusters'), hint: '', run: () => (void proposeClusters(!aiBlock()), toggleToolWindow('cluster')) },
      { id: 'axis', label: t('cmd.axes'), hint: '', run: () => toggleToolWindow('axis') },
      ...AXIS_PRESETS.map((pr, i) => ({
        id: pr.id,
        label: t('cmd.preset', { name: t(pr.name) }),
        hint: String(i + 1),
        enabled: edit,
        run: () => {
          const [x, y, z] = pr.axes.map((k) => ensureConcept(k));
          setDraftAxes({ x, y, z });
        },
      })),
      ...AXIS_PRESETS.map((pr) => ({
        id: `${pr.id}-now`,
        label: t('cmd.presetNow', { name: t(pr.name) }),
        hint: '',
        enabled: edit,
        run: () => {
          const [x, y, z] = pr.axes.map((k) => ensureConcept(k));
          applyAxes({ x, y, z });
        },
      })),
      { id: 'lay', label: t('cmd.relayout'), hint: '', run: () => relayout() },
      { id: 'fit', label: t('cmd.fit'), hint: 'F', run: () => fitView() },
      { id: 'undo', label: t('cmd.undo'), hint: 'Ctrl+Z', enabled: edit, run: () => undo() },
      { id: 'redo', label: t('cmd.redo'), hint: 'Ctrl+Shift+Z', enabled: edit, run: () => redo() },
      { id: 'spaces', label: t('cmd.spaces'), hint: '', run: () => toggleToolWindow('spaces') },
      { id: 'newspace', label: t('cmd.newSpace'), hint: '', run: () => void createBlankSpace() },
      { id: 'share', label: t('cmd.share'), hint: '', run: () => toggleToolWindow('share') },
      { id: 'account', label: t('cmd.account'), hint: '', run: () => toggleToolWindow('account') },
      { id: 'settings', label: t('cmd.settings'), hint: '', run: () => toggleToolWindow('settings') },
      { id: 'help', label: t('cmd.help'), hint: '?', run: () => toggleToolWindow('help') },
      ...(!HOSTED ? [{ id: 'agent', label: t('cmd.agent'), hint: 'dev', run: () => toggleToolWindow('agent') }] : []),
    ];
    const cardCmds: Cmd[] = canvasCards().map((c) => ({ id: `card-${c.id}`, label: t('cmd.goto', { title: c.title }), hint: c.tags[0] ? `#${c.tags[0]}` : '', run: () => revealCard(c.id) }));
    const s = q.trim().toLowerCase();
    return [...base, ...cardCmds].filter((c) => c.enabled !== false).filter((c) => !s || c.label.toLowerCase().includes(s) || c.hint.toLowerCase().includes(s));
  }, [open, q, selection, readOnly]);

  if (!open) return null;
  const close = () => set({ paletteOpen: false });
  const exec = (c?: Cmd) => {
    if (!c) return;
    close();
    c.run();
  };

  return (
    <div className="palette-backdrop" onPointerDown={close}>
      <motion.div className="palette" role="dialog" aria-label={t('topbar.palette')} initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} onPointerDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          placeholder={selection.length ? t('cmd.placeholderSelected', { n: selection.length }) : t('cmd.placeholder')}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIdx((i) => Math.min(cmds.length - 1, i + 1));
            else if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1));
            else if (e.key === 'Enter' && !e.nativeEvent.isComposing) exec(cmds[idx]);
            else if (e.key === 'Escape') close();
            else return;
            e.preventDefault();
          }}
        />
        <div className="palette-list">
          {cmds.map((c, i) => (
            <button key={c.id} className={`palette-item ${i === idx ? 'active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => exec(c)}>
              <span>{c.label}</span>
              <small>{c.hint}</small>
            </button>
          ))}
          {cmds.length === 0 && <div className="empty-note">{t('cmd.none')}</div>}
        </div>
      </motion.div>
    </div>
  );
}
