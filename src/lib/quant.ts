import type {
  AtrAnomalyLevel,
  AtrAnomalyPoint,
  AtrAnomalyReport,
  AtrPositionResult,
  BacktestGridRow,
  BacktestPoint,
  BacktestResult,
  BacktestTrade,
  EnrichedOptionContract,
  ForecastModelMode,
  ForecastPoint,
  IndicatorBar,
  OhlcvBar,
  OptionRight,
  PayoffGridPoint,
  PortfolioHealthAdjustment,
  PortfolioHealthDiagnosis,
  PortfolioHealthRiskItem,
  RawOptionContract,
  StockForecastResult,
  TechnicalSignals,
} from '../types/trading';

/**
 * Standard normal cumulative distribution function (Abramowitz & Stegun approximation)
 */
export function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function computeIndicators(bars: OhlcvBar[]): IndicatorBar[] {
  const n = bars.length;
  const result: IndicatorBar[] = [];
  const trValues: number[] = [];
  const logReturns: (number | null)[] = [];
  const hv20Values: (number | null)[] = [];

  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    const prevClose = i > 0 ? bars[i - 1].close : bar.close;
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevClose),
      Math.abs(bar.low - prevClose)
    );
    trValues.push(tr);

    const lr = i > 0 && bars[i - 1].close > 0 && bar.close > 0
      ? Math.log(bar.close / bars[i - 1].close)
      : null;
    logReturns.push(lr);

    const ma20 =
      i >= 19
        ? bars.slice(i - 19, i + 1).reduce((s, b) => s + b.close, 0) / 20
        : null;

    const ma60 =
      i >= 59
        ? bars.slice(i - 59, i + 1).reduce((s, b) => s + b.close, 0) / 60
        : null;

    const atr14 =
      i >= 13
        ? trValues.slice(i - 13, i + 1).reduce((s, v) => s + v, 0) / 14
        : null;

    const hv20 = calcAnnualizedStd(logReturns, i, 20);
    const hv60 = calcAnnualizedStd(logReturns, i, 60);
    hv20Values.push(hv20);

    let hvRank: number | null = null;
    if (hv20 !== null) {
      const lookbackStart = Math.max(0, i - 251);
      const validWindow = hv20Values
        .slice(lookbackStart, i + 1)
        .filter((v): v is number => v !== null);
      if (validWindow.length >= 40) {
        const belowOrEqual = validWindow.filter((v) => v <= hv20).length;
        hvRank = (belowOrEqual / validWindow.length) * 100;
      }
    }

    result.push({
      ...bar,
      ma20,
      ma60,
      atr14,
      hv20,
      hv60,
      hvRank,
    });
  }

  return result;
}

