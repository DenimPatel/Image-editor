type ToolbarProps = {
  flipH: boolean;
  flipV: boolean;
  rotation: number;
  showGrid: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onFlipH: () => void;
  onFlipV: () => void;
  onRotateBy: (degrees: number) => void;
  onSetRotation: (degrees: number) => void;
  onToggleGrid: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
};

export function Toolbar({
  flipH,
  flipV,
  rotation,
  showGrid,
  canUndo,
  canRedo,
  onFlipH,
  onFlipV,
  onRotateBy,
  onSetRotation,
  onToggleGrid,
  onUndo,
  onRedo,
  onReset,
}: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Image transform tools">
      <button
        type="button"
        className={flipH ? 'active' : ''}
        onClick={onFlipH}
        title="Flip horizontally (F)"
      >
        ↔ Flip H
      </button>
      <button
        type="button"
        className={flipV ? 'active' : ''}
        onClick={onFlipV}
        title="Flip vertically"
      >
        ↕ Flip V
      </button>
      <button type="button" onClick={() => onRotateBy(-90)} title="Rotate 90° CCW ([)">
        ⟲ 90° CCW
      </button>
      <button type="button" onClick={() => onRotateBy(90)} title="Rotate 90° CW (])">
        ⟳ 90° CW
      </button>
      <label className="toolbar__slider">
        Custom angle
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={rotation}
          onChange={(event) => onSetRotation(Number(event.target.value))}
        />
        <span>{rotation}°</span>
      </label>
      <button
        type="button"
        className={showGrid ? 'active' : ''}
        onClick={onToggleGrid}
        title="Toggle grid (G)"
      >
        ▦ Grid
      </button>
      <div className="toolbar__spacer" />
      <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (⌘/Ctrl+Z)">
        ↶ Undo
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘/Ctrl+Z)">
        ↷ Redo
      </button>
      <button type="button" onClick={onReset} title="Reset all edits">
        Reset
      </button>
    </div>
  );
}
