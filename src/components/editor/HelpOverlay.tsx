import { useUiStore } from '../../store/uiStore';
import styles from './editor.module.css';

const SHORTCUTS: [string, string][] = [
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
  ['⌘S', 'Export'],
  ['c / a / t / b', 'Crop / Adjust / Text / Draw'],
  ['e', 'Export'],
  ['[ / ]', 'Rotate 90°'],
  ['f', 'Flip horizontally'],
  ['0 / 1', 'Fit / 100%'],
  ['\\ (hold)', 'Compare original'],
  ['Esc / Enter', 'Cancel / commit'],
  ['?', 'Toggle this help'],
];

export function HelpOverlay() {
  const showHelp = useUiStore((state) => state.showHelp);
  const setShowHelp = useUiStore((state) => state.setShowHelp);
  if (!showHelp) return null;
  return (
    <div className={styles.helpOverlay} onClick={() => setShowHelp(false)} role="presentation">
      <div className={styles.helpPanel} role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <dl>
          {SHORTCUTS.map(([key, label]) => (
            <div key={key} style={{ display: 'contents' }}>
              <dt>{key}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
