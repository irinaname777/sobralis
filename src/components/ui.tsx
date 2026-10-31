import { cloneElement, isValidElement, useEffect, useId, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { formatUserError } from '@/lib/errors';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

export function Modal({ open, onClose, title, children }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} aria-label="Закрыть диалог" tabIndex={-1} />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative w-full rounded-t-3xl bg-white shadow-2xl max-h-[92dvh] overflow-y-auto animate-slide-up sm:max-w-lg sm:rounded-3xl">
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm px-5 py-4 border-b border-stone-100 flex items-center justify-between rounded-t-3xl">
          <h2 id={titleId} className="text-lg font-semibold text-stone-800">{title}</h2>
          <button
            onClick={onClose}
            type="button"
            aria-label="Закрыть"
            className="p-1.5 rounded-full hover:bg-stone-100 transition-colors text-stone-500"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

type FormFieldProps = {
  label: string;
  error?: string;
  children: ReactNode;
};

export function FormField({ label, error, children }: FormFieldProps) {
  const inputId = useId();
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>, {
      id: inputId,
      ...(error ? { 'aria-describedby': `${inputId}-error`, 'aria-invalid': true } : {}),
    })
    : children;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-stone-700">{label}</label>
      {child}
      {error && <p id={`${inputId}-error`} role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  error?: boolean;
};

export function Input({ error, className = '', ...props }: InputProps) {
  return (
    <input
      className={`w-full min-h-11 px-4 py-2.5 rounded-xl border bg-white text-stone-800 placeholder:text-stone-400 outline-none transition-colors ${
        error ? 'border-red-300 focus:border-red-400' : 'border-stone-200 focus:border-rose-300'
      } focus:ring-2 focus:ring-rose-100 ${className}`}
      {...props}
    />
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};

export function Button({
  children,
  loading,
  variant = 'primary',
  type = 'button',
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  const variants = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600 active:bg-rose-700 shadow-sm',
    secondary: 'bg-stone-100 text-stone-700 hover:bg-stone-200 active:bg-stone-300',
    ghost: 'text-stone-600 hover:bg-stone-100',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200',
  };

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-offset-2 ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? 'Сохраняем…' : children}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center mb-4 text-rose-300">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-stone-800 mb-1">{title}</h3>
      <p className="text-sm text-stone-500 mb-4 max-w-xs">{description}</p>
      {action}
    </div>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div role="alert" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

export function useAsyncAction() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await action();
      return result;
    } catch (err) {
      setError(formatUserError(err, 'Не удалось сохранить. Попробуйте ещё раз.'));
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, setError, run };
}

export function Toast({ message, type = 'success' }: { message: string; type?: 'success' | 'error' }) {
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={`fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-full shadow-lg text-sm font-medium animate-slide-up ${
        type === 'success' ? 'bg-stone-800 text-white' : 'bg-red-500 text-white'
      }`}
    >
      {message}
    </div>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex gap-3 mt-6">{children}</div>;
}

export function handleSubmit(onSubmit: () => void) {
  return (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
}
