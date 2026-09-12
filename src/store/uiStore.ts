import { create } from 'zustand';

/**
 * Non-undoable UI state, deliberately separate from the document so undo
 * never moves the viewport or changes the active tool, and persistence only
 * ever serializes `doc`.
 */

export type ToolId =
  | 'crop'
  | 'adjust'
  | 'filters'
  | 'retouch'
  | 'background'
  | 'text'
  | 'draw'
  | 'stickers'
  | 'redact'
  | 'frame'
  | 'layers'
  | 'passport'
  | 'export';

export const TOOL_IDS: ToolId[] = [
  'crop',
  'adjust',
  'filters',
  'retouch',
  'background',
  'text',
  'draw',
  'stickers',
  'redact',
  'frame',
  'layers',
  'passport',
  'export',
];

export type SheetDetent = 'peek' | 'medium' | 'large';

export type SafeAreaPreset = 'none' | 'story' | 'reel' | 'youtube';

export type Job = {
  id: string;
  label: string;
  progress: number;
  status: 'running' | 'done' | 'error' | 'cancelled';
};

export type Toast = {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'error';
};

export type Viewport = {
  scale: number;
  x: number;
  y: number;
};

export type UiStore = {
  activeTool: ToolId | null;
  sheetDetent: SheetDetent;
  viewport: Viewport;
  compareHeld: boolean;
  selectedLayerId: string | null;
  selectedAdjustKey: string | null;
  safeArea: SafeAreaPreset;
  jobs: Job[];
  toasts: Toast[];
  showHelp: boolean;

  setActiveTool: (tool: ToolId | null) => void;
  setSheetDetent: (detent: SheetDetent) => void;
  setViewport: (viewport: Partial<Viewport>) => void;
  resetViewport: () => void;
  setCompareHeld: (held: boolean) => void;
  selectLayer: (id: string | null) => void;
  selectAdjustKey: (key: string | null) => void;
  setSafeArea: (preset: SafeAreaPreset) => void;
  startJob: (job: Job) => void;
  updateJob: (id: string, patch: Partial<Job>) => void;
  finishJob: (id: string, status: Job['status']) => void;
  pushToast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: string) => void;
  setShowHelp: (show: boolean) => void;
};

const DEFAULT_VIEWPORT: Viewport = { scale: 1, x: 0, y: 0 };

let toastCounter = 0;

export const useUiStore = create<UiStore>((set) => ({
  activeTool: null,
  sheetDetent: 'medium',
  viewport: DEFAULT_VIEWPORT,
  compareHeld: false,
  selectedLayerId: null,
  selectedAdjustKey: 'exposure',
  safeArea: 'none',
  jobs: [],
  toasts: [],
  showHelp: false,

  setActiveTool: (activeTool) => set({ activeTool }),
  setSheetDetent: (sheetDetent) => set({ sheetDetent }),
  setViewport: (viewport) => set((state) => ({ viewport: { ...state.viewport, ...viewport } })),
  resetViewport: () => set({ viewport: DEFAULT_VIEWPORT }),
  setCompareHeld: (compareHeld) => set({ compareHeld }),
  selectLayer: (selectedLayerId) => set({ selectedLayerId }),
  selectAdjustKey: (selectedAdjustKey) => set({ selectedAdjustKey }),
  setSafeArea: (safeArea) => set({ safeArea }),

  startJob: (job) => set((state) => ({ jobs: [...state.jobs, job] })),
  updateJob: (id, patch) =>
    set((state) => ({ jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)) })),
  finishJob: (id, status) =>
    set((state) => ({ jobs: state.jobs.map((job) => (job.id === id ? { ...job, status } : job)) })),

  pushToast: (message, tone = 'info') => {
    toastCounter += 1;
    const toast: Toast = { id: `toast_${toastCounter}`, message, tone };
    set((state) => ({ toasts: [...state.toasts, toast] }));
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  setShowHelp: (showHelp) => set({ showHelp }),
}));