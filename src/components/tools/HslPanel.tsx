import { useState } from 'react';
import { HSL_BANDS } from '../../model/defaults';
import type { HslBand } from '../../model/types';
import { setHslBand } from '../../store/actions';
import { useDocStore } from '../../store/docStore';
import { SegmentedControl } from '../controls/SegmentedControl';
import { Slider } from '../controls/Slider';
import styles from './tools.module.css';

export function HslPanel() {
  const hsl = useDocStore((state) => state.present.hsl);
  const [band, setBand] = useState<HslBand>('red');
  const value = hsl[band];

  return (
    <div>
      <SegmentedControl
        ariaLabel="Colour band"
        options={HSL_BANDS.map((candidate) => ({
          value: candidate,
          label: candidate[0].toUpperCase() + candidate.slice(1),
        }))}
        value={band}
        onChange={setBand}
      />
      <div style={{ marginTop: 10 }}>
        <Slider label="Hue" value={value.hue} min={-30} max={30} unit="°" onChange={(hue) => setHslBand(band, { hue })} />
        <Slider
          label="Saturation"
          value={value.sat}
          min={-100}
          max={100}
          onChange={(sat) => setHslBand(band, { sat })}
        />
        <Slider
          label="Luminance"
          value={value.lum}
          min={-100}
          max={100}
          onChange={(lum) => setHslBand(band, { lum })}
        />
      </div>
      <p className={styles.hint}>Mixed per colour band — the same engine the portrait tools reuse.</p>
    </div>
  );
}
