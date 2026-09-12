import { LUT_PRESETS, loadLut } from '../../gl/luts';
import { setLook } from '../../store/actions';
import { useDocStore } from '../../store/docStore';
import { Slider } from '../controls/Slider';
import styles from './tools.module.css';

const FAMILIES = ['Film', 'Cinematic', 'Mono', 'Creative'] as const;

export function FiltersPanel() {
  const look = useDocStore((state) => state.present.look);

  return (
    <div>
      <p className={styles.sectionTitle}>Looks</p>
      <button
        type="button"
        className={`${styles.lookItem}${look.id === null ? ` ${styles.lookItemActive}` : ''}`}
        style={{ width: '100%' }}
        onClick={() => setLook(null)}
      >
        None
      </button>

      {FAMILIES.map((family) => (
        <div key={family}>
          <p className={styles.sectionTitle}>{family}</p>
          <div className={styles.lookGrid}>
            {LUT_PRESETS.filter((preset) => preset.family === family).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`${styles.lookItem}${look.id === preset.id ? ` ${styles.lookItemActive}` : ''}`}
                onClick={() => {
                  setLook(preset.id, look.amount || 1);
                  void loadLut(preset.id);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {look.id && (
        <>
          <p className={styles.sectionTitle}>Strength</p>
          <Slider
            label="Strength"
            value={Math.round(look.amount * 100)}
            min={0}
            max={100}
            onChange={(value) => setLook(look.id, value / 100)}
            unit="%"
          />
        </>
      )}
    </div>
  );
}
