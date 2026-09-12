import type { AdjustKey } from '../../model/types';
import { AdjustGlyph } from '../ui/editorIcons';
import { ParameterRing } from './ParameterRing';
import styles from './controls.module.css';

export type ParameterItem = {
  key: AdjustKey;
  label: string;
  value: number;
  min: number;
  max: number;
  neutral: number;
  unit?: string;
};

function formatValue(item: ParameterItem): string {
  const value = item.value;
  if (Number.isInteger(value)) return `${value > 0 ? '+' : ''}${value}${item.unit ?? ''}`;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}${item.unit ?? ''}`;
}

export function ParameterRow({
  items,
  selectedKey,
  onSelect,
}: {
  items: ParameterItem[];
  selectedKey: AdjustKey | null;
  onSelect: (key: AdjustKey) => void;
}) {
  return (
    <div className={styles.parameterRow} role="tablist" aria-label="Adjustment parameters">
      {items.map((item) => {
        const span = item.value >= item.neutral ? item.max - item.neutral : item.neutral - item.min;
        const progress = span > 0 ? Math.abs(item.value - item.neutral) / span : 0;
        return (
          <ParameterRing
            key={item.key}
            label={item.label}
            progress={progress}
            valueLabel={formatValue(item)}
            active={selectedKey === item.key}
            onClick={() => onSelect(item.key)}
          >
            <AdjustGlyph />
          </ParameterRing>
        );
      })}
    </div>
  );
}
