import { AdjustIcon, CropIcon, ExportIcon, RotateIcon } from './icons';

export type ToolSection = 'transform' | 'adjust' | 'crop' | 'export';

const ITEMS: { key: ToolSection; label: string; Icon: typeof CropIcon }[] = [
  { key: 'transform', label: 'Transform', Icon: RotateIcon },
  { key: 'adjust', label: 'Adjust', Icon: AdjustIcon },
  { key: 'crop', label: 'Crop', Icon: CropIcon },
  { key: 'export', label: 'Export', Icon: ExportIcon },
];

type ToolRailProps = {
  active: ToolSection | null;
  onSelect: (section: ToolSection) => void;
};

export function ToolRail({ active, onSelect }: ToolRailProps) {
  return (
    <nav className="tool-rail" aria-label="Jump to editor section">
      {ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`tool-rail__item${active === key ? ' active' : ''}`}
          onClick={() => onSelect(key)}
          title={label}
        >
          <Icon className="tool-rail__icon" />
          <span className="tool-rail__label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
