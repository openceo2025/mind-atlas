import { t, type MessageKey } from '../../i18n';
import type { FloatWin } from '../../types';

const SHORTCUTS: [string, MessageKey][] = [
  ['Click / Shift+Click', 'help.select'],
  ['Drag', 'help.drag'],
  ['Alt+Drag', 'help.duplicate'],
  ['Double-click (empty)', 'help.create'],
  ['Double-click (card)', 'help.open'],
  ['Wheel / Pinch', 'help.zoom'],
  ['Space+Drag / 2 fingers', 'help.pan'],
  ['Ctrl+G', 'help.group'],
  ['Delete', 'help.delete'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'help.undo'],
  ['Ctrl+K', 'help.palette'],
  ['N', 'help.newCard'],
  ['1–6', 'help.presets'],
  ['F', 'help.fit'],
  ['Ctrl+V', 'help.paste'],
];

export function HelpWindow(_: { win: FloatWin }) {
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
