import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './controls.module.css';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  children: ReactNode;
};

export function IconButton({ label, active, className = '', children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`${styles.iconButton}${active ? ` ${styles.iconButtonActive}` : ''} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
