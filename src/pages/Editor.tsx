import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EditorCanvas } from '../components/canvas/EditorCanvas';
import { EditorTopBar } from '../components/editor/EditorTopBar';
import { HelpOverlay } from '../components/editor/HelpOverlay';
import { ImportScreen } from '../components/editor/ImportScreen';
import { JobProgressBar } from '../components/editor/JobProgressBar';
import { ResumeSessionCard } from '../components/editor/ResumeSessionCard';
import { ToolSurface } from '../components/editor/ToolSurface';
import { ToolTabBar } from '../components/editor/ToolTabBar';
import { CloseGlyph } from '../components/ui/editorIcons';
import { IconButton } from '../components/controls/IconButton';
import { ToastStack } from '../components/controls/Toast';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { autoAdjust, buildHistogram } from '../lib/auto';
import { describeUnsupported } from '../lib/accept';
import { decodeImageFile } from '../lib/decode';
import { applyRecipe, readClipboardRecipe, savePreset, writeClipboardRecipe } from '../lib/persist/recipes';
import { clearSession, createThumbnail, loadSession, saveSession } from '../lib/persist/session';
import { scheduleOldCacheCleanup } from '../features/ml/ModelLoader';
import { createDoc } from '../model/defaults';
import { assetStore } from '../model/assetsSingleton';
import { croppedSize } from '../model/selectors';
import { renderExportCanvas } from '../render/exportCanvas';
import { liveAssetIds, useDocStore } from '../store/docStore';
import { TOOL_IDS, useUiStore, type ToolId } from '../store/uiStore';
import styles from '../components/editor/editor.module.css';

const VALID_TOOLS = new Set<string>(TOOL_IDS);
const AUTOSAVE_MS = 1000;

type ResumeState = {
  doc: ReturnType<typeof createDoc>;
  updatedAt: number;
  thumb: string | null;
  source: Blob;
};

