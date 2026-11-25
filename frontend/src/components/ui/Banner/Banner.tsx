import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cn } from '../_internal/cn';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import './Banner.css';

export type Severity = 'info' | 'success' | 'warning' | 'danger';

export function Banner({
  severity = 'info',
  title,
  children,
  onDismiss,
  className,
}: {
  severity?: Severity;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const iconName =
    severity === 'success' ? 'check-circle' : severity === 'info' ? 'info' : 'alert';

  return (
    <div
      data-ui="banner"
      role={severity === 'danger' || severity === 'warning' ? 'alert' : 'status'}
      data-severity={severity}
      className={cn('org-banner', className)}
    >
      <span className="org-banner__icon">
        <Icon name={iconName} size="md" />
      </span>
      <div className="org-banner__body">
        {title && <strong className="org-banner__title">{title}</strong>}
        <span>{children}</span>
      </div>
      {onDismiss && (
        <Button variant="icon" size="sm" aria-label="Dismiss" onClick={onDismiss}>
          <Icon name="close" size="sm" />
        </Button>
      )}
    </div>
  );
}

interface ToastItem {
  id: number;
  severity: Severity;
  message: string;
}

const ToastContext = createContext<{ push: (severity: Severity, message: string) => void } | null>(
  null,
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((severity: Severity, message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, severity, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="org-toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} data-severity={t.severity} className="org-toast">
            <span>{t.message}</span>
            <Button
              variant="icon"
              size="sm"
              aria-label="Close toast"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            >
              <Icon name="close" size="sm" />
            </Button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  return (
    ctx ?? {
      push: () => {
        /* no-op outside provider */
      },
    }
  );
}

