import React, { useMemo, useState } from 'react';
import type {
  AtrAnomalyReport,
  BacktestPoint,
  IndicatorBar,
  IntradayExtendedBar,
  PayoffGridPoint,
  SentimentChannelScore,
  StockForecastResult,
} from '../types/trading';

interface CandlestickChartProps {
  bars: IndicatorBar[];
  stopPrice: number;
  currencySymbol: string;
  alertSupportPrice?: number | null;
  alertResistancePrice?: number | null;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  bars,
  stopPrice,
  currencySymbol,
  alertSupportPrice,
  alertResistancePrice,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const slice = useMemo(() => bars.slice(-140), [bars]);

  const width = 960;
  const height = 400;
  const pad = { top: 20, right: 68, bottom: 28, left: 12 };
  const priceHeight = 275;
  const volTop = 308;
  const volHeight = 60;
  const plotW = width - pad.left - pad.right;

  const { minP, maxP, maxVol } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    let mVol = 1;
    for (const b of slice) {
      if (b.low < min) min = b.low;
      if (b.high > max) max = b.high;
      if (b.ma20 !== null) {
        min = Math.min(min, b.ma20);
        max = Math.max(max, b.ma20);
      }
      if (b.ma60 !== null) {
        min = Math.min(min, b.ma60);
        max = Math.max(max, b.ma60);
      }
      if (b.volume > mVol) mVol = b.volume;
    }
    if (stopPrice > 0 && stopPrice > min * 0.8) {
      min = Math.min(min, stopPrice);
    }
    if (alertSupportPrice && alertSupportPrice > min * 0.7 && alertSupportPrice < max * 1.3) {
      min = Math.min(min, alertSupportPrice);
    }
    if (alertResistancePrice && alertResistancePrice > min * 0.7 && alertResistancePrice < max * 1.3) {
      max = Math.max(max, alertResistancePrice);
    }
    const span = Math.max(max - min, 0.01);
    return {
      minP: min - span * 0.06,
      maxP: max + span * 0.06,
      maxVol: mVol,
    };
  }, [slice, stopPrice, alertSupportPrice, alertResistancePrice]);

  if (slice.length === 0) return null;

  const step = plotW / slice.length;
  const candleW = Math.max(2, Math.min(8, step * 0.65));
  const yOf = (p: number) =>
    pad.top + ((maxP - p) / Math.max(0.0001, maxP - minP)) * priceHeight;
  const xOf = (i: number) => pad.left + (i + 0.5) * step;

  const buildLinePath = (getter: (b: IndicatorBar) => number | null) => {
    let d = '';
    slice.forEach((b, i) => {
      const val = getter(b);
      if (val === null) return;
      const x = xOf(i).toFixed(1);
      const y = yOf(val).toFixed(1);
      d += d === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    return d;
  };

  const ma20Path = buildLinePath((b) => b.ma20);
  const ma60Path = buildLinePath((b) => b.ma60);
  const stopY = yOf(stopPrice);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minP + (maxP - minP) * t);
  const activeIdx = hoverIdx !== null ? Math.min(slice.length - 1, Math.max(0, hoverIdx)) : slice.length - 1;
  const activeBar = slice[activeIdx];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width - pad.left;
    const idx = Math.floor(relX / step);
    if (idx >= 0 && idx < slice.length) {
      setHoverIdx(idx);
    }
  };

  return (
    <div className="w-full select-none">
      {/* Live Readout Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
          <span className="text-slate-200 font-medium">{activeBar.date}</span>
          <span>
            开 <span className="text-slate-200">{currencySymbol}{activeBar.open.toFixed(2)}</span>
          </span>
          <span>
            高 <span className="text-slate-200">{currencySymbol}{activeBar.high.toFixed(2)}</span>
          </span>
          <span>
            低 <span className="text-slate-200">{currencySymbol}{activeBar.low.toFixed(2)}</span>
          </span>
          <span>
            收{' '}
            <span className={activeBar.close >= activeBar.open ? 'text-emerald-400' : 'text-rose-400'}>
              {currencySymbol}{activeBar.close.toFixed(2)}
            </span>
          </span>
          {activeBar.ma20 !== null && (
            <span className="text-amber-400">MA20 {currencySymbol}{activeBar.ma20.toFixed(2)}</span>
          )}
          {activeBar.ma60 !== null && (
            <span className="text-sky-400">MA60 {currencySymbol}{activeBar.ma60.toFixed(2)}</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5 text-amber-400">
            <span className="w-3 h-0.5 bg-amber-400 inline-block" /> MA20
          </span>
          <span className="inline-flex items-center gap-1.5 text-sky-400">
            <span className="w-3 h-0.5 bg-sky-400 inline-block" /> MA60
          </span>
          <span className="inline-flex items-center gap-1.5 text-rose-400">
            <span className="w-3 h-0.5 border-t border-dashed border-rose-400 inline-block" /> ATR 止损位
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Horizontal price grid */}
        {yTicks.map((val, idx) => {
          const y = yOf(val);
          return (
            <g key={idx}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke="#1E293B"
                strokeWidth="1"
              />
              <text
                x={width - pad.right + 6}
                y={y + 4}
                fill="#64748B"
                fontSize="10"
                className="font-mono"
              >
                {val.toFixed(val >= 100 ? 1 : 2)}
              </text>
            </g>
          );
        })}

        {/* Alert Support & Resistance Lines */}
        {alertSupportPrice &&
          yOf(alertSupportPrice) >= pad.top &&
          yOf(alertSupportPrice) <= pad.top + priceHeight && (
            <g>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={yOf(alertSupportPrice)}
                y2={yOf(alertSupportPrice)}
                stroke="#38BDF8"
                strokeWidth="1.2"
                strokeDasharray="4 3"
              />
              <text
                x={pad.left + 4}
                y={yOf(alertSupportPrice) - 4}
                fill="#38BDF8"
                fontSize="10"
                className="font-mono"
              >
                支撑提醒 {currencySymbol}
                {alertSupportPrice.toFixed(2)}
              </text>
            </g>
          )}

        {alertResistancePrice &&
          yOf(alertResistancePrice) >= pad.top &&
          yOf(alertResistancePrice) <= pad.top + priceHeight && (
            <g>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={yOf(alertResistancePrice)}
                y2={yOf(alertResistancePrice)}
                stroke="#F59E0B"
                strokeWidth="1.2"
                strokeDasharray="4 3"
              />
              <text
                x={pad.left + 4}
                y={yOf(alertResistancePrice) - 4}
                fill="#FBBF24"
                fontSize="10"
                className="font-mono"
              >
                阻力提醒 {currencySymbol}
                {alertResistancePrice.toFixed(2)}
              </text>
            </g>
          )}

        {/* ATR Stop Loss Line */}
        {stopY >= pad.top && stopY <= pad.top + priceHeight && (
          <g>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={stopY}
              y2={stopY}
              stroke="#EF4444"
              strokeWidth="1.25"
              strokeDasharray="5 4"
            />
            <rect
              x={width - pad.right + 2}
              y={stopY - 9}
              width={62}
              height={18}
              rx={3}
              fill="#7F1D1D"
            />
            <text
              x={width - pad.right + 6}
              y={stopY + 3}
              fill="#FCA5A5"
              fontSize="10"
              className="font-mono"
            >
              {stopPrice.toFixed(2)}
            </text>
          </g>
        )}

        {/* Candlesticks & Volume */}
        {slice.map((b, i) => {
          const x = xOf(i);
          const isUp = b.close >= b.open;
          const color = isUp ? '#10B981' : '#EF4444';
          const yHigh = yOf(b.high);
          const yLow = yOf(b.low);
          const yOpen = yOf(b.open);
          const yClose = yOf(b.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
          const volH = (b.volume / maxVol) * volHeight;

          return (
            <g key={b.date}>
              <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth="1" />
              <rect
                x={x - candleW / 2}
                y={bodyTop}
                width={candleW}
                height={bodyH}
                fill={color}
                opacity={0.92}
              />
              <rect
                x={x - candleW / 2}
                y={volTop + volHeight - volH}
                width={candleW}
                height={Math.max(1, volH)}
                fill={color}
                opacity={0.35}
              />
            </g>
          );
        })}

        {/* Moving Averages */}
        {ma60Path && (
          <path d={ma60Path} fill="none" stroke="#38BDF8" strokeWidth="1.5" />
        )}
        {ma20Path && (
          <path d={ma20Path} fill="none" stroke="#F59E0B" strokeWidth="1.5" />
        )}

        {/* X-Axis Dates */}
        {[0, Math.floor(slice.length * 0.25), Math.floor(slice.length * 0.5), Math.floor(slice.length * 0.75), slice.length - 1]
          .filter((v, idx, arr) => arr.indexOf(v) === idx && slice[v])
          .map((idx) => (
            <text
              key={idx}
              x={xOf(idx)}
              y={height - 6}
              textAnchor="middle"
              fill="#64748B"
              fontSize="10"
              className="font-mono"
            >
              {slice[idx].date}
            </text>
          ))}

        {/* Hover Crosshair */}
        {hoverIdx !== null && slice[hoverIdx] && (
          <g>
            <line
              x1={xOf(hoverIdx)}
              x2={xOf(hoverIdx)}
              y1={pad.top}
              y2={volTop + volHeight}
              stroke="#475569"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={yOf(slice[hoverIdx].close)}
              y2={yOf(slice[hoverIdx].close)}
              stroke="#475569"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          </g>
        )}
      </svg>
    </div>
  );
};