function calcAnnualizedStd(
  logReturns: (number | null)[],
  endIdx: number,
  window: number
): number | null {
  if (endIdx < window) return null;
  const slice = logReturns
    .slice(endIdx - window + 1, endIdx + 1)
    .filter((v): v is number => v !== null);
  if (slice.length < Math.floor(window * 0.8)) return null;
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance =
    slice.reduce((acc, val) => acc + (val - mean) ** 2, 0) /
    Math.max(1, slice.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function calcAtrPosition(params: {
  totalCapitalCny: number;
  riskPct: number;
  priceLocal: number;
  atrLocal: number;
  atrMultiplier: number;
  fxToCny: number;
  lotSize: number;
}): AtrPositionResult {
  const {
    totalCapitalCny,
    riskPct,
    priceLocal,
    atrLocal,
    atrMultiplier,
    fxToCny,
    lotSize,
  } = params;

  const riskBudgetCny = totalCapitalCny * (riskPct / 100);
  const stopDistanceLocal = Math.max(0, atrLocal * atrMultiplier);
  const stopPrice = Math.max(0.01, priceLocal - stopDistanceLocal);
  const riskPerShareCny = stopDistanceLocal * fxToCny;

  if (riskPerShareCny <= 0 || priceLocal <= 0 || lotSize <= 0) {
    return {
      shares: 0,
      stopPrice,
      costCny: 0,
      weightPct: 0,
      riskCny: 0,
      stopDistanceLocal,
    };
  }

  const rawShares = riskBudgetCny / riskPerShareCny;
  const shares = Math.floor(rawShares / lotSize) * lotSize;
  const costCny = shares * priceLocal * fxToCny;
  const riskCny = shares * riskPerShareCny;
  const weightPct = totalCapitalCny > 0 ? (costCny / totalCapitalCny) * 100 : 0;

  return {
    shares,
    stopPrice,
    costCny,
    weightPct,
    riskCny,
    stopDistanceLocal,
  };
}

export function classifyTrend(last: IndicatorBar): 'bull' | 'bear' | 'range' {
  if (last.ma20 === null || last.ma60 === null) return 'range';
  if (last.close > last.ma20 && last.ma20 > last.ma60) return 'bull';
  if (last.close < last.ma20 && last.ma20 < last.ma60) return 'bear';
  return 'range';
}

export function runTrendBacktest(
  rawBars: OhlcvBar[],
  options: {
    fastMa: number;
    slowMa: number;
    atrMult: number;
    feeRate: number;
  }
): BacktestResult {
  const { fastMa, slowMa, atrMult, feeRate } = options;
  const indBars = computeIndicators(rawBars);

  const enriched = indBars.map((bar, idx) => {
    const fast =
      idx >= fastMa - 1
        ? indBars.slice(idx - fastMa + 1, idx + 1).reduce((s, b) => s + b.close, 0) /
          fastMa
        : null;
    const slow =
      idx >= slowMa - 1
        ? indBars.slice(idx - slowMa + 1, idx + 1).reduce((s, b) => s + b.close, 0) /
          slowMa
        : null;
    return { ...bar, fastMa: fast, slowMa: slow };
  });

  const valid = enriched.filter(
    (b): b is typeof b & { fastMa: number; slowMa: number; atr14: number } =>
      b.fastMa !== null && b.slowMa !== null && b.atr14 !== null
  );

  if (valid.length < 25) {
    throw new Error('有效历史K线天数不足（需至少覆盖慢线周期 + 25天），请缩短慢线或增加回测年限。');
  }

  let cash = 1.0;
  let position = 0.0;
  let highestSinceEntry = 0.0;
  let stopLevel = 0.0;
  let pendingSignal: 0 | 1 | -1 = 0;
  let pendingReason = '';
  let entryPrice = 0.0;

  const equityCurve: BacktestPoint[] = [];
  const trades: BacktestTrade[] = [];
  let peakEquity = 1.0;
  const initialClose = valid[0].close;

  for (let i = 0; i < valid.length; i++) {
    const bar = valid[i];

    // Execute prior bar's close signal at today's open (zero look-ahead bias, T+1 compliant)
    if (pendingSignal === 1 && position === 0 && bar.open > 0) {
      const buyPrice = bar.open;
      position = (cash * (1 - feeRate)) / buyPrice;
      cash = 0;
      entryPrice = buyPrice;
      highestSinceEntry = bar.high;
      stopLevel = buyPrice - atrMult * bar.atr14;
      trades.push({
        date: bar.date,
        action: '买入',
        price: buyPrice,
        reason: pendingReason,
      });
    } else if (pendingSignal === -1 && position > 0 && bar.open > 0) {
      const sellPrice = bar.open;
      cash = position * sellPrice * (1 - feeRate);
      const pnlPct = ((sellPrice - entryPrice) / entryPrice) * 100;
      position = 0;
      trades.push({
        date: bar.date,
        action: '卖出',
        price: sellPrice,
        pnlPct,
        reason: pendingReason,
      });
    }

    pendingSignal = 0;
    pendingReason = '';

    // Update trailing ATR stop while in position
    if (position > 0) {
      highestSinceEntry = Math.max(highestSinceEntry, bar.high);
      stopLevel = Math.max(stopLevel, highestSinceEntry - atrMult * bar.atr14);
    }

    // Evaluate exit/entry at bar close
    if (position === 0 && bar.fastMa > bar.slowMa && bar.close > bar.fastMa) {
      pendingSignal = 1;
      pendingReason = `MA${fastMa} > MA${slowMa} 多头突破`;
    } else if (position > 0) {
      if (bar.close < stopLevel) {
        pendingSignal = -1;
        pendingReason = `跌破 ${atrMult}×ATR 移动止损`;
      } else if (bar.fastMa < bar.slowMa) {
        pendingSignal = -1;
        pendingReason = `MA${fastMa} 下穿 MA${slowMa}`;
      }
    }

    const totalEq = cash + position * bar.close;
    peakEquity = Math.max(peakEquity, totalEq);
    const drawdownPct = ((totalEq - peakEquity) / peakEquity) * 100;

    equityCurve.push({
      date: bar.date,
      strategy: totalEq,
      benchmark: bar.close / initialClose,
      drawdownPct,
    });
  }

  // Metrics
  const finalEq = equityCurve[equityCurve.length - 1].strategy;
  const finalBench = equityCurve[equityCurve.length - 1].benchmark;
  const startMs = new Date(valid[0].date).getTime();
  const endMs = new Date(valid[valid.length - 1].date).getTime();
  const years = Math.max((endMs - startMs) / (365.25 * 24 * 3600 * 1000), 0.1);

  const totalReturnPct = (finalEq - 1) * 100;
  const cagrPct = (Math.pow(finalEq, 1 / years) - 1) * 100;
  const maxDrawdownPct = Math.min(...equityCurve.map((p) => p.drawdownPct));

  const dailyRets: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    dailyRets.push(equityCurve[i].strategy / equityCurve[i - 1].strategy - 1);
  }
  const meanRet =
    dailyRets.reduce((a, b) => a + b, 0) / Math.max(1, dailyRets.length);
  const stdRet = Math.sqrt(
    dailyRets.reduce((s, r) => s + (r - meanRet) ** 2, 0) /
      Math.max(1, dailyRets.length - 1)
  );
  const sharpeRatio = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252) : 0;
  const calmarRatio =
    maxDrawdownPct < 0 ? cagrPct / Math.abs(maxDrawdownPct) : 0;

  const closed = trades.filter((t) => t.action === '卖出' && t.pnlPct !== undefined);
  const winners = closed.filter((t) => (t.pnlPct ?? 0) > 0);
  const losers = closed.filter((t) => (t.pnlPct ?? 0) <= 0);
  const winRatePct = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
  const grossWin = winners.reduce((s, t) => s + (t.pnlPct ?? 0), 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + (t.pnlPct ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 9.99 : 0;

  return {
    equityCurve,
    trades,
    metrics: {
      totalReturnPct,
      cagrPct,
      maxDrawdownPct,
      sharpeRatio,
      calmarRatio,
      closedTrades: closed.length,
      winRatePct,
      profitFactor,
      benchmarkReturnPct: (finalBench - 1) * 100,
    },
  };
}

export function runParameterGridSearch(
  rawBars: OhlcvBar[],
  feeRate: number
): BacktestGridRow[] {
  const fastList = [10, 15, 20, 30];
  const slowList = [40, 60, 90, 120];
  const atrList = [1.5, 2.0, 2.5, 3.0];
  const rows: BacktestGridRow[] = [];

  for (const fastMa of fastList) {
    for (const slowMa of slowList) {
      if (fastMa >= slowMa) continue;
      for (const atrMult of atrList) {
        try {
          const res = runTrendBacktest(rawBars, {
            fastMa,
            slowMa,
            atrMult,
            feeRate,
          });
          rows.push({
            fastMa,
            slowMa,
            atrMult,
            totalReturnPct: res.metrics.totalReturnPct,
            cagrPct: res.metrics.cagrPct,
            maxDrawdownPct: res.metrics.maxDrawdownPct,
            sharpeRatio: res.metrics.sharpeRatio,
            winRatePct: res.metrics.winRatePct,
            closedTrades: res.metrics.closedTrades,
          });
        } catch {
          // skip combinations lacking enough bars
        }
      }
    }
  }

  rows.sort((a, b) => {
    if (Math.abs(b.sharpeRatio - a.sharpeRatio) > 0.05) {
      return b.sharpeRatio - a.sharpeRatio;
    }
    return b.totalReturnPct - a.totalReturnPct;
  });

  return rows.slice(0, 8);
}

export function bsOptionGreeks(params: {
  spot: number;
  strike: number;
  timeYears: number;
  riskFreeRate: number;
  iv: number;
  right: OptionRight;
}): {
  price: number;
  delta: number;
  gamma: number;
  thetaPerDay: number;
  vegaPerPct: number;
} {
  const { spot: S, strike: K, timeYears: T, riskFreeRate: r, iv: sigma, right } =
    params;

  if (T <= 1e-6 || sigma <= 1e-6 || S <= 0 || K <= 0) {
    const intrinsic = right === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
    return {
      price: intrinsic,
      delta: right === 'call' ? (S > K ? 1 : 0) : S < K ? -1 : 0,
      gamma: 0,
      thetaPerDay: 0,
      vegaPerPct: 0,
    };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const expRT = Math.exp(-r * T);

  let price: number;
  let delta: number;
  let thetaAnnual: number;

  if (right === 'call') {
    price = S * normCdf(d1) - K * expRT * normCdf(d2);
    delta = normCdf(d1);
    thetaAnnual =
      (-S * normPdf(d1) * sigma) / (2 * sqrtT) - r * K * expRT * normCdf(d2);
  } else {
    price = K * expRT * normCdf(-d2) - S * normCdf(-d1);
    delta = normCdf(d1) - 1;
    thetaAnnual =
      (-S * normPdf(d1) * sigma) / (2 * sqrtT) + r * K * expRT * normCdf(-d2);
  }

  const gamma = normPdf(d1) / (S * sigma * sqrtT);
  const vegaPerPct = (S * normPdf(d1) * sqrtT) / 100;

  return {
    price,
    delta,
    gamma,
    thetaPerDay: thetaAnnual / 365,
    vegaPerPct,
  };
}

export function enrichOptionChain(
  contracts: RawOptionContract[],
  spot: number,
  expiryStr: string,
  right: OptionRight,
  riskFreeRate = 0.043
): EnrichedOptionContract[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expDate = new Date(`${expiryStr}T00:00:00`);
  const dte = Math.max(
    1,
    Math.round((expDate.getTime() - today.getTime()) / (24 * 3600 * 1000))
  );
  const T = dte / 365;

  return contracts.map((c) => {
    const midPrice =
      c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : c.lastPrice || 0;
    const spreadPct =
      midPrice > 0 && c.ask > c.bid && c.bid > 0
        ? ((c.ask - c.bid) / midPrice) * 100
        : 0;
    const iv = Math.max(0.05, c.impliedVolatility || 0.3);
    const greeks = bsOptionGreeks({
      spot,
      strike: c.strike,
      timeYears: T,
      riskFreeRate,
      iv,
      right,
    });

    return {
      ...c,
      midPrice,
      ivPct: iv * 100,
      delta: greeks.delta,
      gamma: greeks.gamma,
      thetaPerDay: greeks.thetaPerDay,
      vegaPerPct: greeks.vegaPerPct,
      dte,
      spreadPct,
    };
  });
}

export function simulatePayoffCurves(params: {
  spot: number;
  strike: number;
  entryPremium: number;
  contracts: number;
  dte: number;
  iv: number;
  right: OptionRight;
  riskFreeRate?: number;
}): {
  grid: PayoffGridPoint[];
  breakeven: number;
  maxLossUsd: number;
} {
  const {
    spot,
    strike,
    entryPremium,
    contracts,
    dte,
    iv,
    right,
    riskFreeRate = 0.043,
  } = params;

  const minSpot = spot * 0.72;
  const maxSpot = spot * 1.28;
  const steps = 60;
  const midDte = Math.max(1, Math.floor(dte / 2));
  const multiplier = 100 * contracts;

  const grid: PayoffGridPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = minSpot + ((maxSpot - minSpot) * i) / steps;
    const todayVal = bsOptionGreeks({
      spot: s,
      strike,
      timeYears: dte / 365,
      riskFreeRate,
      iv,
      right,
    }).price;
    const midVal = bsOptionGreeks({
      spot: s,
      strike,
      timeYears: midDte / 365,
      riskFreeRate,
      iv,
      right,
    }).price;
    const expiryVal =
      right === 'call' ? Math.max(0, s - strike) : Math.max(0, strike - s);

    grid.push({
      spot: s,
      todayPnl: (todayVal - entryPremium) * multiplier,
      midPnl: (midVal - entryPremium) * multiplier,
      expiryPnl: (expiryVal - entryPremium) * multiplier,
    });
  }

  const breakeven =
    right === 'call' ? strike + entryPremium : Math.max(0, strike - entryPremium);
  const maxLossUsd = entryPremium * multiplier;

  return { grid, breakeven, maxLossUsd };
}

export function calcDaysLeft(dateStr: string): number | null {
  if (!dateStr.trim()) return null;
  const parsed = new Date(`${dateStr.trim()}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parsed.getTime() - today.getTime()) / (24 * 3600 * 1000));
}

export function formatMoney(val: number, symbol = '¥', decimals = 0): string {
  const abs = Math.abs(val);
  const formatted = abs.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${val < 0 ? '-' : ''}${symbol}${formatted}`;
}

function calcEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcWilderRsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function computeStockForecast(
  indBars: IndicatorBar[],
  options: {
    horizonDays?: number;
    mode?: ForecastModelMode;
    atrMultiplier?: number;
  } = {}
): StockForecastResult {
  const horizonDays = options.horizonDays ?? 20;
  const mode = options.mode ?? 'momentum';
  const atrMultiplier = options.atrMultiplier ?? 2.0;

  const last = indBars[indBars.length - 1];
  const currentPrice = last.close;
  const closes = indBars.map((b) => b.close);

  // 1. Technical indicators
  const rsi14 = calcWilderRsi(closes, 14);
  const ema12 = calcEmaSeries(closes, 12);
  const ema26 = calcEmaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEmaSeries(macdLine, 9);
  const macd = macdLine[macdLine.length - 1] ?? 0;
  const macdSignal = signalLine[signalLine.length - 1] ?? 0;
  const macdHist = macd - macdSignal;

  const recent20 = indBars.slice(-20);
  const mean20 = recent20.reduce((s, b) => s + b.close, 0) / Math.max(1, recent20.length);
  const std20 = Math.sqrt(
    recent20.reduce((s, b) => s + (b.close - mean20) ** 2, 0) /
      Math.max(1, recent20.length - 1)
  );
  const bollUpper = mean20 + 2 * std20;
  const bollLower = Math.max(0.01, mean20 - 2 * std20);
  const bollPctB =
    bollUpper > bollLower ? (currentPrice - bollLower) / (bollUpper - bollLower) : 0.5;

  const avgVol20 =
    recent20.reduce((s, b) => s + b.volume, 0) / Math.max(1, recent20.length);
  const volumeRatio = avgVol20 > 0 ? last.volume / avgVol20 : 1.0;

  const support20 = Math.min(...recent20.map((b) => b.low));
  const resistance20 = Math.max(...recent20.map((b) => b.high));
  const atr14 = last.atr14 ?? currentPrice * 0.025;
  const atrTargetUp = currentPrice + atr14 * Math.sqrt(horizonDays / 5) * 1.1;
  const atrTargetDown = Math.max(0.01, currentPrice - atr14 * atrMultiplier);

  const signals: TechnicalSignals = {
    rsi14,
    macd,
    macdSignal,
    macdHist,
    bollUpper,
    bollLower,
    bollPctB,
    volumeRatio,
    support20,
    resistance20,
    atrTargetUp,
    atrTargetDown,
  };

  // 2. GBM Drift & Volatility Cone Projection
  const sigma = Math.max(0.08, (last.hv20 ?? last.hv60 ?? 28) / 100);
  const lookback60 = indBars[Math.max(0, indBars.length - 61)];
  const rawAnnDrift =
    lookback60 && lookback60.close > 0 && indBars.length > 20
      ? Math.log(currentPrice / lookback60.close) * (252 / Math.min(60, indBars.length - 1))
      : 0.05;

  let mu = 0.04;
  if (mode === 'momentum') {
    mu = Math.max(-0.42, Math.min(0.42, rawAnnDrift));
  } else if (mode === 'mean_revert') {
    const anchor = last.ma60 ?? mean20;
    const gap = anchor > 0 ? Math.log(anchor / currentPrice) : 0;
    mu = Math.max(-0.4, Math.min(0.4, gap * 2.5));
  } else {
    mu = 0.04;
  }

  const points: ForecastPoint[] = [];
  for (let d = 0; d <= horizonDays; d++) {
    if (d === 0) {
      points.push({
        dayOffset: 0,
        label: '今日',
        p10: currentPrice,
        p25: currentPrice,
        p50: currentPrice,
        p75: currentPrice,
        p90: currentPrice,
      });
      continue;
    }
    const tau = d / 252;
    const driftTerm = (mu - 0.5 * sigma * sigma) * tau;
    const volTerm = sigma * Math.sqrt(tau);
    points.push({
      dayOffset: d,
      label: `T+${d}`,
      p10: currentPrice * Math.exp(driftTerm - 1.2816 * volTerm),
      p25: currentPrice * Math.exp(driftTerm - 0.6745 * volTerm),
      p50: currentPrice * Math.exp(driftTerm),
      p75: currentPrice * Math.exp(driftTerm + 0.6745 * volTerm),
      p90: currentPrice * Math.exp(driftTerm + 1.2816 * volTerm),
    });
  }

  const T = horizonDays / 252;
  const zAbove =
    ((mu - 0.5 * sigma * sigma) * T) / Math.max(1e-6, sigma * Math.sqrt(T));
  const probAboveCurrentPct = normCdf(zAbove) * 100;

  // 3. Multi-factor Buy Decision Engine
  const trend = classifyTrend(last);
  const ma20 = last.ma20 ?? currentPrice;
  const ma60 = last.ma60 ?? currentPrice;
  const distFromMa20Pct = ma20 > 0 ? ((currentPrice - ma20) / ma20) * 100 : 0;

  const stopDist = Math.max(0.01, currentPrice - atrTargetDown);
  const upsideTarget = Math.max(
    resistance20 * 1.02,
    points[points.length - 1]?.p75 ?? atrTargetUp
  );
  const rewardDist = Math.max(0, upsideTarget - currentPrice);
  const riskRewardRatio = rewardDist / stopDist;

  const factors = [
    {
      name: '中期均线结构',
      status: (trend === 'bull' ? 'pass' : trend === 'bear' ? 'fail' : 'neutral') as
        | 'pass'
        | 'neutral'
        | 'fail',
      reading:
        trend === 'bull' ? '多头排列' : trend === 'bear' ? '空头排列' : '震荡交织',
      detail: `现价偏离 MA20 ${distFromMa20Pct >= 0 ? '+' : ''}${distFromMa20Pct.toFixed(1)}% · MA20 ${ma20.toFixed(2)} / MA60 ${ma60.toFixed(2)}`,
    },
    {
      name: 'MACD 动能',
      status: (macdHist > 0 && macd > 0
        ? 'pass'
        : macdHist < 0 && macd < 0
          ? 'fail'
          : 'neutral') as 'pass' | 'neutral' | 'fail',
      reading: macdHist >= 0 ? `红柱 +${macdHist.toFixed(2)}` : `绿柱 ${macdHist.toFixed(2)}`,
      detail: macdHist >= 0 ? '短期买盘动能占优' : '短线动能走弱，注意抛压',
    },
    {
      name: 'RSI(14) 拥挤度',
      status: (rsi14 >= 45 && rsi14 <= 68
        ? 'pass'
        : rsi14 > 74 || rsi14 < 30
          ? 'fail'
          : 'neutral') as 'pass' | 'neutral' | 'fail',
      reading: `RSI ${rsi14.toFixed(1)}`,
      detail:
        rsi14 > 74
          ? '短线处于超买区，直接追高赔率较差'
          : rsi14 < 30
            ? '处于超卖区，等待止跌阳线确认'
            : '处于健康未过热区间',
    },
    {
      name: '量价配合 (量比)',
      status: (volumeRatio >= 1.05 ? 'pass' : volumeRatio < 0.75 ? 'neutral' : 'neutral') as
        | 'pass'
        | 'neutral'
        | 'fail',
      reading: `${volumeRatio.toFixed(2)}x`,
      detail:
        volumeRatio >= 1.2
          ? '成交量明显放大，资金介入活跃'
          : volumeRatio < 0.8
            ? '成交缩量，突破持续性存疑'
            : '成交量处于20日均值附近',
    },
    {
      name: '盈亏比空间 (R:R)',
      status: (riskRewardRatio >= 1.4 ? 'pass' : riskRewardRatio < 0.9 ? 'fail' : 'neutral') as
        | 'pass'
        | 'neutral'
        | 'fail',
      reading: `${riskRewardRatio.toFixed(2)} : 1`,
      detail: `上行目标 ${upsideTarget.toFixed(2)} vs 止损 ${atrTargetDown.toFixed(2)}`,
    },
  ];

  // Determine clear Buy Verdict
  let verdict: 'buy' | 'pullback' | 'wait' | 'avoid';
  let verdictLabel: string;
  let actionHeadline: string;
  let reasonSummary: string;
  let optionAction: string;

  if (trend === 'bull' && rsi14 <= 72 && macdHist >= -0.05 * atr14) {
    if (distFromMa20Pct > 6.5 || rsi14 > 68) {
      verdict = 'pullback';
      verdictLabel = '趋势偏多 · 建议回踩低吸';
      actionHeadline = '不建议当前追高，建议等待回踩 MA20 附近再买';
      reasonSummary = `多头排列确立，但当前偏离20日均线 +${distFromMa20Pct.toFixed(1)}%（RSI ${rsi14.toFixed(0)}），直接追买止损空间偏大。`;
      optionAction = '暂缓追买近月 Call，等回踩支撑企稳后买入 30–60 天平值 Call。';
    } else {
      verdict = 'buy';
      verdictLabel = '建议买入 (顺势做多)';
      actionHeadline = '多因子共振偏多，当前位置具备顺势买入条件';
      reasonSummary = `均线呈多头排列，RSI(${rsi14.toFixed(0)}) 处于健康区间且盈亏比约 ${riskRewardRatio.toFixed(1)}:1，可按以损定仓规则执行。`;
      optionAction = '若为美股标的，可关注 30–60 天、Delta 0.40–0.55 的 Call（下单前先核对 IV 是否偏贵）。';
    }
  } else if (trend === 'bull' && rsi14 > 72) {
    verdict = 'pullback';
    verdictLabel = '高位过热 · 勿追高';
    actionHeadline = '短线超买严重，建议等待回调后再介入';
    reasonSummary = `RSI(14) 已达 ${rsi14.toFixed(1)} 且触及布林上轨附近，短期容易出现获利回吐震荡。`;
    optionAction = '高 RSI 通常伴随高 IV，此时买 Call 极易遭遇回踩+杀波动率双杀。';
  } else if (trend === 'bear') {
    verdict = 'avoid';
    verdictLabel = '不建议买入 (规避下行)';
    actionHeadline = '处于空头下行结构，不建议买入正股或看涨期权';
    reasonSummary = `价格位于 MA20 与 MA60 下方，且${macdHist < 0 ? 'MACD 动能仍为负' : '尚未形成底部反转结构'}，抄底易被连续止损。`;
    optionAction = '绝对避免抄底买 Call；若有对冲或做空计划，仅可轻仓评估 Put。';
  } else {
    verdict = 'wait';
    verdictLabel = '震荡观望 · 暂不建议开仓';
    actionHeadline = '方向未明，建议观望等待突破确认';
    reasonSummary = `均线处于交织整理阶段（布林 %B ${(bollPctB * 100).toFixed(0)}%），缺少明确单边趋势动量。`;
    optionAction = '震荡市是期权买方最大杀手（Theta 每天白白损耗），建议空仓等待放量突破。';
  }

  let outlook: StockForecastResult['outlook'] = 'neutral';
  let outlookLabel = '震荡整固';
  if (verdict === 'buy') {
    outlook = 'bullish';
    outlookLabel = '多头延续预测';
  } else if (verdict === 'pullback') {
    outlook = 'cautious_bull';
    outlookLabel = '偏多但防短线回踩';
  } else if (verdict === 'avoid') {
    outlook = rsi14 < 32 ? 'cautious_bear' : 'bearish';
    outlookLabel = rsi14 < 32 ? '偏空但接近超卖' : '空头承压预测';
  }

  const endPt = points[points.length - 1];
  const summaryText = `未来 ${horizonDays} 个交易日波动率基准（HV=${(sigma * 100).toFixed(1)}%）下，中性预期中位价格 ${endPt.p50.toFixed(2)}，80% 概率落于 ${endPt.p10.toFixed(2)} – ${endPt.p90.toFixed(2)} 区间。`;

  const idealEntryLow = Math.min(currentPrice, Math.max(support20, ma20 * 0.99));
  const idealEntryHigh = verdict === 'buy' ? currentPrice * 1.005 : Math.max(idealEntryLow, ma20 * 1.015);

  return {
    horizonDays,
    mode,
    currentPrice,
    points,
    signals,
    outlook,
    outlookLabel,
    summaryText,
    optionHint: optionAction,
    probAboveCurrentPct,
    buyDecision: {
      verdict,
      verdictLabel,
      actionHeadline,
      reasonSummary,
      optionAction,
      idealEntryLow,
      idealEntryHigh,
      targetPrice: upsideTarget,
      riskRewardRatio,
      factors,
    },
  };
}

export interface PortfolioHealthInputHolding {
  symbol: string;
  marketLabel: string;
  radarMarket?: 'US' | 'HK' | 'CN';
  radarSymbol?: string;
  marketValueCny: number;
  pnlPct: number | null;
  isOption: boolean;
  daysLeft: number | null;
  hv20: number | null;
  hvRank: number | null;
  trend: 'bull' | 'bear' | 'range' | null;
  atrPct: number | null;
}

export function diagnosePortfolioHealth(params: {
  holdings: PortfolioHealthInputHolding[];
  totalCapitalCny: number;
  totalMarketCny: number;
  optionMarketCny: number;
  utilizationPct: number;
}): PortfolioHealthDiagnosis {
  const { holdings, totalCapitalCny, totalMarketCny, optionMarketCny, utilizationPct } = params;

  const equityHoldings = holdings.filter((h) => !h.isOption && h.marketValueCny > 0);
  const pricedEquities = equityHoldings.filter((h) => h.hv20 !== null && h.trend !== null);
  const equityTotalCny = equityHoldings.reduce((s, h) => s + h.marketValueCny, 0);
  const pricedEquityTotalCny = pricedEquities.reduce((s, h) => s + h.marketValueCny, 0);

  let weightedHv20: number | null = null;
  let dailyVar95Cny: number | null = null;
  if (pricedEquityTotalCny > 0) {
    const hvSum = pricedEquities.reduce(
      (s, h) => s + (h.hv20 ?? 0) * h.marketValueCny,
      0
    );
    weightedHv20 = hvSum / pricedEquityTotalCny;
    dailyVar95Cny = equityTotalCny * ((weightedHv20 / 100) / Math.sqrt(252)) * 1.65;
  }

  let bullVal = 0;
  let bearVal = 0;
  let rangeVal = 0;
  for (const h of pricedEquities) {
    if (h.trend === 'bull') bullVal += h.marketValueCny;
    else if (h.trend === 'bear') bearVal += h.marketValueCny;
    else rangeVal += h.marketValueCny;
  }
  const trendDenom = Math.max(1, pricedEquityTotalCny);
  const bullSharePct = pricedEquityTotalCny > 0 ? (bullVal / trendDenom) * 100 : 0;
  const bearSharePct = pricedEquityTotalCny > 0 ? (bearVal / trendDenom) * 100 : 0;
  const rangeSharePct = pricedEquityTotalCny > 0 ? (rangeVal / trendDenom) * 100 : 0;

  let maxPos: PortfolioHealthInputHolding | null = null;
  for (const h of holdings) {
    if (!maxPos || h.marketValueCny > maxPos.marketValueCny) {
      maxPos = h;
    }
  }
  const maxPositionSymbol = maxPos ? maxPos.symbol : null;
  const maxPositionPct =
    maxPos && totalMarketCny > 0 ? (maxPos.marketValueCny / totalMarketCny) * 100 : 0;
  const optionSharePct =
    totalMarketCny > 0 ? (optionMarketCny / totalMarketCny) * 100 : 0;

  const riskDisclosures: PortfolioHealthRiskItem[] = [];
  const adjustments: PortfolioHealthAdjustment[] = [];
  let riskPoints = 0;

  if (holdings.length === 0) {
    return {
      overallLevel: 'healthy',
      overallLabel: '空仓待机',
      weightedHv20: null,
      dailyVar95Cny: null,
      bullSharePct: 0,
      bearSharePct: 0,
      rangeSharePct: 0,
      maxPositionSymbol: null,
      maxPositionPct: 0,
      optionSharePct: 0,
      riskDisclosures: [
        {
          severity: 'low',
          title: '当前账本为空仓状态',
          detail: `全局风险基准本金 ¥${Math.round(totalCapitalCny).toLocaleString('zh-CN')} 处于现金空仓状态，无市场下跌回撤风险。`,
        },
      ],
      adjustments: [
        {
          action: '从正股雷达筛选顺势标的',
          rationale: '可前往「正股雷达」查看均线多头排列且盈亏比大于 1.4:1 的标的，按以损定仓规则分批建仓。',
        },
      ],
    };
  }

  // 1. Volatility Risk
  if (weightedHv20 !== null) {
    if (weightedHv20 >= 42) {
      riskPoints += 2;
      riskDisclosures.push({
        severity: 'high',
        title: `正股组合高波动预警 (加权 HV20 ${weightedHv20.toFixed(1)}%)`,
        detail: `组合日均正常波动幅度较大，95% 置信度下正股单日不利波动 VaR 约 ¥${Math.round(dailyVar95Cny ?? 0).toLocaleString('zh-CN')}，遇财报或宏观突发利空易出现跳空回撤。`,
      });
    } else if (weightedHv20 >= 28) {
      riskPoints += 1;
      riskDisclosures.push({
        severity: 'medium',
        title: `正股波动率处于中高区间 (加权 HV20 ${weightedHv20.toFixed(1)}%)`,
        detail: `正股单日 95% 风险估值 (VaR) 约 ¥${Math.round(dailyVar95Cny ?? 0).toLocaleString('zh-CN')}，需防范连续震荡放大浮亏。`,
      });
    } else {
      riskDisclosures.push({
        severity: 'low',
        title: `正股波动率相对可控 (加权 HV20 ${weightedHv20.toFixed(1)}%)`,
        detail: `组合整体历史波动率较低，正股单日 95% VaR 约 ¥${Math.round(dailyVar95Cny ?? 0).toLocaleString('zh-CN')}，净值曲线回撤压力温和。`,
      });
    }
  }

  // 2. Bear-trend Holdings
  const bearHoldings = pricedEquities.filter((h) => h.trend === 'bear');
  if (bearHoldings.length > 0) {
    riskPoints += bearSharePct >= 30 ? 2 : 1;
    const names = bearHoldings.map((h) => h.symbol).join('、');
    riskDisclosures.push({
      severity: bearSharePct >= 30 ? 'high' : 'medium',
      title: `存在空头下行趋势持仓 (占正股市值 ${bearSharePct.toFixed(1)}%)`,
      detail: `${names} 当前处于 MA20 < MA60 空头排列下方，逆势持仓容易持续阴跌或反复触发止损。`,
    });

    const worstBear = bearHoldings.sort((a, b) => b.marketValueCny - a.marketValueCny)[0];
    adjustments.push({
      action: `压缩或对冲逆势仓位：${worstBear.symbol}`,
      market: worstBear.radarMarket,
      symbol: worstBear.radarSymbol,
      rationale: `${worstBear.symbol} 处于空头下行趋势${worstBear.pnlPct !== null ? `（当前浮盈 ${worstBear.pnlPct >= 0 ? '+' : ''}${worstBear.pnlPct.toFixed(1)}%）` : ''}，建议在「正股雷达」复核 ATR 硬止损线，跌破支撑优先减仓至半仓以下，避免死扛深套。`,
    });
  }

  // 3. High individual volatility holdings
  const highHvHoldings = pricedEquities
    .filter((h) => (h.hv20 ?? 0) >= 45)
    .sort((a, b) => (b.hv20 ?? 0) - (a.hv20 ?? 0));
  if (highHvHoldings.length > 0) {
    const topVol = highHvHoldings[0];
    adjustments.push({
      action: `降低高波动标的弹性敞口：${topVol.symbol}`,
      market: topVol.radarMarket,
      symbol: topVol.radarSymbol,
      rationale: `${topVol.symbol} 年化波动率高达 ${(topVol.hv20 ?? 0).toFixed(1)}%${topVol.hvRank !== null ? `（年内分位 ${topVol.hvRank.toFixed(0)}%）` : ''}，建议分批落袋部分浮盈或搭配低波动宽基 ETF（如 510300 / QQQ）平滑组合净值波动。`,
    });
  }

  // 4. Single Position / Market Concentration
  if (maxPositionSymbol && maxPositionPct > 40 && holdings.length > 1) {
    riskPoints += 1;
    riskDisclosures.push({
      severity: 'medium',
      title: `单一持仓集中度偏高 (${maxPositionSymbol} 占 ${maxPositionPct.toFixed(1)}%)`,
      detail: `单个标的高于总账本市值 40%，非系统性个股黑天鹅事件将直接主导整体账户盈亏。`,
    });
    adjustments.push({
      action: `分散单票集中度：${maxPositionSymbol}`,
      market: maxPos?.radarMarket,
      symbol: maxPos?.radarSymbol,
      rationale: `建议将单只标的权重逐步控制在组合 25%–35% 以内，避免单一公司突发利空拖累整体回撤。`,
    });
  }

  // 5. Options Exposure & Expiry Risk
  const urgentOptions = holdings.filter(
    (h) => h.isOption && h.daysLeft !== null && h.daysLeft <= 14
  );
  if (urgentOptions.length > 0) {
    riskPoints += 2;
    riskDisclosures.push({
      severity: 'high',
      title: `临近到期期权时间价值衰减风险 (${urgentOptions.length} 笔 ≤ 14 天)`,
      detail: `${urgentOptions.map((o) => `${o.symbol}(剩${o.daysLeft}天)`).join('、')} 正处于 Theta 加速衰减窗口，若正股横盘权利金可能快速归零。`,
    });
    adjustments.push({
      action: `及时平仓或移仓临期期权 (${urgentOptions[0].symbol})`,
      rationale: `若仍看好原方向，建议在美股盘前/盘中切换至剩余 30–60 天的远月合约（Roll Out），锁定剩余时间价值。`,
    });
  }

  if (optionSharePct > 15) {
    riskPoints += 1;
    riskDisclosures.push({
      severity: 'medium',
      title: `期权买方权利金占比偏高 (${optionSharePct.toFixed(1)}%)`,
      detail: `期权具备非线性杠杆及到期归零特征，建议组合内权利金总占用不超过总本金的 10%–15%。`,
    });
  }

  // 6. Capital Utilization & Bullish Alignment
  if (utilizationPct > 85) {
    riskPoints += 2;
    riskDisclosures.push({
      severity: 'high',
      title: `总资金仓位过重 (使用率 ${utilizationPct.toFixed(1)}%)`,
      detail: `账本持仓已接近或超过预设总本金 ¥${Math.round(totalCapitalCny).toLocaleString('zh-CN')}，缺乏缓冲现金应对极端回调或补仓机会。`,
    });
    adjustments.push({
      action: '预留 15%–25% 机动现金缓冲',
      rationale: '建议优先兑现处于震荡滞涨或高波动标的的部分利润，将仓位使用率回落至 75% 以下。',
    });
  } else if (utilizationPct < 30 && bullSharePct >= 60) {
    adjustments.push({
      action: '顺势适度提升多头核心仓位',
      rationale: `当前总仓位使用率仅 ${utilizationPct.toFixed(1)}%，且持仓中 ${bullSharePct.toFixed(0)}% 处于多头上升趋势，可在「正股雷达」回踩支撑位时按以损定仓规则适度加仓。`,
    });
  }

  if (adjustments.length === 0) {
    adjustments.push({
      action: '维持当前结构，严格执行移动止损',
      rationale: `当前组合波动率、多头趋势占比（${bullSharePct.toFixed(0)}%）与单一持仓分散度均处于合理区间，重点盯防已设定的 ATR 止损红线即可。`,
    });
  }

  const overallLevel: PortfolioHealthDiagnosis['overallLevel'] =
    riskPoints >= 4 ? 'alert' : riskPoints >= 2 ? 'caution' : 'healthy';
  const overallLabel =
    overallLevel === 'alert'
      ? '风险暴露偏高 · 建议尽快调仓'
      : overallLevel === 'caution'
        ? '局部存在隐患 · 建议适度优化'
        : '持仓结构健康 · 波动可控';

  return {
    overallLevel,
    overallLabel,
    weightedHv20,
    dailyVar95Cny,
    bullSharePct,
    bearSharePct,
    rangeSharePct,
    maxPositionSymbol,
    maxPositionPct,
    optionSharePct,
    riskDisclosures,
    adjustments,
  };
}

export function computeAtrAnomalyReport(
  indBars: IndicatorBar[],
  windowDays = 120,
  atrMultiplier = 2.0
): AtrAnomalyReport | null {
  const validPoints: AtrAnomalyPoint[] = [];

  for (let i = 0; i < indBars.length; i++) {
    const bar = indBars[i];
    if (bar.atr14 === null || bar.close <= 0) continue;
    const prevClose = i > 0 ? indBars[i - 1].close : bar.close;
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevClose),
      Math.abs(bar.low - prevClose)
    );
    validPoints.push({
      date: bar.date,
      close: bar.close,
      atr14: bar.atr14,
      atrPct: (bar.atr14 / bar.close) * 100,
      tr,
      trPct: (tr / bar.close) * 100,
    });
  }

  if (validPoints.length < 10) return null;

  const latest = validPoints[validPoints.length - 1];
  const baseline =
    validPoints.length > 20
      ? validPoints.slice(Math.max(0, validPoints.length - 1 - windowDays), validPoints.length - 1)
      : validPoints.slice(-windowDays);

  const sampleCount = baseline.length;
  const histMeanAtr =
    baseline.reduce((s, p) => s + p.atr14, 0) / Math.max(1, sampleCount);
  const histMeanAtrPct =
    baseline.reduce((s, p) => s + p.atrPct, 0) / Math.max(1, sampleCount);

  const variancePct =
    baseline.reduce((s, p) => s + (p.atrPct - histMeanAtrPct) ** 2, 0) /
    Math.max(1, sampleCount - 1);
  const histStdAtrPct = Math.sqrt(variancePct);

  const ratioToMean = histMeanAtrPct > 0 ? latest.atrPct / histMeanAtrPct : 1;
  const deviationPct = (ratioToMean - 1) * 100;
  const zScore =
    (latest.atrPct - histMeanAtrPct) / Math.max(histStdAtrPct, 0.08);
  const belowCount = baseline.filter((p) => p.atrPct <= latest.atrPct).length;
  const percentileRank = (belowCount / Math.max(1, sampleCount)) * 100;

  const latestTrToAtrRatio = latest.atr14 > 0 ? latest.tr / latest.atr14 : 1;

  let maxAtrPct = -Infinity;
  let maxAtrDate = latest.date;
  let minAtrPct = Infinity;
  const fullWindow = validPoints.slice(-Math.max(windowDays, 60));
  for (const pt of fullWindow) {
    if (pt.atrPct > maxAtrPct) {
      maxAtrPct = pt.atrPct;
      maxAtrDate = pt.date;
    }
    if (pt.atrPct < minAtrPct) {
      minAtrPct = pt.atrPct;
    }
  }

  const warningThresholdPct = histMeanAtrPct * 1.25;
  const extremeThresholdPct = histMeanAtrPct * 1.5;

  let level: AtrAnomalyLevel = 'normal';
  let levelLabel = '常态波动';
  let headline = '';
  let guidance = '';

  const devSign = deviationPct >= 0 ? '+' : '';
  const zSign = zScore >= 0 ? '+' : '';

  if (ratioToMean >= 1.5 || zScore >= 2.0 || latestTrToAtrRatio >= 2.2) {
    level = 'extreme';
    levelLabel = '高危波动异常';
    headline =
      latestTrToAtrRatio >= 2.2 && ratioToMean < 1.5
        ? `最新单日波幅 TR 达 14日 ATR 的 ${latestTrToAtrRatio.toFixed(2)} 倍，出现突发脉冲跳空冲击`
        : `当前 ATR 占价率 (${latest.atrPct.toFixed(2)}%) 较近 ${sampleCount} 日均值偏离 ${devSign}${deviationPct.toFixed(1)}% (${zSign}${zScore.toFixed(2)}σ)`;
    guidance = `真实波幅已显著脱离历史常态区间，追单或常规止损极易被日内巨震扫出；建议将单笔买入仓位缩减 30%–50%，或把止损带宽放宽至 ${(atrMultiplier + 0.5).toFixed(1)}×ATR 后重算股数。`;
  } else if (ratioToMean >= 1.25 || zScore >= 1.15 || latestTrToAtrRatio >= 1.75) {
    level = 'elevated';
    levelLabel = '波动扩张预警';
    headline =
      latestTrToAtrRatio >= 1.75 && ratioToMean < 1.25
        ? `单日真实波幅放大至 ATR14 的 ${latestTrToAtrRatio.toFixed(2)} 倍，短线振幅开始扩张`
        : `当前 ATR 占价率 (${latest.atrPct.toFixed(2)}%) 高于近 ${sampleCount} 日均值 ${devSign}${deviationPct.toFixed(1)}% (${zSign}${zScore.toFixed(2)}σ)`;
    guidance = `波动率正处于向上扩张阶段（分位 ${percentileRank.toFixed(0)}%），盘中回撤毛刺增多；建议分批低吸、避免重仓追涨，并检查硬止损位是否足以覆盖日内正常洗盘。`;
  } else if (ratioToMean <= 0.72 || zScore <= -1.25) {
    level = 'compressed';
    levelLabel = '低波蓄势收敛';
    headline = `当前 ATR 占价率 (${latest.atrPct.toFixed(2)}%) 低于近 ${sampleCount} 日均值 ${Math.abs(deviationPct).toFixed(1)}% (${zSign}${zScore.toFixed(2)}σ)`;
    guidance = `日均真实波幅已压缩至历史低位区间，通常对应方向选择前的窄幅蓄势期；可紧盯 20 日高低点突破，并防范变盘首日波幅骤然放大。`;
  } else {
    level = 'normal';
    levelLabel = '波动率常态';
    headline = `当前 ATR 占价率 (${latest.atrPct.toFixed(2)}%) 处于近 ${sampleCount} 日均值 ${histMeanAtrPct.toFixed(2)}% 的常态区间 (${devSign}${deviationPct.toFixed(1)}%)`;
    guidance = `标的日内振幅节奏平稳，未见异常脉冲或极端放量撕裂；可按默认 ${atrMultiplier}×ATR 止损纪律正常执行以损定仓。`;
  }

  return {
    windowDays,
    sampleCount,
    level,
    levelLabel,
    headline,
    guidance,
    currentAtr: latest.atr14,
    currentAtrPct: latest.atrPct,
    histMeanAtr,
    histMeanAtrPct,
    histStdAtrPct,
    ratioToMean,
    deviationPct,
    zScore,
    percentileRank,
    latestTr: latest.tr,
    latestTrPct: latest.trPct,
    latestTrToAtrRatio,
    maxAtrPct,
    maxAtrDate,
    minAtrPct,
    warningThresholdPct,
    extremeThresholdPct,
    series: validPoints.slice(-windowDays),
  };
}
