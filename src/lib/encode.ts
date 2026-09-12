import type { ExportFormat } from '../model/types';

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode canvas to blob'));
      },
      mime,
      quality,
    );
  });
}

/**
 * Encodes the final canvas for the given format. PDF is a real
 * application/pdf blob (the original Python app emitted a data:image/pdf URL
 * and rendered it in an <img> tag, which showed nothing and downloaded the
 * wrong type).
 */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  quality: number,
): Promise<Blob> {
  switch (format) {
    case 'jpeg':
      return canvasToBlob(canvas, 'image/jpeg', quality);
    case 'png':
      return canvasToBlob(canvas, 'image/png');
    case 'webp':
      return canvasToBlob(canvas, 'image/webp', quality);
    case 'avif':
      return canvasToBlob(canvas, 'image/avif', quality);
    case 'pdf': {
      // Lazily loaded: jsPDF pulls in a large dependency tree that only PDF
      // exports need.
      const { jsPDF } = await import('jspdf');
      const orientation = canvas.width >= canvas.height ? 'landscape' : 'portrait';
      const pdf = new jsPDF({
        orientation,
        unit: 'px',
        format: [canvas.width, canvas.height],
      });
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      pdf.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height);
      return pdf.output('blob');
    }
  }
}

export function extensionFor(format: ExportFormat): string {
  switch (format) {
    case 'jpeg':
      return 'jpg';
    case 'png':
      return 'png';
    case 'webp':
      return 'webp';
    case 'avif':
      return 'avif';
    case 'pdf':
      return 'pdf';
  }
}

export function mimeFor(format: ExportFormat): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'pdf':
      return 'application/pdf';
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}