interface EquityCurveChartProps {
  points: BacktestPoint[];
}

export const EquityCurveChart: React.FC<EquityCurveChartProps> = ({ points }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 960;
  const height = 340;
  const pad = { top: 20, right: 64, bottom: 28, left: 16 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const { minV, maxV } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      min = Math.min(min, p.strategy, p.benchmark);
      max = Math.max(max, p.strategy, p.benchmark);
    }
    const span = Math.max(max - min, 0.05);
    return { minV: min - span * 0.08, maxV: max + span * 0.08 };
  }, [points]);

  if (points.length === 0) return null;

  const xOf = (i: number) =>
    pad.left + (i / Math.max(1, points.length - 1)) * plotW;
  const yOf = (v: number) =>
    pad.top + ((maxV - v) / Math.max(0.001, maxV - minV)) * plotH;

  const stratPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(p.strategy).toFixed(1)}`)
    .join(' ');
  const benchPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(p.benchmark).toFixed(1)}`)
    .join(' ');

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minV + (maxV - minV) * t);
  const activeIdx = hoverIdx !== null ? hoverIdx : points.length - 1;
  const activePt = points[activeIdx];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width - pad.left;
    const ratio = Math.min(1, Math.max(0, relX / plotW));
    setHoverIdx(Math.round(ratio * (points.length - 1)));
  };

  return (
    <div className="w-full select-none">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-5 font-mono tabular-nums">
          <span className="text-slate-200 font-medium">{activePt.date}</span>
          <span>
            趋势策略净值{' '}
            <span className="text-emerald-400 font-semibold">
              {activePt.strategy.toFixed(3)} ({((activePt.strategy - 1) * 100).toFixed(1)}%)
            </span>
          </span>
          <span>
            买入持有净值{' '}
            <span className="text-slate-300">
              {activePt.benchmark.toFixed(3)} ({((activePt.benchmark - 1) * 100).toFixed(1)}%)
            </span>
          </span>
          <span>
            策略当期回撤{' '}
            <span className="text-rose-400">{activePt.drawdownPct.toFixed(2)}%</span>
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5 text-emerald-400">
            <span className="w-3 h-0.5 bg-emerald-400 inline-block" /> 趋势策略
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-400">
            <span className="w-3 h-0.5 border-t border-dashed border-slate-400 inline-block" /> 买入持有基准
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {yTicks.map((val, idx) => {
          const y = yOf(val);
          return (
            <g key={idx}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#1E293B" strokeWidth="1" />
              <text x={width - pad.right + 6} y={y + 4} fill="#64748B" fontSize="10" className="font-mono">
                {val.toFixed(2)}x
              </text>
            </g>
          );
        })}

        {/* 1.0x Baseline */}
        {1 >= minV && 1 <= maxV && (
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={yOf(1)}
            y2={yOf(1)}
            stroke="#334155"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        )}

        <path d={benchPath} fill="none" stroke="#64748B" strokeWidth="1.5" strokeDasharray="5 4" />
        <path d={stratPath} fill="none" stroke="#10B981" strokeWidth="2.2" />

        {[0, Math.floor(points.length * 0.25), Math.floor(points.length * 0.5), Math.floor(points.length * 0.75), points.length - 1]
          .filter((v, idx, arr) => arr.indexOf(v) === idx && points[v])
          .map((idx) => (
            <text
              key={idx}
              x={xOf(idx)}
              y={height - 6}
              textAnchor="middle"
              fill="#64748B"
              fontSize="10"
              className="font-mono"
            >
              {points[idx].date}
            </text>
          ))}

        {hoverIdx !== null && points[hoverIdx] && (
          <g>
            <line
              x1={xOf(hoverIdx)}
              x2={xOf(hoverIdx)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="#475569"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle cx={xOf(hoverIdx)} cy={yOf(points[hoverIdx].strategy)} r="4" fill="#10B981" />
            <circle cx={xOf(hoverIdx)} cy={yOf(points[hoverIdx].benchmark)} r="3.5" fill="#94A3B8" />
          </g>
        )}
      </svg>
    </div>
  );
};

interface OptionPayoffChartProps {
  grid: PayoffGridPoint[];
  spotPrice: number;
  breakeven: number;
  dte: number;
}

