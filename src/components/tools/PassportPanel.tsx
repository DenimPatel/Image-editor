import { useState } from 'react';
import { constrainToAspect } from '../../lib/crop/geometry';
import { downloadBlob } from '../../lib/encode';
import { effectiveOutputSize } from '../../model/selectors';
import { renderExportCanvas } from '../../render/exportCanvas';
import { useDocStore } from '../../store/docStore';
import { useUiStore } from '../../store/uiStore';
import { ChipRow } from '../controls/ChipRow';
import { SegmentedControl } from '../controls/SegmentedControl';
import { Stepper } from '../controls/Stepper';
import { checkCompliance } from '../../features/passport/compliance';
import { getSpec, PASSPORT_SPECS, type PassportSpec } from '../../features/passport/specs';
import { exportPassportSheetPdf, sheetPreviewCount } from '../../features/passport/sheetExport';
import type { SheetName } from '../../features/passport/sheet';
import styles from './tools.module.css';

const FULL = { x: 0, y: 0, width: 1, height: 1 };

function mid(range: { min: number; max: number }): number {
  return (range.min + range.max) / 2;
}

const STATUS_COLOR: Record<string, string> = {
  pass: '#38b28c',
  warn: '#e0a53b',
  fail: '#e05a5a',
};

export function PassportPanel({ source }: { source: ImageBitmap | null }) {
  const doc = useDocStore((state) => state.present);
  const pushToast = useUiStore((state) => state.pushToast);
  const specId = doc.passport?.specId ?? 'us-2x2';
  const spec: PassportSpec = getSpec(specId) ?? PASSPORT_SPECS[0];
  const [sheet, setSheet] = useState<SheetName>('4x6');
  const [copies, setCopies] = useState(6);
  const [busy, setBusy] = useState(false);

  const output = effectiveOutputSize(doc);
  const uniformity =
    spec.background === 'any' || doc.background.color.toLowerCase() === '#ffffff' ? 1 : 0.8;
  const report = checkCompliance({
    spec,
    headHeightMm: mid(spec.headHeightMm),
    eyeLineMmFromBottom: mid(spec.eyeLineMmFromBottom),
    outputWidthPx: output.width,
    outputHeightPx: output.height,
    backgroundUniformity: uniformity,
    centeredOffsetMm: 0,
  });

  const applySpec = (id: string) => {
    const next = getSpec(id);
    if (!next) return;
    useDocStore.getState().update((current) => ({
      ...current,
      passport: { specId: id, backgroundApplied: true },
      output: {
        ...current.output,
        format: 'jpeg',
        dpi: next.dpi,
        resize: { mode: 'physical', widthMm: next.widthMm, heightMm: next.heightMm, dpi: next.dpi },
      },
      geometry: {
        ...current.geometry,
        aspectLock: next.widthMm / next.heightMm,
        crop: constrainToAspect(FULL, next.widthMm / next.heightMm),
      },
      background: {
        ...current.background,
        mode: 'color',
        color: next.background === 'white' ? '#ffffff' : '#f2f2f2',
      },
    }));
  };

  const handleSheet = async () => {
    if (!source) return;
    setBusy(true);
    try {
      const canvas = await renderExportCanvas(source, useDocStore.getState().present);
      const blob = await exportPassportSheetPdf(spec, sheet, copies, canvas);
      downloadBlob(blob, `${spec.id}-${sheet}-sheet.pdf`);
      pushToast('Sheet exported', 'success');
    } catch {
      pushToast('Could not build the sheet', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className={styles.sectionTitle}>Document</p>
      <ChipRow
        ariaLabel="Passport spec"
        options={PASSPORT_SPECS.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
        value={specId}
        onChange={applySpec}
      />
      <p className={styles.hint}>
        {spec.widthMm}×{spec.heightMm} mm at {spec.dpi} DPI · background {spec.background.replace('-', ' ')}
      </p>

      <div className={styles.buttonRow}>
        <button type="button" className={`${styles.textButton} ${styles.textButtonPrimary}`} onClick={() => applySpec(spec.id)}>
          Apply frame size
        </button>
        <button
          type="button"
          className={styles.textButton}
          onClick={() =>
            useDocStore.getState().update((current) => ({
              ...current,
              background: { ...current.background, mode: 'color', color: '#ffffff' },
            }))
          }
        >
          White background
        </button>
      </div>

      <p className={styles.sectionTitle}>Compliance</p>
      <div className={styles.list}>
        {report.rules.map((rule) => (
          <div key={rule.id} className={styles.listItem}>
            <span style={{ color: STATUS_COLOR[rule.status], fontWeight: 700, width: 56 }}>{rule.status}</span>
            <span className={styles.grow}>
              <strong>{rule.label}</strong>
              <br />
              <span className={styles.hint}>{rule.detail}</span>
            </span>
          </div>
        ))}
      </div>
      <p className={styles.hint}>
        Effective resolution: {report.effectiveDpi} DPI. Face auto-detection uses the self-hosted landmark model when available;
        otherwise align the eyes and crown using the on-canvas guides.
      </p>

      <p className={styles.sectionTitle}>Checklist</p>
      <ul className={styles.hint} style={{ paddingLeft: 18, margin: 0 }}>
        {spec.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>

      <p className={styles.sectionTitle}>Print sheet</p>
      <SegmentedControl
        ariaLabel="Sheet size"
        options={[
          { value: '4x6', label: '4×6 in' },
          { value: '5x7', label: '5×7 in' },
          { value: 'a4', label: 'A4' },
        ]}
        value={sheet}
        onChange={(next) => setSheet(next)}
      />
      <div style={{ marginTop: 8 }}>
        <Stepper label="Copies" value={copies} min={1} max={24} onChange={setCopies} />
      </div>
      <p className={styles.hint}>{sheetPreviewCount(spec, sheet, copies)} photos will fit on this sheet at 2 mm gaps.</p>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.textButton} onClick={() => void handleSheet()} disabled={busy || !source}>
          {busy ? 'Building…' : 'Export sheet (PDF)'}
        </button>
      </div>
    </div>
  );
}
