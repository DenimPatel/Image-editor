import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Dropzone } from '../components/Dropzone';
import { Toolbar } from '../components/Toolbar';
import { Adjustments } from '../components/Adjustments';
import { CropStage } from '../components/CropStage';
import { ExportPanel } from '../components/ExportPanel';
import { Nav } from '../components/ui/Nav';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ToolRail, type ToolSection } from '../components/ui/ToolRail';
import { decodeImageFile } from '../lib/decode';
import { computeOutputHeight, renderFinal, renderTransformed } from '../lib/render';
import { downloadBlob, encodeCanvas, extensionFor } from '../lib/encode';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  historyReducer,
  initialHistory,
  type CropRect,
  type EditorAction,
  type ExportFormat,
} from '../state/editorReducer';

const RENDER_DEBOUNCE_MS = 120;
const VALID_SECTIONS = new Set<ToolSection>(['transform', 'adjust', 'crop', 'export']);

export default function Editor() {
  const { tool } = useParams<{ tool?: string }>();
  const [activeSection, setActiveSection] = useState<ToolSection | null>(null);

  useEffect(() => {
    if (tool && VALID_SECTIONS.has(tool as ToolSection)) {
      setActiveSection(tool as ToolSection);
    }
  }, [tool]);

  useEffect(() => {
    if (!activeSection) return;
    const el = document.getElementById(activeSection);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeSection]);

  const [fileName, setFileName] = useState<string>('image');
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [history, dispatch] = useReducer(historyReducer, initialHistory);
  const state = history.present;

  const [transformedCanvas, setTransformedCanvas] = useState<HTMLCanvasElement | null>(null);
  const [transformedUrl, setTransformedUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedState = useDebouncedValue(state, RENDER_DEBOUNCE_MS);

  const apply = useCallback((action: EditorAction) => {
    dispatch({ type: 'APPLY', action });
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const decoded = await decodeImageFile(file);
      setBitmap(decoded);
      setFileName(file.name.replace(/\.[^/.]+$/, ''));
      dispatch({ type: 'APPLY', action: { type: 'RESET' } });
    } catch {
      setError('Could not read that file as an image.');
    }
  }, []);

  const transformParams = useMemo(
    () => ({
      flipH: debouncedState.flipH,
      flipV: debouncedState.flipV,
      rotation: debouncedState.rotation,
      brightness: debouncedState.brightness,
      contrast: debouncedState.contrast,
      saturation: debouncedState.saturation,
      matte: debouncedState.matte,
    }),
    [
      debouncedState.flipH,
      debouncedState.flipV,
      debouncedState.rotation,
      debouncedState.brightness,
      debouncedState.contrast,
      debouncedState.saturation,
      debouncedState.matte,
    ],
  );

  // Stage 1: flip/rotate/filters -> transformed canvas.
  useEffect(() => {
    if (!bitmap) {
      setTransformedCanvas(null);
      return;
    }
    const canvas = renderTransformed(bitmap, transformParams);
    setTransformedCanvas(canvas);
  }, [bitmap, transformParams]);

  useEffect(() => {
    if (!transformedCanvas) {
      setTransformedUrl(null);
      return;
    }
    setTransformedUrl(transformedCanvas.toDataURL('image/png'));
  }, [transformedCanvas]);

  const geometryKey = `${debouncedState.flipH}-${debouncedState.flipV}-${debouncedState.rotation}`;

  const outHeight = useMemo(() => {
    if (!state.crop) return null;
    return computeOutputHeight(state.outWidth, state.crop);
  }, [state.crop, state.outWidth]);

  // Stage 2: crop + resize + encode -> final preview & size estimate.
  useEffect(() => {
    if (!bitmap) {
      setPreviewUrl(null);
      setEstimatedBytes(null);
      return;
    }
    let cancelled = false;
    setIsEstimating(true);

    (async () => {
      try {
        const finalCanvas = renderFinal(bitmap, debouncedState);
        const blob = await encodeCanvas(finalCanvas, debouncedState.format, debouncedState.quality);
        if (cancelled) return;
        setEstimatedBytes(blob.size);
        if (debouncedState.format !== 'pdf') {
          const url = URL.createObjectURL(blob);
          setPreviewUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return url;
          });
        } else {
          setPreviewUrl(null);
        }
      } finally {
        if (!cancelled) setIsEstimating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bitmap, debouncedState]);

  const handleDownload = useCallback(async () => {
    if (!bitmap) return;
    const finalCanvas = renderFinal(bitmap, state);
    const blob = await encodeCanvas(finalCanvas, state.format, state.quality);
    downloadBlob(blob, `${fileName}-edited.${extensionFor(state.format)}`);
  }, [bitmap, state, fileName]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'REDO' : 'UNDO' });
        return;
      }
      if (isMeta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleDownload();
        return;
      }
      const target = event.target as HTMLElement | null;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (isTyping) return;

      if (event.key === '[') apply({ type: 'ROTATE_BY', degrees: -90 });
      else if (event.key === ']') apply({ type: 'ROTATE_BY', degrees: 90 });
      else if (event.key.toLowerCase() === 'f') apply({ type: 'TOGGLE_FLIP_H' });
      else if (event.key.toLowerCase() === 'g') apply({ type: 'TOGGLE_GRID' });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [apply, handleDownload]);

  return (
    <div className="editor-page">
      <Nav variant="editor" />

      <div className="wrap editor-wrap">
        {!bitmap && <Dropzone onFile={handleFile} />}
        {error && <p className="app__error">{error}</p>}

        {bitmap && transformedUrl && (
          <div className="app__editor">
            <div className="app__stage">
              <ToolRail active={activeSection} onSelect={setActiveSection} />

              <div className="app__sections">
                <Card legend="Transform" focused={activeSection === 'transform'} id="transform">
                  <Toolbar
                    flipH={state.flipH}
                    flipV={state.flipV}
                    rotation={state.rotation}
                    showGrid={state.showGrid}
                    canUndo={history.past.length > 0}
                    canRedo={history.future.length > 0}
                    onFlipH={() => apply({ type: 'TOGGLE_FLIP_H' })}
                    onFlipV={() => apply({ type: 'TOGGLE_FLIP_V' })}
                    onRotateBy={(degrees) => apply({ type: 'ROTATE_BY', degrees })}
                    onSetRotation={(degrees) => apply({ type: 'SET_ROTATION', degrees })}
                    onToggleGrid={() => apply({ type: 'TOGGLE_GRID' })}
                    onUndo={() => dispatch({ type: 'UNDO' })}
                    onRedo={() => dispatch({ type: 'REDO' })}
                    onReset={() => apply({ type: 'RESET' })}
                  />
                  <p className="app__original-dimensions">
                    Original dimensions: {bitmap.width} x {bitmap.height} pixels
                  </p>
                </Card>

                <div id="adjust" className={activeSection === 'adjust' ? 'is-focused' : ''}>
                  <Adjustments
                    brightness={state.brightness}
                    contrast={state.contrast}
                    saturation={state.saturation}
                    onBrightness={(value) => apply({ type: 'SET_BRIGHTNESS', value })}
                    onContrast={(value) => apply({ type: 'SET_CONTRAST', value })}
                    onSaturation={(value) => apply({ type: 'SET_SATURATION', value })}
                  />
                </div>

                <Card id="crop" className="crop-card" legend="Crop" focused={activeSection === 'crop'}>
                  <CropStage
                    src={transformedUrl}
                    geometryKey={geometryKey}
                    aspect={state.aspect}
                    showGrid={state.showGrid}
                    crop={state.crop}
                    onCropChange={(crop: CropRect) => apply({ type: 'SET_CROP', crop })}
                    onAspectChange={(aspect) => apply({ type: 'SET_ASPECT', aspect })}
                  />
                </Card>

                <p className="app__new-image-hint">
                  To process a new image, go back to the{' '}
                  <Button as="link" to="/" variant="ghost">
                    homepage
                  </Button>
                  .
                </p>
              </div>
            </div>

            <div id="export" className={activeSection === 'export' ? 'is-focused' : ''}>
              <ExportPanel
                format={state.format}
                quality={state.quality}
                outWidth={state.outWidth}
                outHeight={outHeight}
                matte={state.matte}
                estimatedBytes={estimatedBytes}
                isEstimating={isEstimating}
                previewUrl={previewUrl}
                onFormat={(format: ExportFormat) => apply({ type: 'SET_FORMAT', format })}
                onQuality={(value) => apply({ type: 'SET_QUALITY', value })}
                onOutWidth={(value) => apply({ type: 'SET_OUT_WIDTH', value })}
                onMatte={(value) => apply({ type: 'SET_MATTE', value })}
                onDownload={() => void handleDownload()}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
