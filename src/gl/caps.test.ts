import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeCaps, type Caps } from './caps';

function makeFakeCanvas() {
  return {
    width: 0,
    height: 0,
    getContext(kind: string) {
      if (kind === 'webgl2') {
        return {
          MAX_TEXTURE_SIZE: 0x0d33,
          MAX_RENDERBUFFER_SIZE: 0x8d41,
          getExtension: (name: string) =>
            name === 'EXT_color_buffer_half_float' ? {} : null,
          getParameter: (param: number) => (param === 0x0d33 ? 8192 : 4096),
        };
      }
      if (kind === '2d') {
        return {
          fillStyle: '',
          fillRect: () => undefined,
          getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
        };
      }
      return null;
    },
    toDataURL: (mime: string) => (mime === 'image/webp' ? 'data:image/webp;base64,' : 'data:,') ,
  };
}

describe('probeCaps', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports WebGL2 capabilities from a stubbed context', () => {
    vi.spyOn(document, 'createElement').mockImplementation(() => makeFakeCanvas() as unknown as HTMLElement);
    const caps: Caps = probeCaps();
    expect(caps.webgl2).toBe(true);
    expect(caps.colorBufferHalfFloat).toBe(true);
    expect(caps.linearFloat).toBe(false);
    expect(caps.maxTextureSize).toBe(8192);
    expect(caps.maxRenderbufferSize).toBe(4096);
    expect(caps.maxCanvasArea).toBe(4096 * 4096);
    expect(caps.formats.webp).toBe(true);
  });

  it('falls back cleanly when webgl2 is unavailable', () => {
    vi.spyOn(document, 'createElement').mockImplementation(
      () =>
        ({
          width: 0,
          height: 0,
          getContext: (kind: string) => (kind === '2d' ? {
            fillStyle: '',
            fillRect: () => undefined,
            getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
          } : null),
          toDataURL: () => 'data:,',
        }) as unknown as HTMLElement,
    );
    const caps = probeCaps();
    expect(caps.webgl2).toBe(false);
    expect(caps.maxCanvasArea).toBe(4096 * 4096);
    expect(caps.formats.webp).toBe(false);
  });
});
