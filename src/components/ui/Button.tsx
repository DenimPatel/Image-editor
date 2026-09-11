import type { ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'ghost';

type ButtonAsButton = { as?: 'button' } & ButtonHTMLAttributes<HTMLButtonElement>;
type ButtonAsLink = { as: 'link' } & LinkProps;

type ButtonProps = { variant?: Variant } & (ButtonAsButton | ButtonAsLink);

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  const classes = `btn btn-${variant} ${className}`.trim();

  if (rest.as === 'link') {
    const { as, ...linkProps } = rest;
    void as;
    return <Link {...linkProps} className={classes} />;
  }

  const { as, ...buttonProps } = rest;
  void as;
  return <button type="button" {...buttonProps} className={classes} />;
}