export default function Editor() {
  const navigate = useNavigate();
  const { tool } = useParams<{ tool?: string }>();
  const [source, setSource] = useState<ImageBitmap | null>(null);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState('image');
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<ResumeState | null>(null);
  const thumbRef = useRef<string | null>(null);
  const activeTool = useUiStore((state) => state.activeTool);
  const pushToast = useUiStore((state) => state.pushToast);
  const revision = useDocStore((state) => state.revision);

  useEffect(() => {
    if (tool && VALID_TOOLS.has(tool)) useUiStore.getState().setActiveTool(tool as ToolId);
  }, [tool]);

  useEffect(() => {
    scheduleOldCacheCleanup();
    void loadSession().then((session) => {
      if (session?.source) setResume(session as ResumeState);
    });
  }, []);

  const loadBitmap = useCallback((bitmap: ImageBitmap, name: string, mime: string, blob: Blob | null) => {
    const assetId = assetStore.add(bitmap);
    useDocStore.getState().load(
      createDoc({ source: { assetId, width: bitmap.width, height: bitmap.height, name, mime } }),
    );
    assetStore.prune(liveAssetIds());
    thumbRef.current = createThumbnail(bitmap);
    setFileName(name);
    setError(null);
    setSource(bitmap);
    setSourceBlob(blob);
    setResume(null);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      const unsupported = describeUnsupported(file);
      if (unsupported) {
        setError(unsupported);
        return;
      }
      try {
        const bitmap = await decodeImageFile(file);
        loadBitmap(bitmap, file.name.replace(/\.[^/.]+$/, ''), file.type, file);
      } catch {
        setError('Could not read that file as an image.');
      }
    },
    [loadBitmap],
  );

  const handleSample = useCallback(
    async (url: string, label: string) => {
      try {
        const blob = await fetch(url).then((response) => response.blob());
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        loadBitmap(bitmap, label, 'image/jpeg', blob);
      } catch {
        setError('Could not load that sample image.');
      }
    },
    [loadBitmap],
  );

  const handleResume = useCallback(async () => {
    if (!resume) return;
    try {
      const bitmap = await createImageBitmap(resume.source, { imageOrientation: 'from-image' });
      const assetId = assetStore.add(bitmap, resume.doc.source?.assetId);
      const doc = resume.doc.source
        ? { ...resume.doc, source: { ...resume.doc.source, assetId, width: bitmap.width, height: bitmap.height } }
        : resume.doc;
      useDocStore.getState().load(doc);
      thumbRef.current = resume.thumb ?? createThumbnail(bitmap);
      setSource(bitmap);
      setSourceBlob(resume.source);
      setFileName(resume.doc.source?.name ?? 'image');
      setResume(null);
    } catch {
      setError('Could not restore the previous session.');
    }
  }, [resume]);

  const handleDiscard = useCallback(() => {
    void clearSession();
    setResume(null);
  }, []);

  // Debounced autosave; only the JSON doc and original bytes are stored.
  useEffect(() => {
    if (!source) return;
    const timer = window.setTimeout(() => {
      void saveSession(useDocStore.getState().present, sourceBlob, thumbRef.current);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [source, sourceBlob, revision]);

  const handleAuto = useCallback(async () => {
    if (!source) return;
    try {
      const doc = useDocStore.getState().present;
      const base = croppedSize(doc);
      const width = 256;
      const height = Math.max(1, Math.round((width * base.height) / base.width));
      const canvas = await renderExportCanvas(source, doc, { width, height });
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no context');
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const partial = autoAdjust(buildHistogram(data));
      useDocStore.getState().update((current) => ({ ...current, adjust: { ...current.adjust, ...partial } }), {
        key: 'auto',
      });
      pushToast('Auto applied', 'success');
    } catch {
      pushToast('Auto could not be applied', 'error');
    }
  }, [pushToast, source]);

  const handleCopyEdits = useCallback(() => {
    writeClipboardRecipe(useDocStore.getState().present);
    pushToast('Edits copied', 'success');
  }, [pushToast]);

  const handlePasteEdits = useCallback(() => {
    const raw = readClipboardRecipe();
    const next = raw ? applyRecipe(useDocStore.getState().present, raw) : null;
    if (!next) {
      pushToast('Nothing to paste', 'error');
      return;
    }
    useDocStore.getState().update(() => next, { key: 'paste' });
    pushToast('Edits pasted', 'success');
  }, [pushToast]);

  const handleSavePreset = useCallback(() => {
    const name = window.prompt('Preset name', 'My preset')?.trim();
    if (!name) return;
    savePreset(name, useDocStore.getState().present);
    pushToast(`Saved “${name}”`, 'success');
  }, [pushToast]);

  useKeyboardShortcuts({
    onExport: () => useUiStore.getState().setActiveTool('export'),
    onCommit: () => useUiStore.getState().setActiveTool(null),
    onCancel: () => useUiStore.getState().setActiveTool(null),
  });

  const openExport = useCallback(() => {
    if (!useUiStore.getState().activeTool) useUiStore.getState().setActiveTool('export');
  }, []);

  return (
    <div className={styles.editor}>
      <JobProgressBar />
      {!source ? (
        <>
          <header className={styles.topBar}>
            <IconButton label="Back to home" onClick={() => navigate('/')}>
              <CloseGlyph />
            </IconButton>
            <span className={styles.topBarTitle}>New image</span>
            <span style={{ width: 44 }} />
          </header>
          <ImportScreen
            onFile={handleFile}
            onSample={handleSample}
            error={error}
            resume={
              resume ? (
                <ResumeSessionCard
                  thumbnailUrl={resume.thumb}
                  updatedAt={resume.updatedAt}
                  onResume={() => void handleResume()}
                  onDiscard={handleDiscard}
                />
              ) : undefined
            }
          />
        </>
      ) : (
        <>
          <EditorTopBar
            title={fileName}
            onClose={() => navigate('/')}
            onDone={openExport}
            onReset={() => useDocStore.getState().reset()}
            onCopyEdits={handleCopyEdits}
            onPasteEdits={handlePasteEdits}
            onSavePreset={handleSavePreset}
            onInfo={() =>
              pushToast(
                `${source.width}×${source.height} source · ${useDocStore.getState().present.layers.length} layers`,
              )
            }
            canPaste={readClipboardRecipe() !== null}
          />
          <div className={`${styles.canvasRegion}${activeTool ? ` ${styles.withSheet}` : ''}`}>
            <EditorCanvas source={source} />
          </div>
          <ToolTabBar />
          <ToolSurface source={source} fileName={fileName} onAuto={handleAuto} />
        </>
      )}
      <ToastStack />
      <HelpOverlay />
    </div>
  );
}
