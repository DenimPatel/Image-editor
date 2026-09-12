import { describe, expect, it, beforeAll } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import Hub from './Hub';
import Editor from './Editor';

beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function render(path: string): string {
  const router = createMemoryRouter(
    [
      { path: '/', element: <Hub /> },
      { path: '/editor', element: <Editor /> },
      { path: '/editor/:tool', element: <Editor /> },
    ],
    { initialEntries: [path], basename: '/' },
  );
  return renderToString(<RouterProvider router={router} />);
}

describe('app shell smoke render', () => {
  it('renders the hub', () => {
    const html = render('/');
    expect(html).toContain('Edit images');
  });

  it('renders the editor import screen without a source', () => {
    const html = render('/editor');
    expect(html).toContain('Edit an image');
  });

  it('renders the editor at a tool route', () => {
    const html = render('/editor/passport');
    expect(html).toContain('Edit an image');
  });
});