export const OptionPayoffChart: React.FC<OptionPayoffChartProps> = ({
  grid,
  spotPrice,
  breakeven,
  dte,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 960;
  const height = 340;
  const pad = { top: 20, right: 72, bottom: 28, left: 16 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const { minS, maxS, minPnl, maxPnl } = useMemo(() => {
    let minP = Infinity;
    let maxP = -Infinity;
    for (const pt of grid) {
      minP = Math.min(minP, pt.todayPnl, pt.midPnl, pt.expiryPnl);
      maxP = Math.max(maxP, pt.todayPnl, pt.midPnl, pt.expiryPnl);
    }
    const span = Math.max(maxP - minP, 100);
    return {
      minS: grid[0]?.spot ?? spotPrice * 0.75,
      maxS: grid[grid.length - 1]?.spot ?? spotPrice * 1.25,
      minPnl: minP - span * 0.08,
      maxPnl: maxP + span * 0.08,
    };
  }, [grid, spotPrice]);

  if (grid.length === 0) return null;

  const xOfSpot = (s: number) =>
    pad.left + ((s - minS) / Math.max(0.01, maxS - minS)) * plotW;
  const yOfPnl = (p: number) =>
    pad.top + ((maxPnl - p) / Math.max(1, maxPnl - minPnl)) * plotH;

  const makePath = (getter: (pt: PayoffGridPoint) => number) =>
    grid
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xOfSpot(pt.spot).toFixed(1)} ${yOfPnl(getter(pt)).toFixed(1)}`)
      .join(' ');

  const todayPath = makePath((p) => p.todayPnl);
  const midPath = makePath((p) => p.midPnl);
  const expiryPath = makePath((p) => p.expiryPnl);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minPnl + (maxPnl - minPnl) * t);
  const zeroY = yOfPnl(0);
  const spotX = xOfSpot(spotPrice);
  const beX = xOfSpot(breakeven);
  const midDte = Math.max(1, Math.floor(dte / 2));

  const activeIdx = hoverIdx !== null ? hoverIdx : Math.floor(grid.length / 2);
  const activePt = grid[activeIdx];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width - pad.left;
    const ratio = Math.min(1, Math.max(0, relX / plotW));
    setHoverIdx(Math.round(ratio * (grid.length - 1)));
  };

  const fmtPnl = (v: number) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(0)}`;

  return (
    <div className="w-full select-none">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-5 font-mono tabular-nums">
          <span>
            假设正股价 <span className="text-slate-100 font-semibold">${activePt.spot.toFixed(2)}</span>
          </span>
          <span>
            今日浮盈{' '}
            <span className={activePt.todayPnl >= 0 ? 'text-slate-200' : 'text-rose-400'}>
              {fmtPnl(activePt.todayPnl)}
            </span>
          </span>
          <span>
            剩 {midDte} 天{' '}
            <span className={activePt.midPnl >= 0 ? 'text-amber-400' : 'text-rose-400'}>
              {fmtPnl(activePt.midPnl)}
            </span>
          </span>
          <span>
            到期日{' '}
            <span className={activePt.expiryPnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
              {fmtPnl(activePt.expiryPnl)}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5 text-slate-400">
            <span className="w-3 h-0.5 bg-slate-400 inline-block" /> 今日 ({dte}天)
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-400">
            <span className="w-3 h-0.5 bg-amber-400 inline-block" /> 中期 ({midDte}天)
          </span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400">
            <span className="w-3 h-0.5 bg-emerald-400 inline-block" /> 到期日
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {yTicks.map((val, idx) => {
          const y = yOfPnl(val);
          return (
            <g key={idx}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#1E293B" strokeWidth="1" />
              <text x={width - pad.right + 6} y={y + 4} fill="#64748B" fontSize="10" className="font-mono">
                {val >= 0 ? `+$${val.toFixed(0)}` : `-$${Math.abs(val).toFixed(0)}`}
              </text>
            </g>
          );
        })}

        {/* Zero PnL Line */}
        {zeroY >= pad.top && zeroY <= pad.top + plotH && (
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={zeroY}
            y2={zeroY}
            stroke="#475569"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />
        )}

        {/* Current Spot Marker */}
        {spotX >= pad.left && spotX <= width - pad.right && (
          <g>
            <line
              x1={spotX}
              x2={spotX}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="#38BDF8"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <text x={spotX + 4} y={pad.top + 12} fill="#38BDF8" fontSize="10" className="font-mono">
              现价 ${spotPrice.toFixed(2)}
            </text>
          </g>
        )}

        {/* Breakeven Marker */}
        {beX >= pad.left && beX <= width - pad.right && (
          <g>
            <line
              x1={beX}
              x2={beX}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="#A855F7"
              strokeWidth="1"
              strokeDasharray="2 3"
              opacity={0.7}
            />
            <text x={beX + 4} y={pad.top + plotH - 6} fill="#C084FC" fontSize="10" className="font-mono">
              盈亏平衡 ${breakeven.toFixed(2)}
            </text>
          </g>
        )}

        <path d={todayPath} fill="none" stroke="#94A3B8" strokeWidth="1.5" />
        <path d={midPath} fill="none" stroke="#F59E0B" strokeWidth="1.75" />
        <path d={expiryPath} fill="none" stroke="#10B981" strokeWidth="2.2" />

        {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
          const sVal = minS + (maxS - minS) * t;
          return (
            <text
              key={idx}
              x={xOfSpot(sVal)}
              y={height - 6}
              textAnchor="middle"
              fill="#64748B"
              fontSize="10"
              className="font-mono"
            >
              ${sVal.toFixed(1)}
            </text>
          );
        })}

        {hoverIdx !== null && grid[hoverIdx] && (
          <g>
            <line
              x1={xOfSpot(grid[hoverIdx].spot)}
              x2={xOfSpot(grid[hoverIdx].spot)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="#64748B"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle cx={xOfSpot(grid[hoverIdx].spot)} cy={yOfPnl(grid[hoverIdx].expiryPnl)} r="4" fill="#10B981" />
            <circle cx={xOfSpot(grid[hoverIdx].spot)} cy={yOfPnl(grid[hoverIdx].midPnl)} r="3.5" fill="#F59E0B" />
            <circle cx={xOfSpot(grid[hoverIdx].spot)} cy={yOfPnl(grid[hoverIdx].todayPnl)} r="3.5" fill="#94A3B8" />
          </g>
        )}
      </svg>
    </div>
  );
};

interface PriceForecastChartProps {
  historyBars: IndicatorBar[];
  forecast: StockForecastResult;
  currencySymbol: string;
}

export const PriceForecastChart: React.FC<PriceForecastChartProps> = ({
  historyBars,
  forecast,
  currencySymbol,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const recentHist = useMemo(() => historyBars.slice(-25), [historyBars]);
  const fPoints = forecast.points;

  const width = 960;
  const height = 310;
  const pad = { top: 20, right: 68, bottom: 28, left: 14 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const totalSteps = Math.max(1, recentHist.length - 1 + (fPoints.length - 1));

  const { minP, maxP } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const b of recentHist) {
      min = Math.min(min, b.close);
      max = Math.max(max, b.close);
    }
    for (const p of fPoints) {
      min = Math.min(min, p.p10);
      max = Math.max(max, p.p90);
    }
    min = Math.min(min, forecast.signals.support20);
    max = Math.max(max, forecast.signals.resistance20);
    const span = Math.max(max - min, 0.01);
    return { minP: min - span * 0.08, maxP: max + span * 0.08 };
  }, [recentHist, fPoints, forecast.signals.support20, forecast.signals.resistance20]);

  if (recentHist.length === 0 || fPoints.length === 0) return null;

  const xOfIndex = (idx: number) => pad.left + (idx / totalSteps) * plotW;
  const yOfPrice = (p: number) =>
    pad.top + ((maxP - p) / Math.max(0.0001, maxP - minP)) * plotH;

  const splitIndex = recentHist.length - 1;
  const splitX = xOfIndex(splitIndex);

  const histPath = recentHist
    .map((b, i) => `${i === 0 ? 'M' : 'L'} ${xOfIndex(i).toFixed(1)} ${yOfPrice(b.close).toFixed(1)}`)
    .join(' ');

  const medianPath = fPoints
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${xOfIndex(splitIndex + i).toFixed(1)} ${yOfPrice(p.p50).toFixed(1)}`
    )
    .join(' ');

  const outerConePath = [
    ...fPoints.map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${xOfIndex(splitIndex + i).toFixed(1)} ${yOfPrice(p.p90).toFixed(1)}`
    ),
    ...[...fPoints]
      .reverse()
      .map(
        (p, revIdx) =>
          `L ${xOfIndex(splitIndex + (fPoints.length - 1 - revIdx)).toFixed(1)} ${yOfPrice(p.p10).toFixed(1)}`
      ),
    'Z',
  ].join(' ');

  const innerConePath = [
    ...fPoints.map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${xOfIndex(splitIndex + i).toFixed(1)} ${yOfPrice(p.p75).toFixed(1)}`
    ),
    ...[...fPoints]
      .reverse()
      .map(
        (p, revIdx) =>
          `L ${xOfIndex(splitIndex + (fPoints.length - 1 - revIdx)).toFixed(1)} ${yOfPrice(p.p25).toFixed(1)}`
      ),
    'Z',
  ].join(' ');

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minP + (maxP - minP) * t);

  const activeFutureIdx =
    hoverIdx !== null && hoverIdx >= splitIndex
      ? Math.min(fPoints.length - 1, hoverIdx - splitIndex)
      : fPoints.length - 1;
  const activeForecast = fPoints[activeFutureIdx];
  const activeHist =
    hoverIdx !== null && hoverIdx < splitIndex ? recentHist[hoverIdx] : null;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width - pad.left;
    const ratio = Math.min(1, Math.max(0, relX / plotW));
    setHoverIdx(Math.round(ratio * totalSteps));
  };

  const supY = yOfPrice(forecast.signals.support20);
  const resY = yOfPrice(forecast.signals.resistance20);

  return (
    <div className="w-full select-none">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 text-xs text-slate-400">
        {activeHist ? (
          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
            <span className="text-slate-200 font-medium">历史 {activeHist.date}</span>
            <span>
              收盘价 <span className="text-slate-100">{currencySymbol}{activeHist.close.toFixed(2)}</span>
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
            <span className="text-sky-300 font-medium">
              预测 {activeForecast.label} ({activeForecast.dayOffset}个交易日后)
            </span>
            <span>
              悲观 P10 <span className="text-rose-400">{currencySymbol}{activeForecast.p10.toFixed(2)}</span>
            </span>
            <span>
              中位 P50 <span className="text-sky-300 font-semibold">{currencySymbol}{activeForecast.p50.toFixed(2)}</span>
            </span>
            <span>
              乐观 P90 <span className="text-emerald-400">{currencySymbol}{activeForecast.p90.toFixed(2)}</span>
            </span>
          </div>
        )}
        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <span className="w-3 h-0.5 bg-slate-300 inline-block" /> 近25日走势
          </span>
          <span className="inline-flex items-center gap-1.5 text-sky-400">
            <span className="w-3 h-0.5 bg-sky-400 inline-block" /> 中位预测路径 (P50)
          </span>
          <span className="inline-flex items-center gap-1.5 text-sky-300/80">
            <span className="w-3 h-2.5 bg-sky-500/25 inline-block rounded-xs" /> P10–P90 概率区间
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {yTicks.map((val, idx) => {
          const y = yOfPrice(val);
          return (
            <g key={idx}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#1E293B" strokeWidth="1" />
              <text x={width - pad.right + 6} y={y + 4} fill="#64748B" fontSize="10" className="font-mono">
                {val.toFixed(val >= 100 ? 1 : 2)}
              </text>
            </g>
          );
        })}

        {/* 20D Support & Resistance Reference */}
        {resY >= pad.top && resY <= pad.top + plotH && (
          <line x1={pad.left} x2={width - pad.right} y1={resY} y2={resY} stroke="#F59E0B" strokeWidth="1" strokeDasharray="3 4" opacity={0.6} />
        )}
        {supY >= pad.top && supY <= pad.top + plotH && (
          <line x1={pad.left} x2={width - pad.right} y1={supY} y2={supY} stroke="#10B981" strokeWidth="1" strokeDasharray="3 4" opacity={0.6} />
        )}

        {/* Probability Cones */}
        <path d={outerConePath} fill="#38BDF8" fillOpacity={0.12} />
        <path d={innerConePath} fill="#38BDF8" fillOpacity={0.22} />

        {/* Divider at Today */}
        <line
          x1={splitX}
          x2={splitX}
          y1={pad.top}
          y2={pad.top + plotH}
          stroke="#475569"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <text x={splitX + 4} y={pad.top + 12} fill="#94A3B8" fontSize="10" className="font-mono">
          今日起点
        </text>

        {/* Historical & Median Lines */}
        <path d={histPath} fill="none" stroke="#CBD5E1" strokeWidth="1.8" />
        <path d={medianPath} fill="none" stroke="#38BDF8" strokeWidth="2.2" strokeDasharray="5 3" />

        {/* X Axis Labels */}
        <text x={xOfIndex(0)} y={height - 6} textAnchor="start" fill="#64748B" fontSize="10" className="font-mono">
          {recentHist[0]?.date}
        </text>
        <text x={splitX} y={height - 6} textAnchor="middle" fill="#94A3B8" fontSize="10" className="font-mono">
          今日
        </text>
        <text x={xOfIndex(totalSteps)} y={height - 6} textAnchor="end" fill="#38BDF8" fontSize="10" className="font-mono">
          +{forecast.horizonDays}交易日
        </text>

        {hoverIdx !== null && (
          <line
            x1={xOfIndex(hoverIdx)}
            x2={xOfIndex(hoverIdx)}
            y1={pad.top}
            y2={pad.top + plotH}
            stroke="#64748B"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
      </svg>
    </div>
  );
};

interface ExtendedIntradayChartProps {
  bars: IntradayExtendedBar[];
  prevClose: number | null;
  currencySymbol: string;
}

const SESSION_LABEL: Record<IntradayExtendedBar['session'], string> = {
  pre: '盘前',
  regular: '盘中',
  post: '盘后',
};

const SESSION_COLOR: Record<IntradayExtendedBar['session'], string> = {
  pre: '#38BDF8',
  regular: '#10B981',
  post: '#F59E0B',
};

export const ExtendedIntradayChart: React.FC<ExtendedIntradayChartProps> = ({
  bars,
  prevClose,
  currencySymbol,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 960;
  const height = 340;
  const pad = { top: 20, right: 68, bottom: 28, left: 14 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const { minP, maxP, refPrice } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const b of bars) {
      min = Math.min(min, b.price);
      max = Math.max(max, b.price);
    }
    const ref = prevClose && prevClose > 0 ? prevClose : bars[0]?.price ?? 0;
    if (ref > 0) {
      min = Math.min(min, ref);
      max = Math.max(max, ref);
    }
    const span = Math.max(max - min, 0.1);
    return {
      minP: min - span * 0.08,
      maxP: max + span * 0.08,
      refPrice: ref,
    };
  }, [bars, prevClose]);

  const sessionBands = useMemo(() => {
    const bands: Array<{
      session: IntradayExtendedBar['session'];
      startIdx: number;
      endIdx: number;
    }> = [];
    for (let i = 0; i < bars.length; i++) {
      const s = bars[i].session;
      const last = bands[bands.length - 1];
      if (!last || last.session !== s) {
        bands.push({ session: s, startIdx: i, endIdx: i });
      } else {
        last.endIdx = i;
      }
    }
    return bands;
  }, [bars]);

  if (bars.length < 2) {
    return (
      <div className="py-16 text-center text-xs text-slate-400">
        当前美股暂无可展示的 5 分钟盘前/盘后分时采样点，请稍后刷新查看。
      </div>
    );
  }

  const xOf = (i: number) =>
    pad.left + (i / Math.max(1, bars.length - 1)) * plotW;
  const yOf = (p: number) =>
    pad.top + ((maxP - p) / Math.max(0.0001, maxP - minP)) * plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minP + (maxP - minP) * t);
  const activeIdx = hoverIdx !== null ? Math.min(bars.length - 1, Math.max(0, hoverIdx)) : bars.length - 1;
  const activeBar = bars[activeIdx];
  const activePct = refPrice > 0 ? ((activeBar.price - refPrice) / refPrice) * 100 : 0;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width - pad.left;
    const ratio = Math.min(1, Math.max(0, relX / plotW));
    setHoverIdx(Math.round(ratio * (bars.length - 1)));
  };

  return (
    <div className="w-full select-none">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
          <span className="text-slate-200 font-medium">
            美东 {activeBar.etDate} {activeBar.etTimeLabel}
          </span>
          <span style={{ color: SESSION_COLOR[activeBar.session] }} className="font-semibold">
            {SESSION_LABEL[activeBar.session]}时段
          </span>
          <span>
            成交价{' '}
            <span className="text-slate-100 font-semibold">
              {currencySymbol}{activeBar.price.toFixed(2)}
            </span>
          </span>
          <span className={activePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            较基准 {activePct >= 0 ? '+' : ''}{activePct.toFixed(2)}%
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5 text-sky-400">
            <span className="w-3 h-0.5 bg-sky-400 inline-block" /> 盘前 (04:00–09:30 ET)
          </span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400">
            <span className="w-3 h-0.5 bg-emerald-400 inline-block" /> 盘中 (09:30–16:00 ET)
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-400">
            <span className="w-3 h-0.5 bg-amber-400 inline-block" /> 盘后 (16:00–20:00 ET)
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Session background bands */}
        {sessionBands.map((band, i) => {
          const x1 = xOf(band.startIdx);
          const x2 = xOf(band.endIdx);
          const fill =
            band.session === 'pre'
              ? 'rgba(56, 189, 248, 0.06)'
              : band.session === 'post'
                ? 'rgba(245, 158, 11, 0.06)'
                : 'transparent';
          return (
            <rect
              key={`${band.session}-${i}`}
              x={x1}
              y={pad.top}
              width={Math.max(1, x2 - x1)}
              height={plotH}
              fill={fill}
            />
          );
        })}

        {/* Horizontal price grid */}
        {yTicks.map((val, idx) => {
          const y = yOf(val);
          return (
            <g key={idx}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#1E293B" strokeWidth="1" />
              <text x={width - pad.right + 6} y={y + 4} fill="#64748B" fontSize="10" className="font-mono">
                {val.toFixed(val >= 100 ? 1 : 2)}
              </text>
            </g>
          );
        })}

        {/* Reference Previous Close Line */}
        {refPrice > 0 && (
          <g>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={yOf(refPrice)}
              y2={yOf(refPrice)}
              stroke="#64748B"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />
            <text x={pad.left + 4} y={yOf(refPrice) - 5} fill="#94A3B8" fontSize="10" className="font-mono">
              基准 {currencySymbol}{refPrice.toFixed(2)}
            </text>
          </g>
        )}

        {/* Session colored path segments */}
        {sessionBands.map((band, i) => {
          const start = Math.max(0, band.startIdx - (i > 0 ? 1 : 0));
          const seg = bars.slice(start, band.endIdx + 1);
          const d = seg
            .map((b, idx) => `${idx === 0 ? 'M' : 'L'} ${xOf(start + idx).toFixed(1)} ${yOf(b.price).toFixed(1)}`)
            .join(' ');
          return (
            <path
              key={`seg-${i}`}
              d={d}
              fill="none"
              stroke={SESSION_COLOR[band.session]}
              strokeWidth="2"
            />
          );
        })}

        {/* X Axis timestamps */}
        {[0, Math.floor(bars.length * 0.25), Math.floor(bars.length * 0.5), Math.floor(bars.length * 0.75), bars.length - 1]
          .filter((v, idx, arr) => arr.indexOf(v) === idx && bars[v])
          .map((idx) => (
            <text
              key={idx}
              x={xOf(idx)}
              y={height - 6}
              textAnchor="middle"
              fill="#64748B"
              fontSize="10"
              className="font-mono"
            >
              {bars[idx].etTimeLabel} ET
            </text>
          ))}

        {hoverIdx !== null && bars[hoverIdx] && (
          <g>
            <line
              x1={xOf(hoverIdx)}
              x2={xOf(hoverIdx)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="#475569"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={xOf(hoverIdx)}
              cy={yOf(bars[hoverIdx].price)}
              r="4"
              fill={SESSION_COLOR[bars[hoverIdx].session]}
            />
          </g>
        )}
      </svg>
    </div>
  );
};

export interface PortfolioPieSlice {
  id: string;
  label: string;
  valueCny: number;
  pct: number;
  color: string;
  count: number;
}

interface PortfolioPieChartProps {
  slices: PortfolioPieSlice[];
  totalMarketCny: number;
  activeId?: string | null;
  onHoverId?: (id: string | null) => void;
}

export const PortfolioPieChart: React.FC<PortfolioPieChartProps> = ({
  slices,
  totalMarketCny,
  activeId = null,
  onHoverId,
}) => {
  const nonZero = useMemo(() => slices.filter((s) => s.valueCny > 0), [slices]);
  const cx = 110;
  const cy = 110;
  const outerR = 88;
  const innerR = 54;

  const activeSlice = useMemo(
    () => nonZero.find((s) => s.id === activeId) ?? null,
    [nonZero, activeId]
  );

  const arcPaths = useMemo(() => {
    if (nonZero.length === 0 || totalMarketCny <= 0) return [];
    let currentAngle = -Math.PI / 2;
    return nonZero.map((slice) => {
      const fraction = slice.valueCny / totalMarketCny;
      const sweep = Math.min(Math.PI * 1.9998, fraction * Math.PI * 2);
      const startAngle = currentAngle;
      const endAngle = currentAngle + sweep;
      currentAngle = endAngle;

      const x1Out = cx + outerR * Math.cos(startAngle);
      const y1Out = cy + outerR * Math.sin(startAngle);
      const x2Out = cx + outerR * Math.cos(endAngle);
      const y2Out = cy + outerR * Math.sin(endAngle);

      const x2In = cx + innerR * Math.cos(endAngle);
      const y2In = cy + innerR * Math.sin(endAngle);
      const x1In = cx + innerR * Math.cos(startAngle);
      const y1In = cy + innerR * Math.sin(startAngle);

      const largeArc = sweep > Math.PI ? 1 : 0;
      const d = [
        `M ${x1Out.toFixed(2)} ${y1Out.toFixed(2)}`,
        `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2Out.toFixed(2)} ${y2Out.toFixed(2)}`,
        `L ${x2In.toFixed(2)} ${y2In.toFixed(2)}`,
        `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1In.toFixed(2)} ${y1In.toFixed(2)}`,
        'Z',
      ].join(' ');

      return { ...slice, d };
    });
  }, [nonZero, totalMarketCny]);

  const formatShortCny = (val: number) => {
    if (val >= 10000) return `¥${(val / 10000).toFixed(1)}万`;
    return `¥${Math.round(val).toLocaleString('zh-CN')}`;
  };

  return (
    <div className="flex items-center justify-center select-none">
      <svg viewBox="0 0 220 220" className="w-48 h-48 block shrink-0">
        {nonZero.length === 0 ? (
          <circle
            cx={cx}
            cy={cy}
            r={(outerR + innerR) / 2}
            fill="none"
            stroke="#1E293B"
            strokeWidth={outerR - innerR}
          />
        ) : nonZero.length === 1 ? (
          <circle
            cx={cx}
            cy={cy}
            r={(outerR + innerR) / 2}
            fill="none"
            stroke={nonZero[0].color}
            strokeWidth={outerR - innerR}
            className="cursor-pointer transition-opacity"
            onMouseEnter={() => onHoverId?.(nonZero[0].id)}
            onMouseLeave={() => onHoverId?.(null)}
          />
        ) : (
          arcPaths.map((seg) => {
            const isDimmed = activeId !== null && activeId !== seg.id;
            const isActive = activeId === seg.id;
            return (
              <path
                key={seg.id}
                d={seg.d}
                fill={seg.color}
                stroke="#0F172A"
                strokeWidth="2"
                opacity={isDimmed ? 0.35 : 1}
                transform={isActive ? `translate(${cx}, ${cy}) scale(1.03) translate(${-cx}, ${-cy})` : undefined}
                className="cursor-pointer transition-opacity duration-150"
                onMouseEnter={() => onHoverId?.(seg.id)}
                onMouseLeave={() => onHoverId?.(null)}
              />
            );
          })
        )}

        {/* Center Readout */}
        <text
          x={cx}
          y={cy - 10}
          textAnchor="middle"
          fill="#94A3B8"
          fontSize="11"
        >
          {activeSlice ? activeSlice.label : '总估值市值'}
        </text>
        <text
          x={cx}
          y={cy + 11}
          textAnchor="middle"
          fill="#F1F5F9"
          fontSize="15"
          fontWeight="700"
          className="font-mono"
        >
          {activeSlice
            ? `${activeSlice.pct.toFixed(1)}%`
            : formatShortCny(totalMarketCny)}
        </text>
        <text
          x={cx}
          y={cy + 27}
          textAnchor="middle"
          fill="#64748B"
          fontSize="10"
          className="font-mono"
        >
          {activeSlice
            ? formatShortCny(activeSlice.valueCny)
            : `${nonZero.length} 类市场`}
        </text>
      </svg>
    </div>
  );
};

interface BullBearSentimentChartProps {
  bullishPct: number;
  neutralPct: number;
  bearishPct: number;
  sentimentScore: number;
  heatScore?: number;
  regimeLabel?: string;
  channels: SentimentChannelScore[];
}

function shortenRadarAxisLabel(label: string): string {
  const cleaned = label.replace(/\s*\([^)]*\)\s*/g, '').trim();
  if (cleaned.length <= 7) return cleaned;
  return `${cleaned.slice(0, 6)}…`;
}

export const BullBearSentimentChart: React.FC<BullBearSentimentChartProps> = ({
  bullishPct,
  neutralPct,
  bearishPct,
  sentimentScore,
  heatScore,
  regimeLabel,
  channels,
}) => {
  const [viewMode, setViewMode] = useState<'visual' | 'bars'>('visual');
  const [hoverChannelIdx, setHoverChannelIdx] = useState<number | null>(null);
  const activeChannel =
    hoverChannelIdx !== null && channels[hoverChannelIdx]
      ? channels[hoverChannelIdx]
      : channels[0] ?? null;

  // --- Gauge Geometry (-100..+100 mapped onto 180deg semi-circle) ---
  const gaugeCx = 130;
  const gaugeCy = 112;
  const gaugeR = 80;
  const clampedScore = Math.max(-100, Math.min(100, sentimentScore));
  const scoreToTheta = (score: number) => ((100 - score) / 200) * Math.PI;
  const polarOnGauge = (score: number, radius: number) => {
    const theta = scoreToTheta(score);
    return {
      x: gaugeCx + radius * Math.cos(theta),
      y: gaugeCy - radius * Math.sin(theta),
    };
  };
  const arcPath = (startScore: number, endScore: number, radius: number) => {
    const p1 = polarOnGauge(startScore, radius);
    const p2 = polarOnGauge(endScore, radius);
    return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  };
  const needleTip = polarOnGauge(clampedScore, gaugeR - 10);
  const needleTheta = scoreToTheta(clampedScore);
  const needleBaseLeft = {
    x: gaugeCx + 4.5 * Math.cos(needleTheta + Math.PI / 2),
    y: gaugeCy - 4.5 * Math.sin(needleTheta + Math.PI / 2),
  };
  const needleBaseRight = {
    x: gaugeCx + 4.5 * Math.cos(needleTheta - Math.PI / 2),
    y: gaugeCy - 4.5 * Math.sin(needleTheta - Math.PI / 2),
  };
  const scoreColor =
    sentimentScore > 10
      ? '#10B981'
      : sentimentScore < -10
        ? '#F43F5E'
        : '#F59E0B';
  const inferredRegime =
    regimeLabel ??
    (sentimentScore > 30
      ? '多头主导'
      : sentimentScore > 10
        ? '温和偏多'
        : sentimentScore < -30
          ? '空头占优'
          : sentimentScore < -10
            ? '温和偏空'
            : '多空均衡');

  // --- Radar Geometry (Channels >= 3, or synthesized 3-axis fallback) ---
  const radarAxes =
    channels.length >= 3
      ? channels.map((ch, idx) => ({
          idx,
          label: shortenRadarAxisLabel(ch.channel),
          fullLabel: ch.channel,
          bull: Math.max(0, Math.min(100, ch.bullPct)),
          bear: Math.max(0, Math.min(100, ch.bearPct)),
          heat: Math.max(0, Math.min(100, ch.heatScore)),
        }))
      : [
          {
            idx: 0,
            label: '多头占比',
            fullLabel: '多头总体占比',
            bull: bullishPct,
            bear: bearishPct,
            heat: heatScore ?? 50,
          },
          {
            idx: 1,
            label: '盘前热度',
            fullLabel: '盘前讨论热度',
            bull: sentimentScore >= 0 ? Math.min(100, heatScore ?? bullishPct) : Math.max(15, bullishPct),
            bear: sentimentScore < 0 ? Math.min(100, heatScore ?? bearishPct) : Math.max(15, bearishPct),
            heat: heatScore ?? 50,
          },
          {
            idx: 2,
            label: '中性分歧',
            fullLabel: '中性观望与分歧度',
            bull: Math.min(100, Math.round(bullishPct + neutralPct * 0.4)),
            bear: Math.min(100, Math.round(bearishPct + neutralPct * 0.4)),
            heat: 100 - neutralPct,
          },
        ];

  const radarW = 300;
  const radarH = 192;
  const radarCx = 150;
  const radarCy = 96;
  const radarR = 54;
  const axisCount = radarAxes.length;
  const radarPoint = (axisIdx: number, pct: number, radiusScale = 1) => {
    const angle = -Math.PI / 2 + (axisIdx * 2 * Math.PI) / axisCount;
    const dist = (Math.max(4, Math.min(100, pct)) / 100) * radarR * radiusScale;
    return {
      x: radarCx + dist * Math.cos(angle),
      y: radarCy + dist * Math.sin(angle),
      angle,
    };
  };
  const polygonPoints = (values: number[]) =>
    values
      .map((val, idx) => {
        const pt = radarPoint(idx, val);
        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
      })
      .join(' ');

  // --- Diverging Bar Geometry ---
  const svgWidth = 620;
  const rowH = 38;
  const topPad = 24;
  const bottomPad = 14;
  const svgHeight = topPad + Math.max(1, channels.length) * rowH + bottomPad;

  const labelW = 148;
  const rightMetaW = 72;
  const chartLeft = labelW;
  const chartRight = svgWidth - rightMetaW;
  const chartCenter = (chartLeft + chartRight) / 2;
  const halfSpan = (chartRight - chartLeft) / 2 - 36;

  return (
    <div className="space-y-4 select-none">
      {/* 1. Overall Bull vs Neutral vs Bear Power Distribution Bar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
          <span className="text-emerald-400 font-semibold">
            多头力量 {bullishPct}%
          </span>
          <span className="text-slate-400">
            中性观望 {neutralPct}% · 净极性{' '}
            <span
              className={
                sentimentScore > 10
                  ? 'text-emerald-400 font-semibold'
                  : sentimentScore < -10
                    ? 'text-rose-400 font-semibold'
                    : 'text-slate-200 font-semibold'
              }
            >
              {sentimentScore >= 0 ? `+${sentimentScore}` : sentimentScore}
            </span>
          </span>
          <span className="text-rose-400 font-semibold">
            空头力量 {bearishPct}%
          </span>
        </div>

        <div className="relative h-3.5 w-full rounded bg-slate-800 overflow-hidden flex">
          <div
            style={{ width: `${bullishPct}%` }}
            className="h-full bg-emerald-500 transition-all duration-300"
            title={`多头 ${bullishPct}%`}
          />
          <div
            style={{ width: `${neutralPct}%` }}
            className="h-full bg-slate-600 transition-all duration-300"
            title={`中性 ${neutralPct}%`}
          />
          <div
            style={{ width: `${bearishPct}%` }}
            className="h-full bg-rose-500 transition-all duration-300"
            title={`空头 ${bearishPct}%`}
          />
          <div
            className="absolute inset-y-0 left-1/2 w-px bg-slate-100/70"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* 2. Chart Mode Header + Switcher */}
      <div className="border-t border-slate-800 pt-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-slate-300">
            {viewMode === 'visual'
              ? '多空力量仪表盘与多渠道极性雷达'
              : '分渠道看多 / 看空声量对比'}
          </span>

          <div className="flex items-center rounded-md bg-slate-900 p-0.5 border border-slate-800 text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode('visual')}
              className={`px-2 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'visual'
                  ? 'bg-sky-500/20 text-sky-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              仪表盘 · 雷达图
            </button>
            <button
              type="button"
              onClick={() => setViewMode('bars')}
              className={`px-2 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'bars'
                  ? 'bg-sky-500/20 text-sky-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              渠道对比条
            </button>
          </div>
        </div>

        {viewMode === 'visual' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            {/* Left: Semi-Circle Bull/Bear Polarity Gauge */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                <span>多空极性仪表盘</span>
                <span className="font-mono tabular-nums" style={{ color: scoreColor }}>
                  {inferredRegime}
                </span>
              </div>
              <svg viewBox="0 0 260 156" className="w-full h-auto block">
                {/* Base track */}
                <path
                  d={arcPath(-100, 100, gaugeR)}
                  fill="none"
                  stroke="#1E293B"
                  strokeWidth="13"
                  strokeLinecap="butt"
                />
                {/* Bearish zone (-100 to -18) */}
                <path
                  d={arcPath(-100, -18, gaugeR)}
                  fill="none"
                  stroke="#F43F5E"
                  strokeWidth="12"
                  strokeOpacity="0.78"
                />
                {/* Neutral zone (-16 to +16) */}
                <path
                  d={arcPath(-16, 16, gaugeR)}
                  fill="none"
                  stroke="#64748B"
                  strokeWidth="12"
                  strokeOpacity="0.65"
                />
                {/* Bullish zone (+18 to +100) */}
                <path
                  d={arcPath(18, 100, gaugeR)}
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="12"
                  strokeOpacity="0.82"
                />
                {/* Inner calibration ring */}
                <path
                  d={arcPath(-100, 100, gaugeR - 14)}
                  fill="none"
                  stroke="#334155"
                  strokeWidth="1"
                  strokeDasharray="2 4"
                />

                {/* Scale ticks & labels */}
                {[
                  { val: -100, label: '-100', anchor: 'end' as const, dx: -5, dy: 4 },
                  { val: -50, label: '-50', anchor: 'end' as const, dx: -4, dy: -2 },
                  { val: 0, label: '0', anchor: 'middle' as const, dx: 0, dy: -6 },
                  { val: 50, label: '+50', anchor: 'start' as const, dx: 4, dy: -2 },
                  { val: 100, label: '+100', anchor: 'start' as const, dx: 5, dy: 4 },
                ].map((tick) => {
                  const inner = polarOnGauge(tick.val, gaugeR - 13);
                  const outer = polarOnGauge(tick.val, gaugeR + 8);
                  const txt = polarOnGauge(tick.val, gaugeR + 13);
                  return (
                    <g key={tick.val}>
                      <line
                        x1={inner.x}
                        y1={inner.y}
                        x2={outer.x}
                        y2={outer.y}
                        stroke="#475569"
                        strokeWidth="1"
                      />
                      <text
                        x={txt.x + tick.dx}
                        y={txt.y + tick.dy}
                        textAnchor={tick.anchor}
                        fill="#64748B"
                        fontSize="9.5"
                        className="font-mono"
                      >
                        {tick.label}
                      </text>
                    </g>
                  );
                })}

                {/* Gauge Needle */}
                <polygon
                  points={`${needleTip.x.toFixed(1)},${needleTip.y.toFixed(1)} ${needleBaseLeft.x.toFixed(1)},${needleBaseLeft.y.toFixed(1)} ${needleBaseRight.x.toFixed(1)},${needleBaseRight.y.toFixed(1)}`}
                  fill={scoreColor}
                />
                <circle cx={needleTip.x} cy={needleTip.y} r="2.5" fill="#F8FAFC" />
                <circle
                  cx={gaugeCx}
                  cy={gaugeCy}
                  r="6"
                  fill="#0F172A"
                  stroke="#E2E8F0"
                  strokeWidth="2"
                />

                {/* Bottom Score Readout */}
                <text
                  x={gaugeCx}
                  y={137}
                  textAnchor="middle"
                  fill={scoreColor}
                  fontSize="17"
                  fontWeight="700"
                  className="font-mono"
                >
                  {sentimentScore >= 0 ? `+${sentimentScore}` : sentimentScore}
                </text>
                <text
                  x={gaugeCx}
                  y={151}
                  textAnchor="middle"
                  fill="#94A3B8"
                  fontSize="10"
                  className="font-mono"
                >
                  {heatScore !== undefined
                    ? `净极性分 · 热度 ${heatScore}/100`
                    : '净情绪极性分 (-100 ~ +100)'}
                </text>
              </svg>
            </div>

            {/* Right: Dual-Polygon Bull vs Bear Radar Chart */}
            <div className="space-y-1 md:border-l md:border-slate-800/80 md:pl-4">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>多空力量雷达图</span>
                <div className="flex items-center gap-2.5 font-mono">
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <span className="w-2 h-2 rounded-xs bg-emerald-400 inline-block" />
                    多头
                  </span>
                  <span className="inline-flex items-center gap-1 text-rose-400">
                    <span className="w-2 h-2 rounded-xs bg-rose-400 inline-block" />
                    空头
                  </span>
                </div>
              </div>

              <svg
                viewBox={`0 0 ${radarW} ${radarH}`}
                className="w-full h-auto block"
                onMouseLeave={() => setHoverChannelIdx(null)}
              >
                {/* Concentric polygon rings (25%, 50%, 75%, 100%) */}
                {[25, 50, 75, 100].map((ring) => (
                  <polygon
                    key={ring}
                    points={radarAxes
                      .map((_, idx) => {
                        const pt = radarPoint(idx, ring);
                        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                      })
                      .join(' ')}
                    fill="none"
                    stroke={ring === 100 ? '#334155' : '#1E293B'}
                    strokeWidth="1"
                  />
                ))}

                {/* Spokes + Axis Labels */}
                {radarAxes.map((axis, idx) => {
                  const outer = radarPoint(idx, 100);
                  const labelPt = radarPoint(idx, 100, 1.28);
                  const cos = Math.cos(outer.angle);
                  const sin = Math.sin(outer.angle);
                  const textAnchor =
                    Math.abs(cos) < 0.22 ? 'middle' : cos > 0 ? 'start' : 'end';
                  const dy = Math.abs(sin) < 0.25 ? 3.5 : sin > 0 ? 9 : -2;
                  const isHovered =
                    channels.length >= 3 && hoverChannelIdx === idx;

                  return (
                    <g key={`${axis.label}-${idx}`}>
                      <line
                        x1={radarCx}
                        y1={radarCy}
                        x2={outer.x}
                        y2={outer.y}
                        stroke={isHovered ? '#64748B' : '#334155'}
                        strokeWidth={isHovered ? '1.3' : '1'}
                      />
                      <text
                        x={labelPt.x}
                        y={labelPt.y + dy}
                        textAnchor={textAnchor}
                        fill={isHovered ? '#F8FAFC' : '#CBD5E1'}
                        fontSize="10.5"
                        fontWeight={isHovered ? '600' : '500'}
                      >
                        {axis.label}
                      </text>
                    </g>
                  );
                })}

                {/* Ring scale numbers */}
                <text
                  x={radarCx + 4}
                  y={radarCy - radarR * 0.5 + 3}
                  fill="#475569"
                  fontSize="8.5"
                  className="font-mono"
                >
                  50
                </text>
                <text
                  x={radarCx + 4}
                  y={radarCy - radarR + 8}
                  fill="#64748B"
                  fontSize="8.5"
                  className="font-mono"
                >
                  100%
                </text>

                {/* Bearish Polygon */}
                <polygon
                  points={polygonPoints(radarAxes.map((a) => a.bear))}
                  fill="#F43F5E"
                  fillOpacity="0.2"
                  stroke="#F43F5E"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />

                {/* Bullish Polygon */}
                <polygon
                  points={polygonPoints(radarAxes.map((a) => a.bull))}
                  fill="#10B981"
                  fillOpacity="0.24"
                  stroke="#10B981"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />

                {/* Interactive Vertices */}
                {radarAxes.map((axis, idx) => {
                  const bullPt = radarPoint(idx, axis.bull);
                  const bearPt = radarPoint(idx, axis.bear);
                  const hitPt = radarPoint(idx, 100, 0.85);
                  const isHovered =
                    channels.length >= 3 && hoverChannelIdx === idx;
                  return (
                    <g
                      key={`pts-${idx}`}
                      onMouseEnter={() =>
                        channels.length >= 3 ? setHoverChannelIdx(idx) : undefined
                      }
                      className={channels.length >= 3 ? 'cursor-pointer' : undefined}
                    >
                      <circle cx={hitPt.x} cy={hitPt.y} r="22" fill="transparent" />
                      <circle
                        cx={bearPt.x}
                        cy={bearPt.y}
                        r={isHovered ? 4.2 : 2.8}
                        fill="#F43F5E"
                        stroke="#0F172A"
                        strokeWidth="1.2"
                      />
                      <circle
                        cx={bullPt.x}
                        cy={bullPt.y}
                        r={isHovered ? 4.2 : 2.8}
                        fill="#10B981"
                        stroke="#0F172A"
                        strokeWidth="1.2"
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        ) : (
          channels.length > 0 && (
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-auto block"
              onMouseLeave={() => setHoverChannelIdx(null)}
            >
              {/* Axis headers */}
              <text
                x={0}
                y={13}
                fill="#94A3B8"
                fontSize="10.5"
                fontWeight="600"
              >
                舆情渠道拆解
              </text>
              <text
                x={chartCenter - 10}
                y={13}
                textAnchor="end"
                fill="#FB7185"
                fontSize="10"
              >
                ← 看空声量
              </text>
              <text
                x={chartCenter}
                y={13}
                textAnchor="middle"
                fill="#64748B"
                fontSize="10"
                className="font-mono"
              >
                均衡
              </text>
              <text
                x={chartCenter + 10}
                y={13}
                textAnchor="start"
                fill="#34D399"
                fontSize="10"
              >
                看多声量 →
              </text>
              <text
                x={svgWidth - 4}
                y={13}
                textAnchor="end"
                fill="#94A3B8"
                fontSize="10"
              >
                热度
              </text>

              {/* Center equilibrium line */}
              <line
                x1={chartCenter}
                x2={chartCenter}
                y1={topPad - 4}
                y2={svgHeight - bottomPad}
                stroke="#334155"
                strokeWidth="1"
                strokeDasharray="3 3"
              />

              {channels.map((ch, idx) => {
                const rowY = topPad + idx * rowH;
                const barY = rowY + 11;
                const barH = 12;
                const bearW = (ch.bearPct / 100) * halfSpan;
                const bullW = (ch.bullPct / 100) * halfSpan;
                const isHovered = hoverChannelIdx === idx;

                return (
                  <g
                    key={`${ch.channel}-${idx}`}
                    onMouseEnter={() => setHoverChannelIdx(idx)}
                    className="cursor-pointer"
                  >
                    <rect
                      x={0}
                      y={rowY + 2}
                      width={svgWidth}
                      height={rowH - 4}
                      rx={4}
                      fill={isHovered ? '#1E293B' : 'transparent'}
                      opacity={isHovered ? 0.55 : 1}
                    />

                    <text
                      x={4}
                      y={rowY + 21}
                      fill={isHovered ? '#F8FAFC' : '#CBD5E1'}
                      fontSize="11.5"
                      fontWeight="500"
                    >
                      {ch.channel}
                    </text>

                    {/* Bearish bar extending left */}
                    <rect
                      x={chartCenter - bearW}
                      y={barY}
                      width={Math.max(2, bearW)}
                      height={barH}
                      rx={2}
                      fill="#F43F5E"
                      opacity={isHovered ? 1 : 0.85}
                    />
                    <text
                      x={chartCenter - bearW - 5}
                      y={rowY + 21}
                      textAnchor="end"
                      fill="#FDA4AF"
                      fontSize="10.5"
                      className="font-mono"
                    >
                      {ch.bearPct}%
                    </text>

                    {/* Bullish bar extending right */}
                    <rect
                      x={chartCenter}
                      y={barY}
                      width={Math.max(2, bullW)}
                      height={barH}
                      rx={2}
                      fill="#10B981"
                      opacity={isHovered ? 1 : 0.85}
                    />
                    <text
                      x={chartCenter + bullW + 5}
                      y={rowY + 21}
                      textAnchor="start"
                      fill="#6EE7B7"
                      fontSize="10.5"
                      className="font-mono"
                    >
                      {ch.bullPct}%
                    </text>

                    {/* Heat score column */}
                    <text
                      x={svgWidth - 4}
                      y={rowY + 21}
                      textAnchor="end"
                      fill={ch.heatScore >= 75 ? '#38BDF8' : '#94A3B8'}
                      fontSize="11"
                      fontWeight="600"
                      className="font-mono"
                    >
                      {ch.heatScore}
                    </text>
                  </g>
                );
              })}
            </svg>
          )
        )}

        {activeChannel && (
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-400 border-t border-slate-800/80 pt-2">
            <span>
              <span className="text-slate-200 font-medium mr-1.5">
                {activeChannel.channel}：
              </span>
              {activeChannel.summary}
            </span>
            <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
              <span className="text-emerald-400">多 {activeChannel.bullPct}%</span>
              <span className="mx-1 text-slate-600">/</span>
              <span className="text-rose-400">空 {activeChannel.bearPct}%</span>
              <span className="mx-1 text-slate-600">·</span>
              <span>热度 {activeChannel.heatScore}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

interface AtrAnomalyChartProps {
  report: AtrAnomalyReport;
  currencySymbol: string;
}

export const AtrAnomalyChart: React.FC<AtrAnomalyChartProps> = ({
  report,
  currencySymbol,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const { series, histMeanAtrPct, histStdAtrPct, warningThresholdPct, extremeThresholdPct } = report;

  const width = 680;
  const height = 216;
  const pad = { top: 20, right: 56, bottom: 26, left: 10 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const { minY, maxY } = useMemo(() => {
    let maxVal = Math.max(extremeThresholdPct * 1.08, report.currentAtrPct * 1.15);
    let minVal = Math.max(0, histMeanAtrPct - histStdAtrPct * 1.2);
    for (const pt of series) {
      if (pt.atrPct > maxVal) maxVal = pt.atrPct * 1.08;
      if (pt.trPct > maxVal) maxVal = Math.min(pt.trPct * 1.04, maxVal * 1.35);
      if (pt.atrPct < minVal) minVal = Math.max(0, pt.atrPct * 0.85);
    }
    if (maxVal <= minVal) maxVal = minVal + 1;
    return { minY: 0, maxY: maxVal };
  }, [series, extremeThresholdPct, report.currentAtrPct, histMeanAtrPct, histStdAtrPct]);

  if (series.length < 2) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-slate-500">
        历史 ATR 样本不足，暂无法绘制波动轨线
      </div>
    );
  }

  const xAt = (idx: number) =>
    pad.left + (idx / Math.max(1, series.length - 1)) * plotW;
  const yAt = (val: number) =>
    pad.top + (1 - (Math.min(maxY, Math.max(minY, val)) - minY) / (maxY - minY)) * plotH;

  const linePath = series
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(pt.atrPct).toFixed(1)}`)
    .join(' ');

  const areaPath = `${linePath} L ${xAt(series.length - 1).toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z`;

  const bandUpper = Math.min(maxY, histMeanAtrPct + histStdAtrPct);
  const bandLower = Math.max(0, histMeanAtrPct - histStdAtrPct);
  const bandTopY = yAt(bandUpper);
  const bandBotY = yAt(bandLower);

  const meanY = yAt(histMeanAtrPct);
  const warnY = yAt(warningThresholdPct);
  const extremeY = yAt(extremeThresholdPct);

  const activeIdx =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < series.length
      ? hoverIdx
      : series.length - 1;
  const activePt = series[activeIdx];
  const activeDevPct =
    histMeanAtrPct > 0 ? ((activePt.atrPct / histMeanAtrPct) - 1) * 100 : 0;

  const lineStroke =
    report.level === 'extreme'
      ? '#FB7185'
      : report.level === 'elevated'
        ? '#FBBF24'
        : '#38BDF8';

  const yTicks = [
    maxY * 0.25,
    maxY * 0.5,
    maxY * 0.75,
    maxY,
  ];

  const barW = Math.max(1.5, Math.min(5, (plotW / series.length) * 0.55));

  return (
    <div className="space-y-2 select-none">
      {/* Dynamic Hover Telemetry Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-400">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-slate-200 font-semibold">{activePt.date}</span>
          <span>
            ATR14{' '}
            <span className="text-slate-100">
              {currencySymbol}
              {activePt.atr14.toFixed(2)}
            </span>
          </span>
          <span>
            占价率{' '}
            <span
              className={
                activePt.atrPct >= extremeThresholdPct
                  ? 'text-rose-400 font-semibold'
                  : activePt.atrPct >= warningThresholdPct
                    ? 'text-amber-300 font-semibold'
                    : 'text-sky-300 font-semibold'
              }
            >
              {activePt.atrPct.toFixed(2)}%
            </span>
          </span>
          <span>
            较均值{' '}
            <span
              className={
                activeDevPct >= 25
                  ? 'text-amber-300 font-semibold'
                  : activeDevPct <= -20
                    ? 'text-sky-300'
                    : 'text-slate-200'
              }
            >
              {activeDevPct >= 0 ? '+' : ''}
              {activeDevPct.toFixed(1)}%
            </span>
          </span>
          <span>
            当日波幅 TR{' '}
            <span className="text-slate-300">{activePt.trPct.toFixed(2)}%</span>
          </span>
        </div>

        <div className="flex items-center gap-3 text-[10.5px]">
          <span className="inline-flex items-center gap-1 text-slate-400">
            <span className="w-3 h-0.5 bg-slate-400 inline-block" />
            均值 {histMeanAtrPct.toFixed(2)}%
          </span>
          <span className="inline-flex items-center gap-1 text-amber-300">
            <span className="w-3 h-0.5 bg-amber-400 inline-block" />
            1.25×预警
          </span>
          <span className="inline-flex items-center gap-1 text-rose-400">
            <span className="w-3 h-0.5 bg-rose-500 inline-block" />
            1.50×高危
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * width;
          const clamped = Math.max(pad.left, Math.min(pad.left + plotW, relX));
          const idx = Math.round(((clamped - pad.left) / plotW) * (series.length - 1));
          setHoverIdx(Math.max(0, Math.min(series.length - 1, idx)));
        }}
      >
        <defs>
          <linearGradient id="atrAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineStroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lineStroke} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Horizontal Gridlines & Right Axis Labels */}
        {yTicks.map((tick, idx) => {
          const y = yAt(tick);
          return (
            <g key={idx}>
              <line
                x1={pad.left}
                x2={pad.left + plotW}
                y1={y}
                y2={y}
                stroke="#1E293B"
                strokeWidth="1"
              />
              <text
                x={pad.left + plotW + 6}
                y={y + 3}
                fill="#64748B"
                fontSize="9.5"
                className="font-mono"
              >
                {tick.toFixed(1)}%
              </text>
            </g>
          );
        })}

        {/* ±1σ Historical Normal Volatility Band */}
        <rect
          x={pad.left}
          y={bandTopY}
          width={plotW}
          height={Math.max(1, bandBotY - bandTopY)}
          fill="#334155"
          fillOpacity="0.28"
        />

        {/* Single-day TR% Spike Bars along baseline */}
        {series.map((pt, i) => {
          const x = xAt(i);
          const barTopY = yAt(pt.trPct);
          const barH = Math.max(1, pad.top + plotH - barTopY);
          const isTrShock = pt.atr14 > 0 && pt.tr / pt.atr14 >= 1.75;
          return (
            <rect
              key={`tr-${pt.date}-${i}`}
              x={x - barW / 2}
              y={barTopY}
              width={barW}
              height={barH}
              fill={isTrShock ? '#FB7185' : '#475569'}
              fillOpacity={isTrShock ? 0.55 : 0.28}
            />
          );
        })}

        {/* Baseline Mean Line */}
        <line
          x1={pad.left}
          x2={pad.left + plotW}
          y1={meanY}
          y2={meanY}
          stroke="#94A3B8"
          strokeWidth="1.2"
          strokeDasharray="4 4"
        />

        {/* Warning 1.25x Threshold */}
        {warningThresholdPct <= maxY && (
          <line
            x1={pad.left}
            x2={pad.left + plotW}
            y1={warnY}
            y2={warnY}
            stroke="#F59E0B"
            strokeWidth="1"
            strokeDasharray="3 3"
            strokeOpacity="0.75"
          />
        )}

        {/* Extreme 1.50x Threshold */}
        {extremeThresholdPct <= maxY && (
          <line
            x1={pad.left}
            x2={pad.left + plotW}
            y1={extremeY}
            y2={extremeY}
            stroke="#F43F5E"
            strokeWidth="1.1"
            strokeDasharray="4 3"
            strokeOpacity="0.85"
          />
        )}

        {/* ATR% Area & Curve */}
        <path d={areaPath} fill="url(#atrAreaGrad)" />
        <path
          d={linePath}
          fill="none"
          stroke={lineStroke}
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Highlight anomaly dots on curve */}
        {series.map((pt, i) => {
          if (pt.atrPct < warningThresholdPct) return null;
          const isExtreme = pt.atrPct >= extremeThresholdPct;
          return (
            <circle
              key={`anom-${pt.date}-${i}`}
              cx={xAt(i)}
              cy={yAt(pt.atrPct)}
              r={isExtreme ? 2.6 : 2}
              fill={isExtreme ? '#F43F5E' : '#F59E0B'}
            />
          );
        })}

        {/* Active Hover Crosshair & Dot */}
        <line
          x1={xAt(activeIdx)}
          x2={xAt(activeIdx)}
          y1={pad.top}
          y2={pad.top + plotH}
          stroke="#64748B"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <circle
          cx={xAt(activeIdx)}
          cy={yAt(activePt.atrPct)}
          r="4"
          fill={
            activePt.atrPct >= extremeThresholdPct
              ? '#F43F5E'
              : activePt.atrPct >= warningThresholdPct
                ? '#F59E0B'
                : '#38BDF8'
          }
          stroke="#0F172A"
          strokeWidth="1.5"
        />

        {/* Bottom X Axis Dates */}
        {[0, Math.floor((series.length - 1) / 2), series.length - 1].map((idx) => (
          <text
            key={`x-${idx}`}
            x={xAt(idx)}
            y={height - 6}
            textAnchor={idx === 0 ? 'start' : idx === series.length - 1 ? 'end' : 'middle'}
            fill="#64748B"
            fontSize="9.5"
            className="font-mono"
          >
            {series[idx].date}
          </text>
        ))}
      </svg>
    </div>
  );
};




