import type { ReactNode } from 'react';

type CardProps = {
  id?: string;
  className?: string;
  legend?: ReactNode;
  focused?: boolean;
  children: ReactNode;
};

/** Renders as a <fieldset> so grouped form controls keep native a11y
 * semantics, while carrying the themed card look (border/radius/shadow). */
export function Card({ id, className = '', legend, focused = false, children }: CardProps) {
  const classes = `card${focused ? ' card--focused' : ''} ${className}`.trim();
  return (
    <fieldset id={id} className={classes}>
      {legend && <legend>{legend}</legend>}
      {children}
    </fieldset>
  );
}
