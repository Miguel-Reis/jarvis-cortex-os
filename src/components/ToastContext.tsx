import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  title: string;
  detail?: string;
  tone?: 'info' | 'success' | 'warning' | 'error';
}

interface ToastContextValue {
  pushToast: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue>({
  pushToast: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = `tst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none"
      >
        {toasts.map((item) => {
          const borderClass =
            item.tone === 'success'
              ? 'border-emerald-500/40'
              : item.tone === 'error'
                ? 'border-rose-500/45'
                : item.tone === 'warning'
                  ? 'border-amber-500/45'
                  : 'border-cyan-500/40';
          return (
            <div
              key={item.id}
              className={`pointer-events-auto bg-[#0d1117]/95 backdrop-blur border ${borderClass} rounded-lg p-3 shadow-lg flex items-start gap-2.5 text-xs`}
            >
              <div className="mt-0.5 shrink-0">
                {item.tone === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : item.tone === 'error' || item.tone === 'warning' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                ) : (
                  <Info className="w-4 h-4 text-cyan-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-100">{item.title}</p>
                {item.detail && <p className="text-slate-400 mt-0.5 break-words">{item.detail}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Fechar notificação"
                className="text-slate-500 hover:text-slate-200 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
