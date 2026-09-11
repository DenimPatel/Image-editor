import type { ExportFormat } from '../state/editorReducer';
import { convertBytes } from '../lib/format';

const WIDTH_PRESETS = [32, 40, 50, 80, 100, 160, 240, 320, 480, 640, 1080, 1280, 1920, 2560, 3840];

type ExportPanelProps = {
  format: ExportFormat;
  quality: number;
  outWidth: number;
  outHeight: number | null;
  matte: string;
  estimatedBytes: number | null;
  isEstimating: boolean;
  previewUrl: string | null;
  onFormat: (format: ExportFormat) => void;
  onQuality: (value: number) => void;
  onOutWidth: (value: number) => void;
  onMatte: (value: string) => void;
  onDownload: () => void;
};

export function ExportPanel({
  format,
  quality,
  outWidth,
  outHeight,
  matte,
  estimatedBytes,
  isEstimating,
  previewUrl,
  onFormat,
  onQuality,
  onOutWidth,
  onMatte,
  onDownload,
}: ExportPanelProps) {
  const widthOptions = Array.from(new Set([...WIDTH_PRESETS, outWidth])).sort((a, b) => a - b);
  const needsQuality = format === 'jpeg' || format === 'webp' || format === 'pdf';
  const needsMatte = format === 'jpeg' || format === 'pdf';

  return (
    <fieldset className="export-panel">
      <legend>Export</legend>

      <label>
        Save as
        <select value={format} onChange={(event) => onFormat(event.target.value as ExportFormat)}>
          <option value="jpeg">JPEG</option>
          <option value="png">PNG</option>
          <option value="webp">WebP</option>
          <option value="pdf">PDF</option>
        </select>
      </label>

      <label>
        Width
        <select value={outWidth} onChange={(event) => onOutWidth(Number(event.target.value))}>
          {widthOptions.map((width) => (
            <option key={width} value={width}>
              {width}px
            </option>
          ))}
        </select>
      </label>

      {outHeight !== null && (
        <p className="export-panel__dimensions">
          Output size: {outWidth} x {outHeight} pixels
        </p>
      )}

      {needsQuality && (
        <label>
          Quality <span className="adjustments__value">{Math.round(quality * 100)}%</span>
          <input
            type="range"
            min={0.01}
            max={1}
            step={0.01}
            value={quality}
            onChange={(event) => onQuality(Number(event.target.value))}
          />
        </label>
      )}

      {needsMatte && (
        <label>
          Matte color (fills transparency / rotated corners)
          <input
            type="color"
            value={matte === 'transparent' ? '#ffffff' : matte}
            onChange={(event) => onMatte(event.target.value)}
          />
        </label>
      )}

      <p className="export-panel__size">
        {isEstimating
          ? 'Estimating file size…'
          : estimatedBytes !== null
            ? `Expected file size: ${convertBytes(estimatedBytes)}`
            : ''}
      </p>

      <div className="export-panel__preview" aria-live="polite">
        <p>Final output</p>
        {format === 'pdf' ? (
          <div className="export-panel__pdf-card">📄 PDF ready</div>
        ) : (
          previewUrl && <img src={previewUrl} alt="Final output preview" />
        )}
        {estimatedBytes !== null && (
          <p className="export-panel__size-small">{convertBytes(estimatedBytes)}</p>
        )}
        <button
          type="button"
          className="export-panel__download"
          onClick={onDownload}
          title="Download (⌘/Ctrl+S)"
        >
          Download final image
        </button>
      </div>
    </fieldset>
  );
}
