import { DialSlider } from '../controls/DialSlider';
import { SegmentedControl } from '../controls/SegmentedControl';
import { removeHealSpot, removeRedEyeAt, setRetouchSmooth } from '../../store/actions';
import { useDocStore } from '../../store/docStore';
import { useUiStore } from '../../store/uiStore';
import styles from './tools.module.css';

export function RetouchPanel() {
  const retouch = useDocStore((state) => state.present.retouch);
  const retouchMode = useUiStore((state) => state.retouchMode);
  const setRetouchMode = useUiStore((state) => state.setRetouchMode);
  const retouchRadius = useUiStore((state) => state.retouchRadius);
  const setRetouchRadius = useUiStore((state) => state.setRetouchRadius);

  return (
    <div>
      <p className={styles.hint}>
        Smooth applies everywhere; heal and red-eye are placed by tapping the photo.
      </p>

      <p className={styles.sectionTitle}>Skin smoothing</p>
      <DialSlider
        label="Smooth"
        value={retouch.smooth}
        min={0}
        max={100}
        step={1}
        neutral={0}
        unit="%"
        onChange={setRetouchSmooth}
        onInteractionStart={() => useDocStore.getState().beginInteraction('retouch:smooth')}
        onInteractionEnd={() => useDocStore.getState().endInteraction()}
      />

      <p className={styles.sectionTitle}>Spot tool</p>
      <SegmentedControl
        ariaLabel="Spot tool"
        options={[
          { value: 'off', label: 'Off' },
          { value: 'heal', label: 'Heal blemish' },
          { value: 'redEye', label: 'Red-eye' },
        ]}
        value={retouchMode ?? 'off'}
        onChange={(value) => setRetouchMode(value === 'off' ? null : (value as 'heal' | 'redEye'))}
      />

      {retouchMode && (
        <>
          <DialSlider
            label="Brush size"
            value={Math.round(retouchRadius * 1000)}
            min={10}
            max={250}
            step={5}
            neutral={50}
            onChange={(value) => setRetouchRadius(value / 1000)}
          />
          <p className={styles.hint}>Tap the photo to place a spot.</p>
        </>
      )}

      {retouch.healSpots.length > 0 && (
        <>
          <p className={styles.sectionTitle}>Heal spots</p>
          <div className={styles.list}>
            {retouch.healSpots.map((spot, index) => (
              <div key={spot.id} className={styles.listItem}>
                <span className={styles.grow}>Spot {index + 1}</span>
                <button type="button" className={styles.textButton} onClick={() => removeHealSpot(spot.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {retouch.redEye.length > 0 && (
        <>
          <p className={styles.sectionTitle}>Red-eye spots</p>
          <div className={styles.list}>
            {retouch.redEye.map((_, index) => (
              <div key={index} className={styles.listItem}>
                <span className={styles.grow}>Eye {index + 1}</span>
                <button type="button" className={styles.textButton} onClick={() => removeRedEyeAt(index)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
