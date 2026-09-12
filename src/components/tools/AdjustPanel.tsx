import { useState } from 'react';
import { ADJUST_SPECS } from '../../model/defaults';
import type { AdjustKey } from '../../model/types';
import { DialSlider } from '../controls/DialSlider';
import { ParameterRow } from '../controls/ParameterRow';
import { SegmentedControl } from '../controls/SegmentedControl';
import { setAdjust } from '../../store/actions';
import { useDocStore } from '../../store/docStore';
import { useUiStore } from '../../store/uiStore';
import { CurvesEditor } from './CurvesEditor';
import { Histogram } from './Histogram';
import { HslPanel } from './HslPanel';
import styles from './tools.module.css';

type Section = 'sliders' | 'curves' | 'hsl';

export function AdjustPanel({ source, onAuto }: { source: ImageBitmap | null; onAuto?: () => void }) {
  const adjust = useDocStore((state) => state.present.adjust);
  const selectedKey = useUiStore((state) => state.selectedAdjustKey);
  const selectKey = useUiStore((state) => state.selectAdjustKey);
  const [section, setSection] = useState<Section>('sliders');

  const spec = ADJUST_SPECS.find((candidate) => candidate.key === selectedKey) ?? ADJUST_SPECS[0];
  const items = ADJUST_SPECS.map((candidate) => ({
    key: candidate.key,
    label: candidate.label,
    value: adjust[candidate.key],
    min: candidate.min,
    max: candidate.max,
    neutral: candidate.neutral,
    unit: candidate.unit,
  }));

  return (
    <div>
      <Histogram source={source} />
      <SegmentedControl
        ariaLabel="Adjustment section"
        options={[
          { value: 'sliders', label: 'Sliders' },
          { value: 'curves', label: 'Curves' },
          { value: 'hsl', label: 'Color Mix' },
        ]}
        value={section}
        onChange={setSection}
      />

      {section === 'sliders' && (
        <>
          <ParameterRow items={items} selectedKey={spec.key} onSelect={(key: AdjustKey) => selectKey(key)} />
          <DialSlider
            label={spec.label}
            value={adjust[spec.key]}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            neutral={spec.neutral}
            unit={spec.unit}
            onChange={(value) => setAdjust(spec.key, value)}
            onInteractionStart={() => useDocStore.getState().beginInteraction(`adjust:${spec.key}`)}
            onInteractionEnd={() => useDocStore.getState().endInteraction()}
          />
          <div className={styles.buttonRow}>
            <button type="button" className={styles.textButton} onClick={() => setAdjust(spec.key, spec.neutral)}>
              Reset {spec.label}
            </button>
            {onAuto && (
              <button
                type="button"
                className={`${styles.textButton} ${styles.textButtonPrimary}`}
                onClick={onAuto}
              >
                Auto
              </button>
            )}
          </div>
        </>
      )}

      {section === 'curves' && <CurvesEditor />}
      {section === 'hsl' && <HslPanel />}
    </div>
  );
}
