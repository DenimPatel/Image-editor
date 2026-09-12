import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadCaps } from '../../gl/caps';
import { convertBytes } from '../../lib/format';
import { downloadBlob, extensionFor } from '../../lib/encode';
import { encodeDocument } from '../../features/export/encodeDocument';
import { buildMultiSizeZip } from '../../features/export/multiSize';
import { croppedSize, effectiveOutputSize } from '../../model/selectors';
import { isUpscale } from '../../lib/sizing';
import type { ExportFormat, MetadataPolicy, ResizeSpec } from '../../model/types';
import { renderExportCanvas } from '../../render/exportCanvas';
import { setOutput } from '../../store/actions';
import { useDocStore } from '../../store/docStore';
import { useUiStore } from '../../store/uiStore';
import { SegmentedControl } from '../controls/SegmentedControl';
import { Slider } from '../controls/Slider';
import { Stepper } from '../controls/Stepper';
import styles from './tools.module.css';

const RESIZE_MODES: { value: ResizeSpec['mode']; label: string }[] = [
  { value: 'none', label: 'Original' },
  { value: 'width', label: 'Width' },
  { value: 'height', label: 'Height' },
  { value: 'longEdge', label: 'Long edge' },
  { value: 'percent', label: 'Percent' },
];

export function ExportSheet({ source, fileName }: { source: ImageBitmap | null; fileName: string }) {
  const doc = useDocStore((state) => state.present);
  const output = doc.output;
  const caps = useMemo(() => loadCaps(), []);
  const pushToast = useUiStore((state) => state.pushToast);
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [busy, setBusy] = useState(false);

  const size = effectiveOutputSize(doc);
  const base = croppedSize(doc);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsEstimating(true);
      try {
        const canvas = await renderExportCanvas(source, doc);
        const blob = await encodeDocument(canvas, doc);
        if (!cancelled) setEstimatedBytes(blob.size);
      } catch {
        if (!cancelled) setEstimatedBytes(null);
      } finally {
        if (!cancelled) setIsEstimating(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, doc, output.format, output.quality, output.targetBytes, output.dpi, output.metadata]);

  const buildBlob = useCallback(async () => {
    if (!source) throw new Error('No image');
    const canvas = await renderExportCanvas(source, doc);
    return encodeDocument(canvas, doc);
  }, [source, doc]);

  const handleDownload = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await buildBlob();
      downloadBlob(blob, `${fileName}-edited.${extensionFor(output.format)}`);
      pushToast('Exported', 'success');
    } catch {
      pushToast('Export failed', 'error');
    } finally {
      setBusy(false);
    }
  }, [buildBlob, fileName, output.format, pushToast]);

  const handleMultiSize = useCallback(async () => {
    if (!source) return;
    setBusy(true);
    try {
      const blob = await buildMultiSizeZip(source, useDocStore.getState().present, [720, 1080, 1920]);
      downloadBlob(blob, `${fileName}-sizes.zip`);
      pushToast('Multi-size zip exported', 'success');
    } catch {
      pushToast('Multi-size export failed', 'error');
    } finally {
      setBusy(false);
    }
  }, [fileName, pushToast, source]);

  const handleShare = useCallback(async () => {
    if (!source) return;
    setBusy(true);
    try {
      const blob = await buildBlob();
      const file = new File([blob], `${fileName}.${extensionFor(output.format)}`, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName });
      } else {
        pushToast('Sharing not supported here', 'error');
      }
    } catch {
      // User cancelled the share sheet.
    } finally {
      setBusy(false);
    }
  }, [buildBlob, fileName, output.format, pushToast, source]);

  const handleCopy = useCallback(async () => {
    if (!source) return;
    setBusy(true);
    try {
      const canvas = await renderExportCanvas(source, doc);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('copy failed');
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      pushToast('Copied to clipboard', 'success');
    } catch {
      pushToast('Copy not supported here', 'error');
    } finally {
      setBusy(false);
    }
  }, [doc, pushToast, source]);

  const formatOptions: { value: ExportFormat; label: string }[] = [
    { value: 'jpeg', label: 'JPEG' },
    { value: 'png', label: 'PNG' },
    ...(caps.formats.webp ? [{ value: 'webp' as const, label: 'WebP' }] : []),
    ...(caps.formats.avif ? [{ value: 'avif' as const, label: 'AVIF' }] : []),
    { value: 'pdf', label: 'PDF' },
  ];
  const needsQuality = output.format !== 'png';
  const resize = output.resize;
  const resizeValue =
    resize.mode === 'width'
      ? resize.width
      : resize.mode === 'height'
        ? resize.height
        : resize.mode === 'longEdge'
          ? resize.longEdge
          : resize.mode === 'percent'
            ? resize.percent
            : 0;

  const setResizeMode = (mode: ResizeSpec['mode']) => {
    if (mode === 'none') setOutput({ resize: { mode: 'none' } });
    else if (mode === 'width') setOutput({ resize: { mode: 'width', width: size.width } });
    else if (mode === 'height') setOutput({ resize: { mode: 'height', height: size.height } });
    else if (mode === 'longEdge') setOutput({ resize: { mode: 'longEdge', longEdge: Math.max(size.width, size.height) } });
    else setOutput({ resize: { mode: 'percent', percent: 100 } });
  };

  return (
    <div>
      <p className={styles.sectionTitle}>Format</p>
      <SegmentedControl
        ariaLabel="Export format"
        options={formatOptions}
        value={output.format}
        onChange={(format) => setOutput({ format })}
      />

      {needsQuality && (
        <div style={{ marginTop: 12 }}>
          <Slider
            label="Quality"
            value={Math.round(output.quality * 100)}
            min={10}
            max={100}
            unit="%"
            onChange={(value) => setOutput({ quality: value / 100 })}
          />
        </div>
      )}

      <p className={styles.sectionTitle}>Size</p>
      <SegmentedControl
        ariaLabel="Resize mode"
        options={RESIZE_MODES}
        value={resize.mode}
        onChange={setResizeMode}
      />
      {resize.mode !== 'none' && (
        <div className={styles.row} style={{ marginTop: 8 }}>
          <input
            className={styles.grow}
            type="number"
            min={1}
            value={resizeValue}
            onChange={(event) => {
              const value = Math.max(1, Number(event.target.value) || 1);
              const mode = resize.mode;
              if (mode === 'width') setOutput({ resize: { mode: 'width', width: value } });
              else if (mode === 'height') setOutput({ resize: { mode: 'height', height: value } });
              else if (mode === 'longEdge') setOutput({ resize: { mode: 'longEdge', longEdge: value } });
              else if (mode === 'percent') setOutput({ resize: { mode: 'percent', percent: value } });
            }}
          />
          <span className={styles.hint}>{resize.mode === 'percent' ? '%' : 'px'}</span>
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <Stepper label="DPI" value={output.dpi} min={36} max={2400} step={1} onChange={(dpi) => setOutput({ dpi })} />
      </div>

      <p className={styles.sectionTitle}>Metadata</p>
      <SegmentedControl
        ariaLabel="Metadata policy"
        options={[
          { value: 'strip', label: 'Strip' },
          { value: 'orientation', label: 'Keep orientation' },
          { value: 'all', label: 'Keep all' },
        ]}
        value={output.metadata}
        onChange={(metadata: MetadataPolicy) => setOutput({ metadata })}
      />

      {needsQuality && (
        <>
          <p className={styles.sectionTitle}>Target size</p>
          <label className={styles.toggle}>
            <span>Fit under a maximum size</span>
            <input
              type="checkbox"
              checked={output.targetBytes !== null}
              onChange={(event) => setOutput({ targetBytes: event.target.checked ? 500 * 1024 : null })}
            />
          </label>
          {output.targetBytes !== null && (
            <div className={styles.row}>
              <input
                className={styles.grow}
                type="number"
                min={5}
                value={Math.round(output.targetBytes / 1024)}
                onChange={(event) =>
                  setOutput({ targetBytes: Math.max(5, Number(event.target.value) || 5) * 1024 })
                }
              />
              <span className={styles.hint}>KB</span>
            </div>
          )}
        </>
      )}

      <p className={styles.readout}>
        Output: {size.width} × {size.height} px · {output.dpi} DPI
        {isEstimating
          ? ' · estimating…'
          : estimatedBytes !== null
            ? ` · ~${convertBytes(estimatedBytes)}`
            : ''}
      </p>
      {isUpscale(base, size) && (
        <p className={styles.hint}>Upscaling beyond the crop resolution — quality may soften (capped at 4×).</p>
      )}

      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.textButton}
          onClick={handleDownload}
          disabled={busy || !source}
        >
          {busy ? 'Working…' : 'Download'}
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button type="button" className={styles.textButton} onClick={handleShare} disabled={busy || !source}>
            Share
          </button>
        )}
        {typeof ClipboardItem !== 'undefined' && (
          <button type="button" className={styles.textButton} onClick={handleCopy} disabled={busy || !source}>
            Copy
          </button>
        )}
        <button type="button" className={styles.textButton} onClick={handleMultiSize} disabled={busy || !source}>
          Multi-size zip
        </button>
      </div>
    </div>
  );
}
