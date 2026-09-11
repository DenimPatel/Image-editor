export type CropRect = { x: number; y: number; width: number; height: number };

export type ExportFormat = 'jpeg' | 'png' | 'webp' | 'pdf';

export type EditorState = {
  flipH: boolean;
  flipV: boolean;
  rotation: number;
  brightness: number;
  contrast: number;
  saturation: number;
  crop: CropRect | null;
  aspect: number | null;
  showGrid: boolean;
  format: ExportFormat;
  quality: number;
  outWidth: number;
  matte: string;
};

export const initialEditorState: EditorState = {
  flipH: false,
  flipV: false,
  rotation: 0,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  crop: null,
  aspect: null,
  showGrid: false,
  format: 'jpeg',
  quality: 0.92,
  outWidth: 1280,
  matte: '#ffffff',
};

export type EditorAction =
  | { type: 'SET_FLIP_H'; value: boolean }
  | { type: 'SET_FLIP_V'; value: boolean }
  | { type: 'TOGGLE_FLIP_H' }
  | { type: 'TOGGLE_FLIP_V' }
  | { type: 'ROTATE_BY'; degrees: number }
  | { type: 'SET_ROTATION'; degrees: number }
  | { type: 'SET_BRIGHTNESS'; value: number }
  | { type: 'SET_CONTRAST'; value: number }
  | { type: 'SET_SATURATION'; value: number }
  | { type: 'SET_CROP'; crop: CropRect | null }
  | { type: 'SET_ASPECT'; aspect: number | null }
  | { type: 'TOGGLE_GRID' }
  | { type: 'SET_FORMAT'; format: ExportFormat }
  | { type: 'SET_QUALITY'; value: number }
  | { type: 'SET_OUT_WIDTH'; value: number }
  | { type: 'SET_MATTE'; value: string }
  | { type: 'RESET' };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_FLIP_H':
      return { ...state, flipH: action.value };
    case 'SET_FLIP_V':
      return { ...state, flipV: action.value };
    case 'TOGGLE_FLIP_H':
      return { ...state, flipH: !state.flipH, crop: null };
    case 'TOGGLE_FLIP_V':
      return { ...state, flipV: !state.flipV, crop: null };
    case 'ROTATE_BY':
      return { ...state, rotation: normalizeAngle(state.rotation + action.degrees), crop: null };
    case 'SET_ROTATION':
      return { ...state, rotation: normalizeAngle(action.degrees), crop: null };
    case 'SET_BRIGHTNESS':
      return { ...state, brightness: action.value };
    case 'SET_CONTRAST':
      return { ...state, contrast: action.value };
    case 'SET_SATURATION':
      return { ...state, saturation: action.value };
    case 'SET_CROP':
      return { ...state, crop: action.crop };
    case 'SET_ASPECT':
      return { ...state, aspect: action.aspect };
    case 'TOGGLE_GRID':
      return { ...state, showGrid: !state.showGrid };
    case 'SET_FORMAT':
      return { ...state, format: action.format };
    case 'SET_QUALITY':
      return { ...state, quality: action.value };
    case 'SET_OUT_WIDTH':
      return { ...state, outWidth: action.value };
    case 'SET_MATTE':
      return { ...state, matte: action.value };
    case 'RESET':
      return { ...initialEditorState };
    default:
      return state;
  }
}

function normalizeAngle(degrees: number): number {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export type History = {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
};

export const MAX_HISTORY = 50;

export const initialHistory: History = {
  past: [],
  present: initialEditorState,
  future: [],
};

export type HistoryAction =
  { type: 'APPLY'; action: EditorAction } | { type: 'UNDO' } | { type: 'REDO' };

export function historyReducer(history: History, action: HistoryAction): History {
  switch (action.type) {
    case 'APPLY': {
      const next = editorReducer(history.present, action.action);
      if (next === history.present) return history;
      const past = [...history.past, history.present].slice(-MAX_HISTORY);
      return { past, present: next, future: [] };
    }
    case 'UNDO': {
      if (history.past.length === 0) return history;
      const previous = history.past[history.past.length - 1];
      const past = history.past.slice(0, -1);
      return { past, present: previous, future: [history.present, ...history.future] };
    }
    case 'REDO': {
      if (history.future.length === 0) return history;
      const [next, ...rest] = history.future;
      return { past: [...history.past, history.present], present: next, future: rest };
    }
    default:
      return history;
  }
}
