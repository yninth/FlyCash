import React, { useEffect } from 'react';
import { Cloud, CloudOff, LogIn, LogOut, SlidersHorizontal, UploadCloud, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import { formatMoney } from '../lib/quant';
import type { GlobalRiskConfig, ToastType } from '../types/trading';

interface RiskCloudDrawerProps {
  open: boolean;
  onClose: () => void;
  user: User | null;
  authReady: boolean;
  authBusy: boolean;
  onGoogleSignIn: () => void;
  onSignOut: () => void;
  onUploadLocalToCloud: () => void;
  riskConfig: GlobalRiskConfig;
  onUpdateRiskConfig: (patch: Partial<GlobalRiskConfig>) => void;
  usdCny: number;
  hkdCny: number;
  onNotify: (type: ToastType, title: string, detail?: string) => void;
}

export const RiskCloudDrawer: React.FC<RiskCloudDrawerProps> = ({
  open,
  onClose,
  user,
  authReady,
  authBusy,
  onGoogleSignIn,
  onSignOut,
  onUploadLocalToCloud,
  riskConfig,
  onUpdateRiskConfig,
  usdCny,
  hkdCny,
  onNotify,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const stockMaxLossCny = riskConfig.totalCapitalCny * (riskConfig.stockRiskPct / 100);
  const optionMaxPremCny = riskConfig.totalCapitalCny * (riskConfig.optionRiskPct / 100);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="全局风控标尺与云端同步"
    >
      <div
        className="w-full max-w-sm h-full bg-[#0F172A] border-l border-slate-800 flex flex-col justify-between overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                全局风控标尺与云端同步
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭设置面板"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Cloud Sync Account Section */}
          <div className="pb-5 border-b border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">云端数据同步</span>
              {user ? (
                <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                  <Cloud className="w-3.5 h-3.5" />
                  已连接云端
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-slate-400">
                  <CloudOff className="w-3.5 h-3.5" />
                  仅本地存储
                </span>
              )}
            </div>

            {user ? (
              <div className="space-y-2.5">
                <div className="text-xs text-slate-200 font-medium truncate">
                  {user.displayName || user.email}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  我的账本、自选雷达、价格提醒与风控标尺已开启云端实时同步，电脑与手机登录同一账号即可共享。
                </p>
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onUploadLocalToCloud}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600 transition-colors"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    合并本机历史账本到云端
                  </button>
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-400 hover:text-rose-300 hover:border-rose-900/50 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    退出登录
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  登录后可将我的账本、自选标的、价格提醒与风控参数同步至云端，支持手机与远程跨端访问。
                </p>
                <button
                  type="button"
                  onClick={onGoogleSignIn}
                  disabled={!authReady || authBusy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25 disabled:opacity-50 transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  {authBusy ? '正在登录...' : '登录 Google 开启云同步'}
                </button>
              </div>
            )}
          </div>

          {/* Global Risk Sizing Controls */}
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-200">
                全局以损定仓标尺
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                所有三地正股与美股期权的仓位上限均按此人民币总本金自动折算。
              </p>
            </div>

            <div>
              <label htmlFor="drawer-total-cap" className="block text-xs text-slate-400 mb-1.5">
                总交易本金 (人民币 CNY)
              </label>
              <input
                id="drawer-total-cap"
                type="number"
                step={10000}
                min={10000}
                value={riskConfig.totalCapitalCny}
                onChange={(e) =>
                  onUpdateRiskConfig({
                    totalCapitalCny: Math.max(10000, Number(e.target.value) || 10000),
                  })
                }
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-400">正股单笔最大止损</span>
                <span className="font-mono tabular-nums text-sky-300 font-semibold">
                  {riskConfig.stockRiskPct.toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={3.0}
                step={0.1}
                value={riskConfig.stockRiskPct}
                onChange={(e) => onUpdateRiskConfig({ stockRiskPct: Number(e.target.value) })}
                className="w-full accent-sky-400"
              />
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                单笔亏损预算 {formatMoney(stockMaxLossCny)}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-400">期权单笔权利金上限</span>
                <span className="font-mono tabular-nums text-amber-300 font-semibold">
                  {riskConfig.optionRiskPct.toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={5.0}
                step={0.5}
                value={riskConfig.optionRiskPct}
                onChange={(e) => onUpdateRiskConfig({ optionRiskPct: Number(e.target.value) })}
                className="w-full accent-amber-400"
              />
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                权利金上限 {formatMoney(optionMaxPremCny)} (${(optionMaxPremCny / usdCny).toFixed(0)})
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-400">正股止损宽度 (ATR倍数)</span>
                <span className="font-mono tabular-nums text-slate-200 font-semibold">
                  {riskConfig.atrMultiplier.toFixed(1)}×
                </span>
              </div>
              <input
                type="range"
                min={1.0}
                max={4.0}
                step={0.5}
                value={riskConfig.atrMultiplier}
                onChange={(e) => onUpdateRiskConfig({ atrMultiplier: Number(e.target.value) })}
                onMouseUp={() =>
                  onNotify('info', '已更新全局风控标尺', '所有建议仓位与止损已自动重新测算')
                }
                className="w-full accent-sky-400"
              />
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-slate-800 space-y-2 text-xs text-slate-400 bg-slate-900/40">
          <div className="font-medium text-slate-300">汇率折算基准</div>
          <div className="flex justify-between font-mono tabular-nums">
            <span>USD / CNY</span>
            <span className="text-slate-200">{usdCny.toFixed(4)}</span>
          </div>
          <div className="flex justify-between font-mono tabular-nums">
            <span>HKD / CNY</span>
            <span className="text-slate-200">{hkdCny.toFixed(4)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
