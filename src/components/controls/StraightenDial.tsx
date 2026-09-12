import { DialSlider } from './DialSlider';

export type StraightenDialProps = {
  value: number;
  onChange: (value: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
};

export function StraightenDial({ value, onChange, onInteractionStart, onInteractionEnd }: StraightenDialProps) {
  return (
    <DialSlider
      label="Straighten"
      value={value}
      min={-45}
      max={45}
      step={0.1}
      neutral={0}
      unit="°"
      pxPerUnit={3}
      format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`}
      onChange={onChange}
      onInteractionStart={onInteractionStart}
      onInteractionEnd={onInteractionEnd}
    />
  );
}
