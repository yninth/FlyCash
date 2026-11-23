import React, { useMemo, useState } from 'react';
import { computeVolatilityCalendar } from '../lib/quant';
import type {
  IndicatorBar,
  VolatilityCalendarDay,
  VolatilityCalendarMetric,
} from '../types/trading';

interface VolatilityCalendarHeatmapProps {
  symbol: string;
  indicatorBars: IndicatorBar[];
  liveAtmIv: number | null;
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五'];

function getCellClass(day: VolatilityCalendarDay): string {
  if (day.isFutureInWeek) {
    return 'bg-transparent border border-transparent cursor-default';
  }
  if (!day.isTradingDay || day.value === null || day.percentile6M === null) {
    return 'bg-slate-900/70 border border-slate-800/70 hover:border-slate-700';
  }
  const p = day.percentile6M;
  if (p <= 20) {
    return 'bg-emerald-500/80 border border-emerald-400/50 hover:border-emerald-200';
  }
  if (p <= 40) {
    return 'bg-teal-600/70 border border-teal-500/40 hover:border-teal-300';
  }
  if (p <= 65) {
    return 'bg-sky-700/65 border border-sky-500/40 hover:border-sky-300';
  }
  if (p <= 85) {
    return 'bg-amber-500/75 border border-amber-400/50 hover:border-amber-200';
  }
  return 'bg-rose-500/85 border border-rose-400/60 hover:border-rose-200';
}

function getZoneLabel(p: number | null): { text: string; cls: string } {
  if (p === null) return { text: '休市 / 无数据', cls: 'text-slate-500' };
  if (p <= 30) return { text: '低波买方窗口', cls: 'text-emerald-400' };
  if (p >= 70) return { text: '高波卖方窗口', cls: 'text-rose-400' };
  return { text: '波动中性区间', cls: 'text-sky-300' };
}

export const VolatilityCalendarHeatmap: React.FC<VolatilityCalendarHeatmapProps> = ({
  symbol,
  indicatorBars,
  liveAtmIv,
}) => {
  const [metricMode, setMetricMode] = useState<VolatilityCalendarMetric>('est_iv');
  const [hoveredDay, setHoveredDay] = useState<VolatilityCalendarDay | null>(null);
  const [pinnedDay, setPinnedDay] = useState<VolatilityCalendarDay | null>(null);

  const report = useMemo(
    () => computeVolatilityCalendar(indicatorBars, liveAtmIv, metricMode),
    [indicatorBars, liveAtmIv, metricMode]
  );

  if (!report) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-4 sm:p-5">
        <div className="text-sm font-semibold text-slate-100">
          近6个月波动率日历热力图 · {symbol}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          历史正股K线样本积累中（需至少近6个月有效交易日），暂无法生成波动率日历热力矩阵。
        </p>
      </div>
    );
  }

  const activeDay = hoveredDay ?? pinnedDay ?? report.latestTradingDay;
  const activeZone = getZoneLabel(activeDay?.percentile6M ?? null);

  return (
    <section className="rounded-lg border border-slate-800 bg-[#0F172A] p-4 sm:p-5 space-y-4">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            近6个月波动率日历热力图 (IV Entry Calendar) · {symbol}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>{report.startDate} 至 {report.endDate}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{report.tradingDayCount} 个交易日</span>
            <span aria-hidden="true">·</span>
            <span>点击或悬停任意日期查看当日波动率分位与入场参考</span>
          </div>
        </div>

        <div className="flex items-center rounded-md bg-slate-900 p-1 border border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => {
              setMetricMode('est_iv');
              setPinnedDay(null);
            }}
            className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
              metricMode === 'est_iv'
                ? 'bg-sky-500/20 text-sky-300 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            隐波推算 Est. IV
          </button>
          <button
            type="button"
            onClick={() => {
              setMetricMode('hv20');
              setPinnedDay(null);
            }}
            className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
              metricMode === 'hv20'
                ? 'bg-sky-500/20 text-sky-300 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            实际波动 HV20
          </button>
        </div>
      </div>

      {/* 4-Column Summary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 gap-3 sm:gap-0">
        <div className="sm:pr-4">
          <div className="text-xs text-slate-400">
            {metricMode === 'est_iv' ? '今日实时平值 ATM IV' : '最新20日实际波动 HV20'}
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-semibold text-slate-100">
              {report.currentValue !== null ? `${report.currentValue.toFixed(1)}%` : '—'}
            </span>
            {report.currentPercentile !== null && (
              <span
                className={`text-xs font-medium ${
                  report.currentPercentile <= 30
                    ? 'text-emerald-400'
                    : report.currentPercentile >= 70
                      ? 'text-rose-400'
                      : 'text-sky-300'
                }`}
              >
                6M分位 {report.currentPercentile.toFixed(0)}%
              </span>
            )}
          </div>
        </div>

        <div className="sm:px-4">
          <div className="text-xs text-slate-400">6个月区间 (低 / 中位 / 高)</div>
          <div className="mt-1 font-mono tabular-nums text-sm font-semibold text-slate-200">
            <span className="text-emerald-400">{report.minVal.toFixed(1)}%</span>
            <span className="text-slate-600 mx-1.5">/</span>
            <span>{report.medianVal.toFixed(1)}%</span>
            <span className="text-slate-600 mx-1.5">/</span>
            <span className="text-rose-400">{report.maxVal.toFixed(1)}%</span>
          </div>
        </div>

        <div className="sm:px-4">
          <div className="text-xs text-slate-400">买方低波 / 卖方高波阈值</div>
          <div className="mt-1 font-mono tabular-nums text-sm font-semibold">
            <span className="text-emerald-400">≤ {report.lowVolThreshold.toFixed(1)}%</span>
            <span className="text-slate-600 mx-2">·</span>
            <span className="text-rose-400">≥ {report.highVolThreshold.toFixed(1)}%</span>
          </div>
        </div>

        <div className="sm:pl-4">
          <div className="text-xs text-slate-400">当前入场机会研判</div>
          <div
            className={`mt-1 text-sm font-semibold ${
              report.entrySignal === 'buyer'
                ? 'text-emerald-400'
                : report.entrySignal === 'seller'
                  ? 'text-rose-400'
                  : 'text-sky-300'
            }`}
          >
            {report.entryHeadline}
          </div>
        </div>
      </div>

      {/* Calendar Matrix (26-27 weeks x Mon-Fri) */}
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[660px] select-none">
          {/* Month Headers aligned above starting weeks */}
          <div className="flex items-center gap-1.5 mb-1.5 pl-6">
            {report.weeks.map((week) => (
              <div
                key={`hdr-${week.weekStart}`}
                className="flex-1 min-w-[18px] text-[10px] font-mono text-slate-400 whitespace-nowrap"
              >
                {week.monthLabel || ''}
              </div>
            ))}
          </div>

          {/* 5 Weekday Rows */}
          <div className="flex gap-1.5">
            {/* Weekday Y-axis */}
            <div className="flex flex-col justify-between gap-1.5 pr-1 text-[10px] text-slate-500">
              {WEEKDAY_LABELS.map((w) => (
                <div key={w} className="flex-1 flex items-center justify-end h-5">
                  {w}
                </div>
              ))}
            </div>

            {/* Week Columns */}
            <div className="flex-1 flex gap-1.5">
              {report.weeks.map((week) => (
                <div key={week.weekStart} className="flex-1 flex flex-col gap-1.5 min-w-[18px]">
                  {week.days.map((day) => {
                    const isSelected = activeDay?.date === day.date;
                    return (
                      <button
                        key={day.date}
                        type="button"
                        disabled={day.isFutureInWeek}
                        onMouseEnter={() => {
                          if (!day.isFutureInWeek) setHoveredDay(day);
                        }}
                        onMouseLeave={() => setHoveredDay(null)}
                        onClick={() => {
                          if (!day.isFutureInWeek && day.isTradingDay) {
                            setPinnedDay((prev) => (prev?.date === day.date ? null : day));
                          }
                        }}
                        title={
                          day.isFutureInWeek
                            ? ''
                            : day.isTradingDay && day.value !== null
                              ? `${day.date}: ${day.value.toFixed(1)}% (6M分位 ${day.percentile6M?.toFixed(0)}%)`
                              : `${day.date}: 休市`
                        }
                        className={`w-full h-5 rounded-[3px] transition-transform duration-150 ${getCellClass(day)} ${
                          day.isLiveAnchor
                            ? 'ring-1 ring-white/90'
                            : isSelected && !day.isFutureInWeek
                              ? 'ring-1 ring-sky-300/90 scale-[1.08]'
                              : ''
                        }`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Inline Day Inspector Bar (zero layout jitter) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-900/60 px-3.5 py-2.5 text-xs">
        {activeDay && activeDay.isTradingDay ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums">
            <span className="font-semibold text-slate-100">
              {activeDay.date} (周{WEEKDAY_LABELS[activeDay.weekday - 1]})
              {activeDay.isLiveAnchor && (
                <span className="ml-1.5 text-[11px] text-sky-300 font-sans font-medium">
                  · 今日实时期权链锚点
                </span>
              )}
            </span>
            <span className="text-slate-300">
              {activeDay.isLiveAnchor ? 'ATM IV' : 'Est. IV'}{' '}
              <strong className="text-slate-100">
                {activeDay.estimatedIv !== null ? `${activeDay.estimatedIv.toFixed(1)}%` : '—'}
              </strong>
            </span>
            <span className="text-slate-400">
              HV20{' '}
              <strong className="text-slate-200">
                {activeDay.hv20 !== null ? `${activeDay.hv20.toFixed(1)}%` : '—'}
              </strong>
            </span>
            {activeDay.close !== null && (
              <span className="text-slate-400">
                收盘 <strong className="text-slate-200">${activeDay.close.toFixed(2)}</strong>
                {activeDay.dailyReturnPct !== null && (
                  <span
                    className={`ml-1 ${
                      activeDay.dailyReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    ({activeDay.dailyReturnPct >= 0 ? '+' : ''}
                    {activeDay.dailyReturnPct.toFixed(2)}%)
                  </span>
                )}
              </span>
            )}
            <span className={`font-sans font-medium ${activeZone.cls}`}>
              {activeZone.text}
              {activeDay.percentile6M !== null && ` (${activeDay.percentile6M.toFixed(0)}分位)`}
            </span>
          </div>
        ) : (
          <div className="text-xs font-mono text-slate-400">
            {activeDay ? `${activeDay.date} · 美股休市日 / 无期权交易记录` : '悬停日历单元格查看当日详情'}
          </div>
        )}

        {/* Discrete Legend */}
        <div className="flex items-center gap-2 text-[11px] text-slate-400 shrink-0">
          <span>低波买方</span>
          <span className="w-3 h-3 rounded-[2px] bg-emerald-500/80 border border-emerald-400/50" />
          <span className="w-3 h-3 rounded-[2px] bg-teal-600/70 border border-teal-500/40" />
          <span className="w-3 h-3 rounded-[2px] bg-sky-700/65 border border-sky-500/40" />
          <span className="w-3 h-3 rounded-[2px] bg-amber-500/75 border border-amber-400/50" />
          <span className="w-3 h-3 rounded-[2px] bg-rose-500/85 border border-rose-400/60" />
          <span>高波卖方</span>
          <span className="text-slate-700">|</span>
          <span className="w-3 h-3 rounded-[2px] bg-slate-900/70 border border-slate-800/70" />
          <span>休市</span>
        </div>
      </div>

      {/* Entry Strategy Guidance & Methodology Footnote */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400">
        <p className="leading-relaxed">{report.entryGuidance}</p>
        <span className="text-[11px] text-slate-500 shrink-0">
          历史日线由 HV20 与当前 IV/HV 溢价比 ({report.ivToHvRatio.toFixed(2)}×) 锚定推算
        </span>
      </div>
    </section>
  );
};
