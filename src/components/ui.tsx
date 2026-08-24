import { useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { formatUserError } from '@/lib/errors';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm px-5 py-4 border-b border-stone-100 flex items-center justify-between rounded-t-3xl">
          <h2 className="text-lg font-semibold text-stone-800">{title}</h2>
          <button
            onClick={onClose}
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
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-stone-700">{label}</label>
      {children}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  error?: boolean;
};

export function Input({ error, className = '', ...props }: InputProps) {
  return (
    <input
      className={`w-full px-4 py-2.5 rounded-xl border bg-white text-stone-800 placeholder:text-stone-400 outline-none transition-colors ${
        error ? 'border-red-300 focus:border-red-400' : 'border-stone-200 focus:border-rose-300'
      } focus:ring-2 focus:ring-rose-100 ${className}`}
      {...props}
    />
  );
}

type ButtonProps = {
  children: ReactNode;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
};

export function Button({
  children,
  loading,
  variant = 'primary',
  type = 'button',
  onClick,
  disabled,
  className = '',
}: ButtonProps) {
  const variants = {
    primary: 'bg-rose-400 text-white hover:bg-rose-500 active:bg-rose-600 shadow-sm',
    secondary: 'bg-stone-100 text-stone-700 hover:bg-stone-200 active:bg-stone-300',
    ghost: 'text-stone-600 hover:bg-stone-100',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`px-4 py-2.5 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
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
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
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
