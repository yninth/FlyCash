import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { MacroResponse } from '../types/trading';

interface MacroStripProps {
  macro: MacroResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export const MacroStrip: React.FC<MacroStripProps> = ({
  macro,
  loading,
  error,
  onRefresh,
}) => {
  if (error) {
    return (
      <div className="border-b border-slate-800 bg-[#0F172A]/60 px-6 py-2 flex items-center justify-between text-xs text-rose-400">
        <span>宏观报价暂时不可用：{error}</span>
        <button
          type="button"
          onClick={onRefresh}
          className="text-slate-300 hover:text-white underline underline-offset-2 whitespace-nowrap shrink-0"
        >
          重试
        </button>
      </div>
    );
  }

  if (loading && !macro) {
    return (
      <div className="border-b border-slate-800 bg-[#0F172A]/60 px-6 py-2">
        <div className="max-w-[1440px] mx-auto grid grid-cols-3 sm:grid-cols-7 gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-5 rounded bg-slate-800/60 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!macro) return null;

  return (
    <section
      aria-label="全球宏观风向参考"
      className="border-b border-slate-800 bg-[#0F172A]/60 px-4 sm:px-6 py-2"
    >
      <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
        <div className="flex-1 flex items-center gap-5 overflow-x-auto no-scrollbar">
          {macro.items.map((item) => {
            const isPositive = (item.changePct ?? 0) >= 0;
            const formattedPrice =
              item.price === null
                ? 'N/A'
                : item.id === 'usdcny' || item.id === 'hkdcny'
                  ? item.price.toFixed(4)
                  : item.id === 'au_ag'
                    ? `${item.price.toFixed(1)}x`
                    : item.price >= 1000
                      ? item.price.toLocaleString('en-US', { maximumFractionDigits: 0 })
                      : item.price.toFixed(2);

            return (
              <div
                key={item.id}
                className="flex items-baseline gap-2 text-xs whitespace-nowrap shrink-0"
              >
                <span className="text-slate-400">{item.label}</span>
                <span className="font-mono tabular-nums font-semibold text-slate-100">
                  {item.category === 'crypto' || item.id === 'gold' || item.id === 'silver'
                    ? `$${formattedPrice}`
                    : formattedPrice}
                </span>
                {item.changePct !== null && (
                  <span
                    className={`font-mono tabular-nums text-[11px] font-medium ${
                      isPositive ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {isPositive ? '+' : ''}
                    {item.changePct.toFixed(2)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title={`宏观报价更新于 ${new Date(macro.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`}
          className="inline-flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-400 hover:text-sky-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">
            {new Date(macro.updatedAt).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </span>
        </button>
      </div>
    </section>
  );
};
