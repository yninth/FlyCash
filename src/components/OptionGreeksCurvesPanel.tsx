import React, { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { simulateGreeksCurves } from '../lib/quant';
import type { GreeksCurvePoint, OptionRight } from '../types/trading';

interface OptionGreeksCurvesPanelProps {
  symbol: string;
  spotPrice: number;
  strike: number;
  dte: number;
  ivPct: number;
  right: OptionRight;
  contracts: number;
  expiryDate: string;
}

type GreeksViewMode = 'split' | 'overlay';

interface GreeksTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: GreeksCurvePoint }>;
  spotPrice: number;
  contracts: number;
  dte: number;
  nearDte: number;
  showNearExpiry: boolean;
}

const GreeksCustomTooltip: React.FC<GreeksTooltipProps> = ({
  active,
  payload,
  spotPrice,
  contracts,
  dte,
  nearDte,
  showNearExpiry,
}) => {
  const pt = active && payload && payload.length > 0 ? payload[0]?.payload : undefined;
  if (!pt) return null;

  const distPct = spotPrice > 0 ? ((pt.spot - spotPrice) / spotPrice) * 100 : 0;
  const posDeltaShares = pt.delta * 100 * contracts;
  const posThetaUsd = pt.thetaPerDay * 100 * contracts;

  return (
    <div className="rounded-md border border-slate-700 bg-slate-950/95 px-3 py-2.5 text-xs shadow-xl font-mono tabular-nums space-y-1.5">
      <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-1">
        <span className="font-semibold text-slate-100">假设正股 ${pt.spot.toFixed(2)}</span>
        <span className={distPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          {distPct >= 0 ? '+' : ''}
          {distPct.toFixed(1)}%
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sky-400">Delta ({dte}D)</span>
          <span className="text-slate-100">
            {pt.delta.toFixed(3)} ({posDeltaShares >= 0 ? '+' : ''}
            {posDeltaShares.toFixed(0)}股)
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-violet-400">Gamma ({dte}D)</span>
          <span className="text-slate-100">
            {pt.gamma.toFixed(4)} (Δ/+$1)
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-amber-400">Theta ({dte}D)</span>
          <span className="text-slate-100">
            {pt.thetaPerDay.toFixed(3)} (${posThetaUsd.toFixed(1)}/天)
          </span>
        </div>
      </div>

      {showNearExpiry && dte > nearDte && (
        <div className="border-t border-slate-800 pt-1 text-[11px] text-slate-400 space-y-0.5">
          <div className="flex items-center justify-between gap-4">
            <span>临期 {nearDte}D Delta</span>
            <span className="text-sky-300">{pt.deltaNear.toFixed(3)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>临期 {nearDte}D Gamma</span>
            <span className="text-violet-300">{pt.gammaNear.toFixed(4)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>临期 {nearDte}D Theta</span>
            <span className="text-amber-300">{pt.thetaNear.toFixed(3)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export const OptionGreeksCurvesPanel: React.FC<OptionGreeksCurvesPanelProps> = ({
  symbol,
  spotPrice,
  strike,
  dte,
  ivPct,
  right,
  contracts,
  expiryDate,
}) => {
  const [viewMode, setViewMode] = useState<GreeksViewMode>('split');
  const [showNearExpiry, setShowNearExpiry] = useState<boolean>(true);

  const sim = useMemo(
    () =>
      simulateGreeksCurves({
        spot: spotPrice,
        strike,
        dte,
        iv: Math.max(0.05, ivPct / 100),
        right,
      }),
    [spotPrice, strike, dte, ivPct, right]
  );

  const strikeGapPct = spotPrice > 0 ? ((strike - spotPrice) / spotPrice) * 100 : 0;
  const isNearGammaPeak = Math.abs(spotPrice - sim.peakGammaSpot) / Math.max(0.01, spotPrice) <= 0.05;
  const gammaDollarOnePctMove = sim.spotGamma * Math.pow(spotPrice * 0.01, 2) * 0.5 * 100 * contracts;

  return (
    <section className="rounded-lg border border-slate-800 bg-[#0F172A] p-4 sm:p-5 space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            期权希腊字母非线性风险曲线 (Delta / Gamma / Theta) · {symbol} {strike}
            {right === 'call' ? 'C' : 'P'}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>到期日 {expiryDate}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">剩余 {dte} 天</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">IV {ivPct.toFixed(1)}%</span>
            <span aria-hidden="true">·</span>
            <span>蓝线为正股现价，虚线为行权价与临期衰减对比</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {dte > sim.nearDte && (
            <button
              type="button"
              onClick={() => setShowNearExpiry((v) => !v)}
              className={`px-2.5 py-1.5 rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                showNearExpiry
                  ? 'border-violet-500/50 bg-violet-500/15 text-violet-300 font-medium'
                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              临期 {sim.nearDte}D 加速对比
            </button>
          )}

          <div className="flex items-center rounded-md bg-slate-900 p-1 border border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('split')}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'split'
                  ? 'bg-sky-500/20 text-sky-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              三图联动
            </button>
            <button
              type="button"
              onClick={() => setViewMode('overlay')}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'overlay'
                  ? 'bg-sky-500/20 text-sky-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              归一化同屏
            </button>
          </div>
        </div>
      </div>

      {/* 4-Column Nonlinear Risk KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 gap-3 sm:gap-0">
        <div className="sm:pr-4">
          <div className="text-xs text-slate-400">当前 Delta (一阶方向敞口)</div>
          <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-semibold text-sky-300">
              {sim.spotDelta.toFixed(3)}
            </span>
            <span className="text-xs text-slate-400">
              等效 {(sim.spotDelta * 100 * contracts).toFixed(0)} 股
            </span>
          </div>
        </div>

        <div className="sm:px-4">
          <div className="text-xs text-slate-400">当前 Gamma (Delta 加速率)</div>
          <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-semibold text-violet-300">
              {sim.spotGamma.toFixed(4)}
            </span>
            <span className="text-xs text-slate-400">
              峰值 @{sim.peakGammaSpot.toFixed(1)} ({sim.peakGamma.toFixed(4)})
            </span>
          </div>
        </div>

        <div className="sm:px-4">
          <div className="text-xs text-slate-400">当前组合 Theta (日时间损耗)</div>
          <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-semibold text-amber-300">
              ${(sim.spotThetaPerDay * 100 * contracts).toFixed(1)}/天
            </span>
            <span className="text-xs text-slate-400">
              单股 {sim.spotThetaPerDay.toFixed(3)}
            </span>
          </div>
        </div>

        <div className="sm:pl-4">
          <div className="text-xs text-slate-400">非线性凸性特征</div>
          <div className="mt-1 text-xs font-medium leading-snug">
            <span className={isNearGammaPeak ? 'text-violet-300' : 'text-slate-200'}>
              {isNearGammaPeak
                ? '正股紧贴行权价 · Gamma 与 Theta 双峰爆发区'
                : `现价距行权价 ${strikeGapPct >= 0 ? '+' : ''}${strikeGapPct.toFixed(1)}%`}
            </span>
            <div className="mt-0.5 text-[11px] text-slate-400 font-mono tabular-nums">
              1%波动凸性增益 ≈ +${gammaDollarOnePctMove.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      {/* Recharts Visualizations */}
      {viewMode === 'split' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Chart 1: Delta */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs px-1">
              <span className="font-semibold text-sky-300">Delta 方向敏感度曲线</span>
              <span className="text-[11px] text-slate-400">S 型非线性斜率</span>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={sim.points}
                  syncId="option-greeks-sync"
                  margin={{ top: 10, right: 12, left: -12, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id="deltaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38BDF8" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#38BDF8" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="spot"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                    tick={{ fill: '#64748B', fontSize: 10 }}
                    stroke="#334155"
                    tickCount={5}
                  />
                  <YAxis
                    domain={right === 'call' ? [0, 1] : [-1, 0]}
                    tickFormatter={(v: number) => v.toFixed(2)}
                    tick={{ fill: '#64748B', fontSize: 10 }}
                    stroke="#334155"
                  />
                  <Tooltip
                    content={
                      <GreeksCustomTooltip
                        spotPrice={spotPrice}
                        contracts={contracts}
                        dte={dte}
                        nearDte={sim.nearDte}
                        showNearExpiry={showNearExpiry}
                      />
                    }
                  />
                  <ReferenceLine
                    x={spotPrice}
                    stroke="#38BDF8"
                    strokeDasharray="4 3"
                    strokeWidth={1.2}
                  />
                  <ReferenceLine
                    x={strike}
                    stroke="#94A3B8"
                    strokeDasharray="2 3"
                    strokeWidth={1.1}
                  />
                  <Area
                    type="monotone"
                    dataKey="delta"
                    name="Delta"
                    stroke="#38BDF8"
                    strokeWidth={2}
                    fill="url(#deltaFill)"
                    isAnimationActive={false}
                  />
                  {showNearExpiry && dte > sim.nearDte && (
                    <Line
                      type="monotone"
                      dataKey="deltaNear"
                      name={`临期 ${sim.nearDte}D Delta`}
                      stroke="#7DD3FC"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Gamma */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs px-1">
              <span className="font-semibold text-violet-300">Gamma 凸性加速度曲线</span>
              <span className="text-[11px] text-slate-400">行权价附近脉冲峰值</span>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={sim.points}
                  syncId="option-greeks-sync"
                  margin={{ top: 10, right: 12, left: -8, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id="gammaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#A78BFA" stopOpacity={0.34} />
                      <stop offset="95%" stopColor="#A78BFA" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="spot"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                    tick={{ fill: '#64748B', fontSize: 10 }}
                    stroke="#334155"
                    tickCount={5}
                  />
                  <YAxis
                    tickFormatter={(v: number) => v.toFixed(3)}
                    tick={{ fill: '#64748B', fontSize: 10 }}
                    stroke="#334155"
                  />
                  <Tooltip
                    content={
                      <GreeksCustomTooltip
                        spotPrice={spotPrice}
                        contracts={contracts}
                        dte={dte}
                        nearDte={sim.nearDte}
                        showNearExpiry={showNearExpiry}
                      />
                    }
                  />
                  <ReferenceLine
                    x={spotPrice}
                    stroke="#38BDF8"
                    strokeDasharray="4 3"
                    strokeWidth={1.2}
                  />
                  <ReferenceLine
                    x={strike}
                    stroke="#94A3B8"
                    strokeDasharray="2 3"
                    strokeWidth={1.1}
                  />
                  <Area
                    type="monotone"
                    dataKey="gamma"
                    name="Gamma"
                    stroke="#A78BFA"
                    strokeWidth={2}
                    fill="url(#gammaFill)"
                    isAnimationActive={false}
                  />
                  {showNearExpiry && dte > sim.nearDte && (
                    <Line
                      type="monotone"
                      dataKey="gammaNear"
                      name={`临期 ${sim.nearDte}D Gamma`}
                      stroke="#DDD6FE"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 3: Theta */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs px-1">
              <span className="font-semibold text-amber-300">Theta 每日时间损耗曲线</span>
              <span className="text-[11px] text-slate-400">平值区时间衰减最剧烈</span>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={sim.points}
                  syncId="option-greeks-sync"
                  margin={{ top: 10, right: 12, left: -8, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id="thetaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.04} />
                      <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.34} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="spot"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                    tick={{ fill: '#64748B', fontSize: 10 }}
                    stroke="#334155"
                    tickCount={5}
                  />
                  <YAxis
                    tickFormatter={(v: number) => v.toFixed(2)}
                    tick={{ fill: '#64748B', fontSize: 10 }}
                    stroke="#334155"
                  />
                  <Tooltip
                    content={
                      <GreeksCustomTooltip
                        spotPrice={spotPrice}
                        contracts={contracts}
                        dte={dte}
                        nearDte={sim.nearDte}
                        showNearExpiry={showNearExpiry}
                      />
                    }
                  />
                  <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
                  <ReferenceLine
                    x={spotPrice}
                    stroke="#38BDF8"
                    strokeDasharray="4 3"
                    strokeWidth={1.2}
                  />
                  <ReferenceLine
                    x={strike}
                    stroke="#94A3B8"
                    strokeDasharray="2 3"
                    strokeWidth={1.1}
                  />
                  <Area
                    type="monotone"
                    dataKey="thetaPerDay"
                    name="Theta"
                    stroke="#F59E0B"
                    strokeWidth={2}
                    fill="url(#thetaFill)"
                    isAnimationActive={false}
                  />
                  {showNearExpiry && dte > sim.nearDte && (
                    <Line
                      type="monotone"
                      dataKey="thetaNear"
                      name={`临期 ${sim.nearDte}D Theta`}
                      stroke="#FDE68A"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs px-1">
            <span className="text-slate-300">
              归一化同屏对比 (0%–100% 相对强度 · 直观对照 Gamma 峰值与 Theta 损耗尖峰重叠区间)
            </span>
            <div className="flex items-center gap-4 text-[11px] font-mono">
              <span className="text-sky-400">|Delta| 0–100%</span>
              <span className="text-violet-400">Gamma 相对峰值%</span>
              <span className="text-amber-400">|Theta| 相对损耗%</span>
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={sim.points}
                margin={{ top: 12, right: 16, left: -8, bottom: 6 }}
              >
                <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" />
                <XAxis
                  dataKey="spot"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                  tick={{ fill: '#64748B', fontSize: 11 }}
                  stroke="#334155"
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fill: '#64748B', fontSize: 11 }}
                  stroke="#334155"
                />
                <Tooltip
                  content={
                    <GreeksCustomTooltip
                      spotPrice={spotPrice}
                      contracts={contracts}
                      dte={dte}
                      nearDte={sim.nearDte}
                      showNearExpiry={showNearExpiry}
                    />
                  }
                />
                <ReferenceLine
                  x={spotPrice}
                  stroke="#38BDF8"
                  strokeDasharray="4 3"
                  strokeWidth={1.3}
                  label={{ value: `现价 $${spotPrice.toFixed(1)}`, fill: '#38BDF8', fontSize: 10, position: 'top' }}
                />
                <ReferenceLine
                  x={strike}
                  stroke="#94A3B8"
                  strokeDasharray="2 3"
                  strokeWidth={1.2}
                  label={{ value: `行权 $${strike.toFixed(0)}`, fill: '#94A3B8', fontSize: 10, position: 'insideTopRight' }}
                />
                <Line
                  type="monotone"
                  dataKey="absDeltaPct"
                  name="|Delta|%"
                  stroke="#38BDF8"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="gammaNormPct"
                  name="Gamma 峰值%"
                  stroke="#A78BFA"
                  strokeWidth={2.2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="thetaNormPct"
                  name="|Theta| 峰值%"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Concise Risk Interpretation Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
        <span>
          风险阅读指南：Gamma 决定正股波动时 Delta 的加速变盘幅度（Gamma 越高，买方赚钱加速度越快、卖方对冲压力越大）；临近到期（虚线）平值附近 Gamma 与 Theta 会同时急剧陡峭，形成典型的「Pin Risk / Gamma 悬崖」。
        </span>
      </div>
    </section>
  );
};
