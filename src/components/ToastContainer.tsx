import React from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { ToastMessage } from '../types/trading';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2.5rem)] pointer-events-none"
    >
      {toasts.map((t) => {
        const icon =
          t.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : t.type === 'warning' ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          ) : t.type === 'error' ? (
            <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          );

        const borderClass =
          t.type === 'success'
            ? 'border-emerald-700/60'
            : t.type === 'warning'
              ? 'border-amber-700/60'
              : t.type === 'error'
                ? 'border-rose-700/60'
                : 'border-sky-700/60';

        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start justify-between gap-3 rounded-lg border ${borderClass} bg-[#0F172A]/95 backdrop-blur px-4 py-3 shadow-lg`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              {icon}
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-100 leading-snug">
                  {t.title}
                </div>
                {t.detail && (
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    {t.detail}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="关闭提示"
              className="text-slate-500 hover:text-slate-200 transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
