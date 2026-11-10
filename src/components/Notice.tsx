import type { ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';

/**
 * Inline, accessible message used instead of alert() and console-only errors.
 */
export default function Notice({
  kind = 'info',
  children,
  onClose,
}: {
  kind?: Kind;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      className={`alert ${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span>{children}</span>
      {onClose && (
        <button
          type="button"
          className="notice-close"
          onClick={onClose}
          aria-label="Dismiss message"
        >
          &times;
        </button>
      )}
    </div>
  );
}
