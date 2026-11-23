import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { computeFundFlowForecast } from '../lib/quant';
import type {
  CurrencyType,
  FundFlowChartPoint,
  FundFlowResponse,
  MarketType,
} from '../types/trading';

interface FundFlowForecastPanelProps {
  market: MarketType;
  symbol: string;
  stockName: string;
  currencySymbol: string;
}

type FlowChartTab = 'forecast' | 'breakdown';

function formatFlowAmount(val: number, currSym: string, withSign = true): string {
  const sign = withSign ? (val > 0 ? '+' : val < 0 ? '-' : '') : val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (abs >= 1e8) {
    return `${sign}${currSym}${(abs / 1e8).toFixed(2)}亿`;
  }
  if (abs >= 1e4) {
    return `${sign}${currSym}${(abs / 1e4).toFixed(0)}万`;
  }
  return `${sign}${currSym}${abs.toFixed(0)}`;
}

function formatAxisCompact(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}万`;
  return `${val}`;
}

function currencySymbolOf(c: CurrencyType): string {
  return c === 'CNY' ? '¥' : c === 'HKD' ? 'HK$' : '$';
}

interface FlowTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: FundFlowChartPoint }>;
  currSym: string;
  tab: FlowChartTab;
}

const FlowCustomTooltip: React.FC<FlowTooltipProps> = ({ active, payload, currSym, tab }) => {
  const pt = active && payload && payload.length > 0 ? payload[0]?.payload : undefined;
  if (!pt) return null;

  if (tab === 'breakdown') {
    return (
      <div className="rounded-md border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-xl font-mono tabular-nums space-y-1">
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-1">
          <span className="font-semibold text-slate-100">{pt.label}</span>
          {pt.changePct !== null && (
            <span className={pt.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {pt.changePct >= 0 ? '+' : ''}
              {pt.changePct.toFixed(2)}%
            </span>
          )}
        </div>
        {pt.superLargeNet !== null && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-sky-400">超大单净额</span>
            <span className={pt.superLargeNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {formatFlowAmount(pt.superLargeNet, currSym)}
            </span>
          </div>
        )}
        {pt.largeNet !== null && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-violet-400">大单净额</span>
            <span className={pt.largeNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {formatFlowAmount(pt.largeNet, currSym)}
            </span>
          </div>
        )}
        {pt.mediumNet !== null && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-amber-300">中单净额</span>
            <span className={pt.mediumNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {formatFlowAmount(pt.mediumNet, currSym)}
            </span>
          </div>
        )}
        {pt.smallNet !== null && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">小单净额</span>
            <span className={pt.smallNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {formatFlowAmount(pt.smallNet, currSym)}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-xl font-mono tabular-nums space-y-1">
      <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-1">
        <span className="font-semibold text-slate-100">
          {pt.label} {pt.isForecast ? '(预测区间)' : '(历史实盘)'}
        </span>
        {pt.changePct !== null && (
          <span className={pt.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            {pt.changePct >= 0 ? '+' : ''}
            {pt.changePct.toFixed(2)}%
          </span>
        )}
      </div>

      {!pt.isForecast && pt.histMainNet !== null ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">主力净流入</span>
            <span className={pt.histMainNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {formatFlowAmount(pt.histMainNet, currSym)}
              {pt.mainPct !== null ? ` (${pt.mainPct >= 0 ? '+' : ''}${pt.mainPct.toFixed(2)}%)` : ''}
            </span>
          </div>
          {pt.superLargeNet !== null && pt.largeNet !== null && (
            <div className="flex items-center justify-between gap-4 text-[11px] text-slate-400">
              <span>超大单 / 大单</span>
              <span>
                {formatFlowAmount(pt.superLargeNet, currSym)} / {formatFlowAmount(pt.largeNet, currSym)}
              </span>
            </div>
          )}
        </>
      ) : (
        <>
          {pt.forecastMainNet !== null && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-sky-300">预测中位净流</span>
              <span className={pt.forecastMainNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {formatFlowAmount(pt.forecastMainNet, currSym)}
              </span>
            </div>
          )}
          {pt.forecastRange && (
            <div className="flex items-center justify-between gap-4 text-[11px] text-slate-400">
              <span>P20–P80 区间</span>
              <span>
                {formatFlowAmount(pt.forecastRange[0], currSym)} ~{' '}
                {formatFlowAmount(pt.forecastRange[1], currSym)}
              </span>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between gap-4 border-t border-slate-800/80 pt-1">
        <span className="text-amber-300">累计净流轨迹</span>
        <span className={pt.cumulativeMainNet >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
          {formatFlowAmount(pt.cumulativeMainNet, currSym)}
        </span>
      </div>
    </div>
  );
};

export const FundFlowForecastPanel: React.FC<FundFlowForecastPanelProps> = ({
  market,
  symbol,
  stockName,
  currencySymbol,
}) => {
  const [flowData, setFlowData] = useState<FundFlowResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [horizonDays, setHorizonDays] = useState<5 | 10>(5);
  const [tab, setTab] = useState<FlowChartTab>('forecast');

  const fetchFundFlow = useCallback(
    async (forceRefresh = false) => {
      if (!symbol) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/fund-flow?market=${encodeURIComponent(market)}&symbol=${encodeURIComponent(symbol)}&days=60${
            forceRefresh ? '&refresh=1' : ''
          }`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '资金流向请求失败');
        setFlowData(json as FundFlowResponse);
      } catch (err) {
        setFlowData(null);
        setError(err instanceof Error ? err.message : '资金流向数据暂不可用');
      } finally {
        setLoading(false);
      }
    },
    [market, symbol]
  );

  useEffect(() => {
    fetchFundFlow(false);
  }, [fetchFundFlow]);

  const report = useMemo(
    () => (flowData ? computeFundFlowForecast(flowData.bars, horizonDays) : null),
    [flowData, horizonDays]
  );

  const currSym = flowData ? currencySymbolOf(flowData.currency) : currencySymbol;

  const breakdownPoints = useMemo(() => {
    if (!report) return [];
    return report.chartPoints.filter((p) => !p.isForecast).slice(-15);
  }, [report]);

  const forecastBoundaryLabel = useMemo(() => {
    if (!report) return undefined;
    const histPts = report.chartPoints.filter((p) => !p.isForecast);
    return histPts[histPts.length - 1]?.label;
  }, [report]);

  return (
    <section className="rounded-lg border border-slate-800 bg-[#0F172A] p-5 space-y-4">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            主力资金流入流出监测与未来预测 · {stockName || symbol} ({symbol})
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>{flowData?.source || 'AKShare · 东方财富日线资金流向'}</span>
            {report && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">最新 {report.latest.date}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  惯性自相关 ρ₁={report.autocorrLag1.toFixed(2)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center rounded-md bg-slate-900 p-0.5 border border-slate-800">
            {([5, 10] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizonDays(h)}
                className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                  horizonDays === h
                    ? 'bg-sky-500/20 text-sky-300 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                未来 {h} 日
              </button>
            ))}
          </div>

          <div className="flex items-center rounded-md bg-slate-900 p-0.5 border border-slate-800">
            <button
              type="button"
              onClick={() => setTab('forecast')}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                tab === 'forecast'
                  ? 'bg-sky-500/20 text-sky-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              资金流预测曲线
            </button>
            <button
              type="button"
              onClick={() => setTab('breakdown')}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                tab === 'breakdown'
                  ? 'bg-sky-500/20 text-sky-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              分档博弈对比
            </button>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => fetchFundFlow(true)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {loading && !report && (
        <div className="h-64 flex items-center justify-center text-xs text-slate-400">
          正在拉取东方财富主力资金历史序列并计算 AR(1) 资金流向预测...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-md border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
          {error}（部分冷门海外标的或刚上市基金暂无分档资金明细）
        </div>
      )}

      {report && (
        <>
          {/* 4-Column Capital Flow & Prediction KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 gap-3 sm:gap-0">
            <div className="sm:pr-4 py-1">
              <div className="text-xs text-slate-400">最新单日主力净流入</div>
              <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
                <span
                  className={`text-lg font-semibold ${
                    report.latest.mainNet >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatFlowAmount(report.latest.mainNet, currSym)}
                </span>
                <span className="text-xs text-slate-400">
                  占比 {report.latest.mainPct >= 0 ? '+' : ''}
                  {report.latest.mainPct.toFixed(2)}%
                </span>
              </div>
              <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500">
                {report.streakDays > 0
                  ? `连续净流入 ${report.streakDays} 个交易日`
                  : `连续净流出 ${Math.abs(report.streakDays)} 个交易日`}
              </div>
            </div>

            <div className="sm:px-4 py-1">
              <div className="text-xs text-slate-400">近 5 日 / 近 20 日累计主力</div>
              <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
                <span
                  className={`text-lg font-semibold ${
                    report.sum5 >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatFlowAmount(report.sum5, currSym)}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-400">
                20日累计{' '}
                <span className={report.sum20 >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {formatFlowAmount(report.sum20, currSym)}
                </span>
              </div>
            </div>

            <div className="sm:px-4 py-1">
              <div className="text-xs text-slate-400">
                未来 {horizonDays} 日净流入预测 (P50)
              </div>
              <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
                <span
                  className={`text-lg font-semibold ${
                    report.predictedTotalNet >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatFlowAmount(report.predictedTotalNet, currSym)}
                </span>
                <span
                  className={`text-xs font-medium ${
                    report.inflowProbPct >= 55
                      ? 'text-emerald-400'
                      : report.inflowProbPct <= 45
                        ? 'text-rose-400'
                        : 'text-amber-300'
                  }`}
                >
                  净流入概率 {report.inflowProbPct.toFixed(0)}%
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">{report.forecastLabel}</div>
            </div>

            <div className="sm:pl-4 py-1">
              <div className="text-xs text-slate-400">主力 vs 散户博弈研判</div>
              <div
                className={`mt-1 text-sm font-semibold ${
                  report.divergenceType === 'bull_divergence' ||
                  report.divergenceType === 'institutional_accumulation' ||
                  report.divergenceType === 'aligned_inflow'
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {report.divergenceLabel}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400 leading-snug">
                {report.divergenceDetail}
              </div>
            </div>
          </div>

          {/* Recharts Visualization */}
          {tab === 'forecast' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs px-1">
                <span className="text-slate-300">
                  近 25 日实盘主力净额与未来 {horizonDays} 日预测轨迹（虚线右为预测区间 · 折线为累计资金流）
                </span>
                <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono">
                  <span className="text-emerald-400">柱状：主力净流入</span>
                  <span className="text-rose-400">柱状：主力净流出</span>
                  <span className="text-sky-300">紫青带：未来置信预测区间</span>
                  <span className="text-amber-300">黄线：累计净流</span>
                </div>
              </div>

              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={report.chartPoints}
                    margin={{ top: 12, right: 16, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#64748B', fontSize: 10 }}
                      stroke="#334155"
                      minTickGap={16}
                    />
                    <YAxis
                      yAxisId="daily"
                      tickFormatter={formatAxisCompact}
                      tick={{ fill: '#64748B', fontSize: 10 }}
                      stroke="#334155"
                      width={56}
                    />
                    <YAxis
                      yAxisId="cum"
                      orientation="right"
                      tickFormatter={formatAxisCompact}
                      tick={{ fill: '#94A3B8', fontSize: 10 }}
                      stroke="#334155"
                      width={56}
                    />
                    <Tooltip
                      content={<FlowCustomTooltip currSym={currSym} tab={tab} />}
                    />
                    <ReferenceLine yAxisId="daily" y={0} stroke="#475569" strokeWidth={1} />
                    {forecastBoundaryLabel && (
                      <ReferenceLine
                        yAxisId="daily"
                        x={forecastBoundaryLabel}
                        stroke="#38BDF8"
                        strokeDasharray="4 3"
                        strokeWidth={1.2}
                      />
                    )}
                    <Area
                      yAxisId="daily"
                      type="monotone"
                      dataKey="forecastRange"
                      stroke="none"
                      fill="#38BDF8"
                      fillOpacity={0.16}
                      isAnimationActive={false}
                    />
                    <Bar
                      yAxisId="daily"
                      dataKey="histMainNet"
                      barSize={12}
                      isAnimationActive={false}
                    >
                      {report.chartPoints.map((entry, idx) => (
                        <Cell
                          key={`hist-${idx}`}
                          fill={(entry.histMainNet ?? 0) >= 0 ? '#10B981' : '#EF4444'}
                          fillOpacity={0.85}
                        />
                      ))}
                    </Bar>
                    <Bar
                      yAxisId="daily"
                      dataKey="forecastMainNet"
                      barSize={12}
                      isAnimationActive={false}
                    >
                      {report.chartPoints.map((entry, idx) => (
                        <Cell
                          key={`fc-${idx}`}
                          fill={(entry.forecastMainNet ?? 0) >= 0 ? '#38BDF8' : '#FB7185'}
                          fillOpacity={0.65}
                        />
                      ))}
                    </Bar>
                    <Line
                      yAxisId="cum"
                      type="monotone"
                      dataKey="cumulativeMainNet"
                      stroke="#F59E0B"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs px-1">
                <span className="text-slate-300">
                  近 15 个交易日分档资金净流对比（超大单·大单代表机构主力，中单·小单代表散户/中户）
                </span>
                <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono">
                  <span className="text-sky-400">超大单</span>
                  <span className="text-violet-400">大单</span>
                  <span className="text-amber-300">中单</span>
                  <span className="text-slate-400">小单</span>
                </div>
              </div>

              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={breakdownPoints}
                    margin={{ top: 12, right: 16, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#64748B', fontSize: 10 }}
                      stroke="#334155"
                    />
                    <YAxis
                      tickFormatter={formatAxisCompact}
                      tick={{ fill: '#64748B', fontSize: 10 }}
                      stroke="#334155"
                      width={56}
                    />
                    <Tooltip
                      content={<FlowCustomTooltip currSym={currSym} tab={tab} />}
                    />
                    <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
                    <Bar dataKey="superLargeNet" fill="#38BDF8" isAnimationActive={false} />
                    <Bar dataKey="largeNet" fill="#A78BFA" isAnimationActive={false} />
                    <Bar dataKey="mediumNet" fill="#F59E0B" isAnimationActive={false} />
                    <Bar dataKey="smallNet" fill="#64748B" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Model Note */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-[11px] text-slate-500">
            <span>
              预测模型说明：基于近 60 个交易日真实资金流向序列，提取一阶自相关惯性（AR(1)）、EMA5/EMA15 资金斜率及历史方差构建 P20–P80 置信预测带。
            </span>
            <span className="font-mono tabular-nums text-slate-400">
              预测区间 {formatFlowAmount(report.predictedLowerNet, currSym)} ~{' '}
              {formatFlowAmount(report.predictedUpperNet, currSym)}
            </span>
          </div>
        </>
      )}
    </section>
  );
};
