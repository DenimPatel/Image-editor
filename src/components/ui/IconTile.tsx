import type { ReactNode } from 'react';

export function IconTile({ children }: { children: ReactNode }) {
  return <span className="icon-tile">{children}</span>;
}
