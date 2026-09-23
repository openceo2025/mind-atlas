import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { addNote, fromShelf, screenToWorld, useStore } from '../store';
import { startGhostDrag } from '../lib/drag';
import { t } from '../i18n';
import { Icon, KindIcon } from './Icons';

export function Shelf() {
  const items = useStore(useShallow((s) => Object.values(s.cards).filter((c) => c.place === 'shelf')));
  const over = useStore((s) => s.dropTarget === 'shelf');
  const dragging = useStore((s) => s.draggingIds.length > 0 && !s.ghost);
  const readOnly = useStore((s) => s.readOnly);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');

  if (readOnly && !items.length) return null;

  const placeAtCenter = (id: string) => {
    const { viewport } = useStore.getState();
    const w = screenToWorld(viewport.w / 2, viewport.h / 2 - 40);
    fromShelf(id, w.x, w.y);
  };

  return (
    <div className={`shelf ${over ? 'over' : ''}`} data-drop="shelf" onPointerDown={(e) => e.stopPropagation()}>
      <div className="shelf-label">
        <Icon name="shelf" size={14} />
        <span>{t('shelf.title', { n: items.length })}</span>
      </div>
      <div className="shelf-items">
        {items.length === 0 && <span className="shelf-empty">{t('shelf.empty')}</span>}
        {items.map((c) => (
          <button key={c.id} className="shelf-item" title={t('shelf.itemHint')} onPointerDown={(e) => !readOnly && startGhostDrag(e, c, { onClick: () => placeAtCenter(c.id) })}>
            <KindIcon card={c} />
            <span style={{ minWidth: 0 }}>
              <b>{c.title}</b>
              <small>{c.subtitle ?? t(`kind.${c.kind}` as 'kind.note')}</small>
            </span>
          </button>
        ))}
      </div>
      {dragging && <span className="shelf-drop-hint">{t('shelf.dropHint')}</span>}
      {!readOnly &&
        (adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addNote(text);
              setText('');
              setAdding(false);
            }}
            className="shelf-form"
          >
            <input
              autoFocus
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => !text && setAdding(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setAdding(false);
                if (e.key === 'Enter') e.stopPropagation();
              }}
              placeholder={t('shelf.notePlaceholder')}
            />
          </form>
        ) : (
          <button className="btn shelf-add" onClick={() => setAdding(true)} title={t('shelf.noteHint')}>
            <Icon name="plus" size={16} />
            <span>{t('shelf.note')}</span>
          </button>
        ))}
    </div>
  );
}
