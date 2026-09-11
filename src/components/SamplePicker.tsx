const SAMPLE_IMAGES = [
  { file: 'pexels-cesar-o-neill-26650613-34630144.jpg', label: 'Sample 1' },
  { file: 'pexels-h-ng-quang-official-647624701-39127354.jpg', label: 'Sample 2' },
  { file: 'pexels-lucasrvimieiro-16216147.jpg', label: 'Sample 3' },
];

type SamplePickerProps = {
  onSelect: (url: string, label: string) => void;
};

export function SamplePicker({ onSelect }: SamplePickerProps) {
  return (
    <div className="sample-picker">
      <p className="sample-picker__title">Or try a sample image</p>
      <div className="sample-picker__grid">
        {SAMPLE_IMAGES.map(({ file, label }) => {
          const src = `${import.meta.env.BASE_URL}sample-images/${file}`;
          return (
            <button
              key={file}
              type="button"
              className="sample-picker__item"
              onClick={() => onSelect(src, label)}
            >
              <img src={src} alt={label} loading="lazy" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <p className="sample-picker__credit">
        Photos courtesy of{' '}
        <a href="https://www.pexels.com/license/" target="_blank" rel="noreferrer">
          Pexels
        </a>
      </p>
    </div>
  );
}
