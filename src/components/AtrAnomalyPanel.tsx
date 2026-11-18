import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { computeAtrAnomalyReport } from '../lib/quant';
import type { AtrAnomalyLevel, IndicatorBar } from '../types/trading';
import { AtrAnomalyChart } from './Charts';

interface AtrAnomalyPanelProps {
  symbol: string;
  stockName: string;
  currencySymbol: string;
  atrMultiplier: number;
  bars: IndicatorBar[];
}

type LookbackWindowOption = 60 | 120 | 250;

function statusColors(level: AtrAnomalyLevel): {
  text: string;
  banner: string;
  cardHighlight: string;
} {
  if (level === 'extreme') {
    return {
      text: 'text-rose-400',
      banner: 'border-rose-500/60 bg-rose-950/35 text-rose-100',
      cardHighlight: 'border-rose-500/50',
    };
  }
  if (level === 'elevated') {
    return {
      text: 'text-amber-300',
      banner: 'border-amber-500/50 bg-amber-950/25 text-amber-100',
      cardHighlight: 'border-amber-500/45',
    };
  }
  if (level === 'compressed') {
    return {
      text: 'text-sky-300',
      banner: 'border-sky-500/40 bg-sky-950/20 text-sky-100',
      cardHighlight: 'border-slate-800',
    };
  }
  return {
    text: 'text-emerald-400',
    banner: 'border-slate-800 bg-slate-900/50 text-slate-200',
    cardHighlight: 'border-slate-800',
  };
}

export const AtrAnomalyPanel: React.FC<AtrAnomalyPanelProps> = ({
  symbol,
  stockName,
  currencySymbol,
  atrMultiplier,
  bars,
}) => {
  const [windowDays, setWindowDays] = useState<LookbackWindowOption>(120);

  const report = useMemo(
    () => computeAtrAnomalyReport(bars, windowDays, atrMultiplier),
    [bars, windowDays, atrMultiplier]
  );

  if (!report) {
    return (
      <section className="rounded-lg border border-slate-800 bg-[#0F172A] p-5 space-y-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-sky-400 shrink-0" />
          <h3 className="text-base font-semibold text-slate-100">
            ATR 波动异常监测
          </h3>
        </div>
        <p className="text-xs text-slate-400">
          当前 {symbol} 有效历史 K 线样本不足 24 日，暂无法建立 ATR 历史均值基线。
        </p>
      </section>
    );
  }

  const palette = statusColors(report.level);
  const isRiskElevated = report.level === 'extreme' || report.level === 'elevated';

  return (
    <section
      className={`rounded-lg border ${palette.cardHighlight} bg-[#0F172A] p-5 space-y-4 transition-colors`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            {report.level === 'extreme' ? (
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            ) : report.level === 'elevated' ? (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            ) : (
              <Activity className="w-4 h-4 text-sky-400 shrink-0" />
            )}
            <h3 className="text-base font-semibold text-slate-100">
              ATR 波动异常监测 · 历史均值偏离预警
            </h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="text-slate-200 font-medium">{stockName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{symbol}</span>
            <span aria-hidden="true">·</span>
            <span className={`font-medium ${palette.text}`}>{report.levelLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              基线样本 {report.sampleCount} 个交易日
            </span>
          </div>
        </div>

        {/* Lookback Baseline Window Toggle */}
        <div className="flex items-center rounded-md bg-slate-900 p-0.5 border border-slate-800 text-xs">
          {([60, 120, 250] as LookbackWindowOption[]).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindowDays(w)}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 font-mono ${
                windowDays === w
                  ? 'bg-sky-500/20 text-sky-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {w}日均值
            </button>
          ))}
        </div>
      </div>

      {/* High-Visibility Risk Alert Banner */}
      <div
        role={isRiskElevated ? 'alert' : 'status'}
        className={`rounded-md border px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${palette.banner}`}
      >
        <div className="flex items-start gap-2.5 min-w-0">
          {report.level === 'extreme' ? (
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          ) : report.level === 'elevated' ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          ) : report.level === 'compressed' ? (
            <Activity className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1 min-w-0">
            <div className="text-xs font-semibold leading-snug">
              {report.levelLabel}：{report.headline}
            </div>
            <p className="text-xs opacity-90 leading-relaxed">{report.guidance}</p>
          </div>
        </div>

        <div className="sm:text-right font-mono tabular-nums shrink-0 sm:pl-4 sm:border-l sm:border-slate-700/60">
          <div className="text-[11px] opacity-75">相对历史均值倍数</div>
          <div className={`text-lg font-semibold ${palette.text}`}>
            {report.ratioToMean.toFixed(2)}×
          </div>
        </div>
      </div>

      {/* 4-Column Tabular Telemetry Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-800 border-b border-slate-800 pb-4 font-mono tabular-nums">
        <div className="pr-4 py-1">
          <div className="text-[11px] text-slate-400">当前 ATR14 / 占价率</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-semibold text-slate-100">
              {currencySymbol}
              {report.currentAtr.toFixed(2)}
            </span>
            <span className={`text-xs font-medium ${palette.text}`}>
              {report.currentAtrPct.toFixed(2)}%
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            窗口峰值 {report.maxAtrPct.toFixed(2)}% ({report.maxAtrDate})
          </div>
        </div>

        <div className="lg:px-4 py-1">
          <div className="text-[11px] text-slate-400">
            {report.sampleCount}日历史均值对比
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-semibold text-slate-200">
              {currencySymbol}
              {report.histMeanAtr.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400">
              {report.histMeanAtrPct.toFixed(2)}%
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            警戒线 1.25× ({report.warningThresholdPct.toFixed(2)}%)
          </div>
        </div>

        <div className="lg:px-4 py-1">
          <div className="text-[11px] text-slate-400">波动偏离度 / Z-Score</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-lg font-semibold ${palette.text}`}>
              {report.deviationPct >= 0 ? '+' : ''}
              {report.deviationPct.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-300">
              {report.zScore >= 0 ? '+' : ''}
              {report.zScore.toFixed(2)}σ
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            区间历史分位 {report.percentileRank.toFixed(0)}%
          </div>
        </div>

        <div className="lg:pl-4 py-1">
          <div className="text-[11px] text-slate-400">最新单日 TR 冲击比</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-lg font-semibold ${
                report.latestTrToAtrRatio >= 2.0
                  ? 'text-rose-400'
                  : report.latestTrToAtrRatio >= 1.5
                    ? 'text-amber-300'
                    : 'text-slate-100'
              }`}
            >
              {report.latestTrToAtrRatio.toFixed(2)}× ATR
            </span>
            <span className="text-xs text-slate-400">
              {report.latestTrPct.toFixed(2)}%
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            单日真实波幅 {currencySymbol}
            {report.latestTr.toFixed(2)}
          </div>
        </div>
      </div>

      {/* ATR% Trajectory vs Historical Mean & Anomaly Threshold Chart */}
      <AtrAnomalyChart report={report} currencySymbol={currencySymbol} />
    </section>
  );
};
