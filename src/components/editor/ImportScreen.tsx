import { useCallback, useEffect, useRef, useState } from 'react';
import { ACCEPT_ATTR, ACCEPTED_IMAGE_TYPES, SAMPLE_IMAGES } from '../../lib/accept';
import styles from './editor.module.css';

export type ImportScreenProps = {
  onFile: (file: File) => void;
  onSample: (url: string, label: string) => void;
  error: string | null;
  resume?: React.ReactNode;
};

export function ImportScreen({ onFile, onSample, error, resume }: ImportScreenProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      onFile(files[0]);
    },
    [onFile],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            onFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [onFile]);

  return (
    <div className={styles.importScreen}>
      <h1 className={styles.importTitle}>Edit an image</h1>
      <label className={styles.importHint}>
        Everything runs in your browser — nothing is uploaded.
      </label>

      <div
        className={`${styles.importDrop}${isDragging ? ` ${styles.importDropActive}` : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
        }}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          hidden
          onChange={(event) => handleFiles(event.target.files)}
        />
        <p>Drop an image here, click to browse, or paste from the clipboard</p>
        <p className={styles.importHint}>
          JPEG · PNG · WebP · AVIF · GIF · BMP · TIFF
        </p>
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      {resume}

      <p className={styles.importHint}>Or try a sample image</p>
      <div className={styles.sampleGrid}>
        {SAMPLE_IMAGES.map(({ file, label }) => {
          const src = `${import.meta.env.BASE_URL}sample-images/${file}`;
          return (
            <button
              key={file}
              type="button"
              className={styles.sampleItem}
              onClick={() => onSample(src, label)}
            >
              <img src={src} alt={label} loading="lazy" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <p className={styles.importHint}>
        Photos courtesy of{' '}
        <a href="https://www.pexels.com/license/" target="_blank" rel="noreferrer">
          Pexels
        </a>
      </p>
      <p className={styles.importHint}>
        Supported set: {[...ACCEPTED_IMAGE_TYPES].map((type) => type.replace('image/', '')).join(', ')}
      </p>
      <p className={styles.importHint}>
        HEIC/HEIF isn’t supported by browsers yet — export the photo as JPEG and try again.
      </p>
    </div>
  );
}
