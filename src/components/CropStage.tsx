import { useEffect, useRef, useState } from 'react';
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import type { CropRect } from '../state/editorReducer';
import { parseRatio } from '../lib/format';

const PRESETS: { label: string; aspect: number | null }[] = [
  { label: 'Free', aspect: null },
  { label: '1:1', aspect: 1 },
  { label: '4:3', aspect: 4 / 3 },
  { label: '3:2', aspect: 3 / 2 },
  { label: '16:9', aspect: 16 / 9 },
];

type CropStageProps = {
  src: string;
  /** Changes only when flip/rotation changes canvas geometry; a filter-only
   * (brightness/contrast/saturation) change keeps this stable so the crop
   * box survives — only `src` changes, and it's applied via a same-size
   * cropper.replace() instead of tearing the cropper down. */
  geometryKey: string;
  aspect: number | null;
  showGrid: boolean;
  crop: CropRect | null;
  onCropChange: (crop: CropRect) => void;
  onAspectChange: (aspect: number | null) => void;
};

export function CropStage({
  src,
  geometryKey,
  aspect,
  showGrid,
  crop,
  onCropChange,
  onAspectChange,
}: CropStageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const cropperRef = useRef<Cropper | null>(null);
  const createdWithSrcRef = useRef<string | null>(null);
  const [ratioText, setRatioText] = useState('');
  const [ratioError, setRatioError] = useState<string | null>(null);

  // Re-create the cropper only when geometry changes (new dimensions from a
  // flip/rotate). The crop state is already reset to null by the reducer
  // for those actions, since old coordinates no longer apply.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    createdWithSrcRef.current = src;
    const cropper = new Cropper(img, {
      viewMode: 1,
      autoCropArea: 1,
      background: false,
      aspectRatio: aspect ?? NaN,
      ready() {
        const data = cropper.getData(true);
        onCropChange({ x: data.x, y: data.y, width: data.width, height: data.height });
      },
      crop(event) {
        const { x, y, width, height } = event.detail;
        if (width <= 0 || height <= 0) return;
        onCropChange({
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        });
      },
    });
    cropperRef.current = cropper;

    return () => {
      cropper.destroy();
      cropperRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryKey]);

  // A filter-only change (same geometry): swap the image in place, keeping
  // the crop box intact, rather than rebuilding the whole cropper.
  useEffect(() => {
    if (src === createdWithSrcRef.current) return;
    const cropper = cropperRef.current;
    if (!cropper) return;
    createdWithSrcRef.current = src;
    cropper.replace(src, true);
  }, [src]);

  useEffect(() => {
    cropperRef.current?.setAspectRatio(aspect ?? NaN);
  }, [aspect]);

  function applyRatioText(text: string) {
    setRatioText(text);
    if (text.trim() === '') {
      setRatioError(null);
      return;
    }
    const parsed = parseRatio(text);
    if (!parsed) {
      setRatioError('Use a positive ratio like 3:2');
      return;
    }
    setRatioError(null);
    onAspectChange(parsed.width / parsed.height);
  }

  return (
    <div className="crop-stage-wrapper">
      <div className="crop-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={aspect === preset.aspect ? 'active' : ''}
            onClick={() => {
              onAspectChange(preset.aspect);
              setRatioText('');
              setRatioError(null);
            }}
          >
            {preset.label}
          </button>
        ))}
        <label className="crop-presets__custom">
          Custom ratio
          <input
            type="text"
            placeholder="e.g. 5:4"
            value={ratioText}
            onChange={(event) => applyRatioText(event.target.value)}
          />
        </label>
        {ratioError && <span className="crop-presets__error">{ratioError}</span>}
      </div>

      <div className={`crop-stage${showGrid ? ' crop-stage--grid' : ''}`}>
        <img ref={imgRef} src={src} alt="Editable preview" />
        {showGrid && <div className="crop-stage__grid" aria-hidden="true" />}
      </div>

      {crop && (
        <p className="crop-stage__dimensions">
          Cropped dimensions: {crop.width} x {crop.height} pixels
        </p>
      )}
    </div>
  );
}
