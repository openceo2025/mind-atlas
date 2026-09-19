import { t, type MessageKey } from '../../i18n';
import type { FloatWin } from '../../types';

// キー名（Ctrl, Shift など）はそのまま、操作の言葉だけ翻訳する
function shortcuts(): [string, MessageKey][] {
  const click = t('key.click');
  const drag = t('key.drag');
  return [
    [`${click} / Shift+${click}`, 'help.select'],
    [drag, 'help.drag'],
    [`Alt+${drag}`, 'help.duplicate'],
    [t('key.doubleClickEmpty'), 'help.create'],
    [t('key.doubleClickCard'), 'help.open'],
    [t('key.wheelPinch'), 'help.zoom'],
    [`Space+${drag} / ${t('key.twoFingers')}`, 'help.pan'],
    ['Ctrl+G', 'help.group'],
    ['Delete', 'help.delete'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'help.undo'],
    ['Ctrl+K', 'help.palette'],
    ['N', 'help.newCard'],
    ['1–6', 'help.presets'],
    ['F', 'help.fit'],
    ['Ctrl+V', 'help.paste'],
  ];
}

export function HelpWindow(_: { win: FloatWin }) {
  const SHORTCUTS = shortcuts();
  return (
    <div className="fwin-body">
      <p className="lead">{t('help.lead')}</p>
      <ol className="steps">
        <li>{t('help.step1')}</li>
        <li>{t('help.step2')}</li>
        <li>{t('help.step3')}</li>
        <li>{t('help.step4')}</li>
      </ol>
      <div className="sec-title">{t('help.shortcuts')}</div>
      <table className="shortcut-table">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{t(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{t('help.privacy')}</p>
    </div>
  );
}
