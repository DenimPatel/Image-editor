import type { Doc, Size } from '../model/types';

export type RenderRequest = {
  source: TexImageSource;
  sourceSize: Size;
  doc: Doc;
  size: Size;
};

/**
 * The one interface the editor talks to. `Editor` never branches on engine:
 * capabilities pick a backend at boot, and an unrecoverable WebGL context
 * loss swaps back to Canvas2D behind the same contract.
 */
export interface RenderBackend {
  readonly kind: 'gl' | 'canvas2d';
  readonly canvas: HTMLCanvasElement;
  render(request: RenderRequest): void;
  dispose(): void;
}
