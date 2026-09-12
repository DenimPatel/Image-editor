import { useRef, useState } from 'react';
import { isMattingReady, removeBackground, type MattingQuality } from '../../features/ml/matting';
import { MODELS, ModelUnavailableError } from '../../features/ml/ModelLoader';
import { assetStore } from '../../model/assetsSingleton';
import { convertBytes } from '../../lib/format';
import type { Doc } from '../../model/types';
import { runAsyncEdit } from '../../store/asyncOps';
import { setBackground, setOutput } from '../../store/actions';
import { liveAssetIds, useDocStore } from '../../store/docStore';
import { useUiStore } from '../../store/uiStore';
import { ColorField } from '../controls/ColorField';
import { SegmentedControl } from '../controls/SegmentedControl';
import { Slider } from '../controls/Slider';
import styles from './tools.module.css';

export function BackgroundPanel({ source }: { source: ImageBitmap | null }) {
  const background = useDocStore((state) => state.present.background);
  const output = useDocStore((state) => state.present.output);
  const pushToast = useUiStore((state) => state.pushToast);
  const [quality, setQuality] = useState<MattingQuality>('fast');
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const model = MODELS[quality === 'best' ? 'matting-fp16' : 'matting-quint8'];

  const handleRemove = async () => {
    if (!source) return;
    controllerRef.current = new AbortController();
    setRunning(true);
    const result = await runAsyncEdit<ImageBitmap>({
      label: 'Removing background',
      externalSignal: controllerRef.current.signal,
      run: (signal, onProgress) => removeBackground(source, { quality, signal, onProgress }),
      apply: (doc: Doc, bitmap) => {
        const assetId = assetStore.add(bitmap);
        const sourceRef = doc.source;
        return {
          ...doc,
          source: sourceRef
            ? { ...sourceRef, assetId, width: bitmap.width, height: bitmap.height }
            : sourceRef,
          background: { ...doc.background, removed: true },
        };
      },
    });
    setRunning(false);
    if (result.status === 'done') {
      assetStore.prune(liveAssetIds());
      pushToast('Background removed', 'success');
    } else if (result.status === 'error') {
      const message =
        result.error instanceof ModelUnavailableError
          ? "Couldn't download the background model — check your connection and try again, or set a background manually."
          : 'Background removal failed.';
      pushToast(message, 'error');
    }
  };

  const cancel = () => controllerRef.current?.abort();

  return (
    <div>
      <p className={styles.sectionTitle}>Replace background</p>
      <SegmentedControl
        ariaLabel="Background mode"
        options={[
          { value: 'none', label: 'Transparent' },
          { value: 'color', label: 'Colour' },
          { value: 'gradient', label: 'Gradient' },
        ]}
        value={background.mode}
        onChange={(mode) => setBackground({ mode })}
      />
      {background.mode === 'color' && (
        <ColorField label="Colour" value={background.color} onChange={(color) => setBackground({ color })} />
      )}
      {background.mode === 'gradient' && (
        <>
          <ColorField label="From" value={background.gradient.from} onChange={(from) => setBackground({ gradient: { ...background.gradient, from } })} />
          <ColorField label="To" value={background.gradient.to} onChange={(to) => setBackground({ gradient: { ...background.gradient, to } })} />
          <Slider label="Angle" value={background.gradient.angle} min={0} max={360} unit="°" onChange={(angle) => setBackground({ gradient: { ...background.gradient, angle } })} />
        </>
      )}

      <p className={styles.sectionTitle}>Subject removal</p>
      <SegmentedControl
        ariaLabel="Model quality"
        options={[
          { value: 'fast', label: 'Fast' },
          { value: 'best', label: 'Best quality' },
        ]}
        value={quality}
        onChange={(next) => setQuality(next)}
      />
      <p className={styles.hint}>
        {model.label} — about {convertBytes(model.bytes)} downloaded on first use
        {isMattingReady(quality) ? ' (cached)' : ''}
      </p>
      <div className={styles.buttonRow}>
        {!running ? (
          <button
            type="button"
            className={`${styles.textButton} ${styles.textButtonPrimary}`}
            onClick={() => void handleRemove()}
            disabled={!source}
          >
            Remove background
          </button>
        ) : (
          <button type="button" className={styles.textButton} onClick={cancel}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className={styles.textButton}
          onClick={() => {
            setOutput({ format: 'png' });
            setBackground({ mode: 'none', removed: true });
          }}
        >
          Keep transparent (PNG)
        </button>
      </div>
      <p className={styles.hint}>
        No model is right every time — use the repair brush to tidy up edges, or pick a replacement colour.
      </p>
      <p className={styles.hint}>Current output: {output.format.toUpperCase()}</p>
    </div>
  );
}
