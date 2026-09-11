type AdjustmentsProps = {
  brightness: number;
  contrast: number;
  saturation: number;
  onBrightness: (value: number) => void;
  onContrast: (value: number) => void;
  onSaturation: (value: number) => void;
};

const DEFAULT_VALUE = 100;

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="adjustments__slider" onDoubleClick={() => onChange(DEFAULT_VALUE)}>
      <span>
        {label} <span className="adjustments__value">{value}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={200}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function Adjustments({
  brightness,
  contrast,
  saturation,
  onBrightness,
  onContrast,
  onSaturation,
}: AdjustmentsProps) {
  return (
    <fieldset className="adjustments">
      <legend>Adjustments (double-click to reset)</legend>
      <Slider label="Brightness" value={brightness} onChange={onBrightness} />
      <Slider label="Contrast" value={contrast} onChange={onContrast} />
      <Slider label="Saturation" value={saturation} onChange={onSaturation} />
    </fieldset>
  );
}
