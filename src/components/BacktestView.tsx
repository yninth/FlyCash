import React, { useRef, useState } from 'react';
import { Link2, Play, Sparkles } from 'lucide-react';
import { runParameterGridSearch, runTrendBacktest } from '../lib/quant';
import type {
  BacktestGridRow,
  BacktestResult,
  GlobalRiskConfig,
  MarketType,
  OhlcvBar,
  StockHistoryResponse,
  ToastType,
} from '../types/trading';
import { EquityCurveChart } from './Charts';

interface BacktestViewProps {
  riskConfig: GlobalRiskConfig;
  radarMarket: MarketType;
  radarSymbol: string;
  onNotify: (type: ToastType, title: string, detail?: string) => void;
}

const MARKET_LABEL: Record<MarketType, string> = {
  US: '美股',
  HK: '港股',
  CN: 'A股',
};

export const BacktestView: React.FC<BacktestViewProps> = ({
  riskConfig,
  radarMarket,
  radarSymbol,
  onNotify,
}) => {
  const [market, setMarket] = useState<MarketType>(radarMarket || 'US');
  const [symbol, setSymbol] = useState(radarSymbol || 'QQQ');
  const [fastMa, setFastMa] = useState(20);
  const [slowMa, setSlowMa] = useState(60);
  const [atrMult, setAtrMult] = useState(riskConfig.atrMultiplier);
  const [feeBps, setFeeBps] = useState(10); // 0.10%
  const [years, setYears] = useState(3);

  const [loading, setLoading] = useState(false);
  const [gridLoading, setGridLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stockMeta, setStockMeta] = useState<{ name: string; currency: string } | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [gridRows, setGridRows] = useState<BacktestGridRow[]>([]);
  const cachedBarsRef = useRef<{ key: string; name: string; currency: string; bars: OhlcvBar[] } | null>(
    null
  );

  const fetchOrGetBars = async (mkt: MarketType, sym: string, yr: number) => {
    const cleanSym = sym.trim().toUpperCase();
    const cacheKey = `${mkt}:${cleanSym}:${yr}`;
    if (cachedBarsRef.current && cachedBarsRef.current.key === cacheKey) {
      return cachedBarsRef.current;
    }
    const days = yr * 365 + 120;
    const res = await fetch(
      `/api/stock?market=${encodeURIComponent(mkt)}&symbol=${encodeURIComponent(
        cleanSym
      )}&days=${days}`
    );
    const data = (await res.json()) as StockHistoryResponse & { error?: string };
    if (!res.ok) throw new Error(data.error || '行情拉取失败');
    const payload = {
      key: cacheKey,
      name: data.name,
      currency: data.currency,
      bars: data.bars,
    };
    cachedBarsRef.current = payload;
    return payload;
  };

  const runWithParams = async (
    nextFast: number,
    nextSlow: number,
    nextAtr: number,
    announce = true
  ) => {
    if (nextFast >= nextSlow) {
      setError('快线周期必须小于慢线周期。');
      onNotify('warning', '回测参数无效', '快线周期必须小于慢线周期');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await fetchOrGetBars(market, symbol, years);
      const bt = runTrendBacktest(payload.bars, {
        fastMa: nextFast,
        slowMa: nextSlow,
        atrMult: nextAtr,
        feeRate: feeBps / 10000,
      });

      setStockMeta({ name: payload.name, currency: payload.currency });
      setResult(bt);
      if (announce) {
        onNotify(
          'success',
          `${payload.name} 回测完成`,
          `策略累计收益 ${bt.metrics.totalReturnPct >= 0 ? '+' : ''}${bt.metrics.totalReturnPct.toFixed(1)}% · 最大回撤 ${bt.metrics.maxDrawdownPct.toFixed(1)}%`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '回测运行失败';
      setError(msg);
      onNotify('error', '回测运行失败', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRunBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    await runWithParams(fastMa, slowMa, atrMult, true);
  };

  const handleGridSearch = async () => {
    setGridLoading(true);
    setError(null);
    try {
      const payload = await fetchOrGetBars(market, symbol, years);
      setStockMeta({ name: payload.name, currency: payload.currency });
      const topRows = runParameterGridSearch(payload.bars, feeBps / 10000);
      setGridRows(topRows);
      if (topRows.length > 0) {
        onNotify(
          'success',
          `${payload.name} 参数网格寻优完成`,
          `最佳夏普组合：MA${topRows[0].fastMa}/${topRows[0].slowMa} · ${topRows[0].atrMult}×ATR`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '网格寻优失败';
      setError(msg);
      onNotify('error', '网格寻优失败', msg);
    } finally {
      setGridLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Parameters Bar */}
      <form
        onSubmit={handleRunBacktest}
        className="rounded-lg border border-slate-800 bg-[#0F172A] p-4 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              双均线趋势 + ATR 移动止损回测引擎
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              严格遵循无未来函数原则：收盘触发信号，次日开盘价撮合成交（天然兼容 A 股 T+1 制度）
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMarket(radarMarket);
                setSymbol(radarSymbol);
                setGridRows([]);
                onNotify('info', `已带入雷达标的：${MARKET_LABEL[radarMarket]} ${radarSymbol}`);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-sky-500/50 hover:text-sky-300 transition-colors whitespace-nowrap shrink-0"
            >
              <Link2 className="w-3.5 h-3.5" />
              带入雷达标的 ({MARKET_LABEL[radarMarket]} {radarSymbol})
            </button>
            <button
              type="button"
              onClick={handleGridSearch}
              disabled={gridLoading || loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {gridLoading ? '寻优计算中...' : '48组参数网格寻优'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">市场</label>
            <select
              value={market}
              onChange={(e) => {
                const m = e.target.value as MarketType;
                setMarket(m);
                setSymbol(m === 'US' ? 'QQQ' : m === 'HK' ? '0700' : '510300');
                setGridRows([]);
              }}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="US">美股</option>
              <option value="HK">港股</option>
              <option value="CN">A股</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">标的代码</label>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">快线周期 (日)</label>
            <input
              type="number"
              min={5}
              max={60}
              value={fastMa}
              onChange={(e) => setFastMa(Number(e.target.value) || 20)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">慢线周期 (日)</label>
            <input
              type="number"
              min={15}
              max={250}
              value={slowMa}
              onChange={(e) => setSlowMa(Number(e.target.value) || 60)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">ATR 追踪倍数</label>
            <input
              type="number"
              step={0.5}
              min={1}
              max={6}
              value={atrMult}
              onChange={(e) => setAtrMult(Number(e.target.value) || 2.5)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">回测周期 / 费率</label>
            <div className="flex gap-1.5">
              <select
                value={years}
                onChange={(e) => setYears(Number(e.target.value))}
                className="w-1/2 rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                <option value={2}>2年</option>
                <option value={3}>3年</option>
                <option value={5}>5年</option>
              </select>
              <input
                type="number"
                title="单边手续费+滑点 (bps, 10=0.1%)"
                value={feeBps}
                onChange={(e) => setFeeBps(Math.max(0, Number(e.target.value) || 0))}
                className="w-1/2 rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4" />
            {loading ? '计算中...' : '运行回测'}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-rose-900/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {gridRows.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-[#0F172A] overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {stockMeta?.name} ({symbol.toUpperCase()}) 参数网格寻优 Top 8（按夏普比率排序）
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                避免只测单一参数的盲区，点击“应用参数”即可立即生成完整净值曲线与成交明细
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                <tr>
                  <th className="py-2.5 px-4 font-medium">均线组合</th>
                  <th className="py-2.5 px-4 font-medium">ATR 止损倍数</th>
                  <th className="py-2.5 px-4 font-medium text-right">累计收益</th>
                  <th className="py-2.5 px-4 font-medium text-right">年化 CAGR</th>
                  <th className="py-2.5 px-4 font-medium text-right">最大回撤</th>
                  <th className="py-2.5 px-4 font-medium text-right">夏普比率</th>
                  <th className="py-2.5 px-4 font-medium text-right">胜率 (笔数)</th>
                  <th className="py-2.5 px-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
                {gridRows.map((row, idx) => (
                  <tr key={`${row.fastMa}-${row.slowMa}-${row.atrMult}`} className="hover:bg-slate-800/40">
                    <td className="py-2 px-4 text-slate-100 font-semibold">
                      {idx === 0 && <span className="text-amber-400 mr-1.5">#1</span>}
                      MA{row.fastMa} / MA{row.slowMa}
                    </td>
                    <td className="py-2 px-4 text-slate-300">{row.atrMult.toFixed(1)}×ATR</td>
                    <td
                      className={`py-2 px-4 text-right font-semibold ${
                        row.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {row.totalReturnPct >= 0 ? '+' : ''}
                      {row.totalReturnPct.toFixed(2)}%
                    </td>
                    <td className="py-2 px-4 text-right text-slate-200">
                      {row.cagrPct.toFixed(2)}%
                    </td>
                    <td className="py-2 px-4 text-right text-rose-400">
                      {row.maxDrawdownPct.toFixed(2)}%
                    </td>
                    <td className="py-2 px-4 text-right text-sky-300 font-semibold">
                      {row.sharpeRatio.toFixed(2)}
                    </td>
                    <td className="py-2 px-4 text-right text-slate-300">
                      {row.winRatePct.toFixed(0)}% ({row.closedTrades})
                    </td>
                    <td className="py-2 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setFastMa(row.fastMa);
                          setSlowMa(row.slowMa);
                          setAtrMult(row.atrMult);
                          runWithParams(row.fastMa, row.slowMa, row.atrMult, true);
                        }}
                        className="rounded border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-sans font-medium text-sky-300 hover:bg-sky-500/20 transition-colors whitespace-nowrap"
                      >
                        应用参数
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!result && !loading && !error && gridRows.length === 0 && (
        <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-10 text-center space-y-2">
          <div className="text-sm font-medium text-slate-200">
            选择标的代码与均线参数，点击“运行回测”或“48组参数网格寻优”
          </div>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            系统将拉取真实历史前复权 K 线，对比趋势追踪策略与买入持有的收益、最大回撤与夏普比率。
          </p>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="text-sm font-semibold text-slate-100">
                {stockMeta?.name} ({symbol.toUpperCase()}) 回测绩效体检
              </div>
              <div className="text-xs text-slate-400 font-mono tabular-nums">
                区间 {result.equityCurve[0]?.date} 至{' '}
                {result.equityCurve[result.equityCurve.length - 1]?.date} · 闭环交易{' '}
                {result.metrics.closedTrades} 笔
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 border-b border-slate-800 pb-4">
              <div className="pr-4 py-1">
                <div className="text-xs text-slate-400">策略累计收益</div>
                <div
                  className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
                    result.metrics.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {result.metrics.totalReturnPct >= 0 ? '+' : ''}
                  {result.metrics.totalReturnPct.toFixed(2)}%
                </div>
              </div>

              <div className="sm:pl-4 pr-4 py-1">
                <div className="text-xs text-slate-400">年化收益 CAGR</div>
                <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-100">
                  {result.metrics.cagrPct.toFixed(2)}%
                </div>
              </div>

              <div className="sm:pl-4 pr-4 py-1">
                <div className="text-xs text-slate-400">最大回撤</div>
                <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-rose-400">
                  {result.metrics.maxDrawdownPct.toFixed(2)}%
                </div>
              </div>

              <div className="sm:pl-4 pr-4 py-1">
                <div className="text-xs text-slate-400">夏普 / 卡玛比率</div>
                <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-sky-400">
                  {result.metrics.sharpeRatio.toFixed(2)}
                  <span className="text-xs text-slate-400 ml-1.5">
                    / {result.metrics.calmarRatio.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="sm:pl-4 pr-4 py-1">
                <div className="text-xs text-slate-400">胜率 / 盈亏比</div>
                <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-100">
                  {result.metrics.winRatePct.toFixed(1)}%
                  <span className="text-xs text-slate-400 ml-1.5">
                    / {result.metrics.profitFactor.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="sm:pl-4 py-1">
                <div className="text-xs text-slate-400">同期买入持有</div>
                <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-300">
                  {result.metrics.benchmarkReturnPct >= 0 ? '+' : ''}
                  {result.metrics.benchmarkReturnPct.toFixed(2)}%
                </div>
              </div>
            </div>

            <EquityCurveChart points={result.equityCurve} />
          </div>

          {/* Trade Log Table */}
          <div className="rounded-lg border border-slate-800 bg-[#0F172A] overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800 text-sm font-semibold text-slate-100">
              历史模拟成交明细（共 {result.trades.length} 条记录）
            </div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">成交日期</th>
                    <th className="py-2.5 px-4 font-medium">方向</th>
                    <th className="py-2.5 px-4 font-medium text-right">次日开盘成交价</th>
                    <th className="py-2.5 px-4 font-medium text-right">单笔盈亏</th>
                    <th className="py-2.5 px-4 font-medium">触发规则</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {result.trades.map((t, idx) => (
                    <tr key={`${t.date}-${idx}`} className="hover:bg-slate-800/40">
                      <td className="py-2 px-4 font-mono tabular-nums text-slate-300">
                        {t.date}
                      </td>
                      <td className="py-2 px-4">
                        <span
                          className={
                            t.action === '买入'
                              ? 'text-emerald-400 font-medium'
                              : 'text-amber-400 font-medium'
                          }
                        >
                          {t.action}
                        </span>
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-100">
                        {t.price.toFixed(2)}
                      </td>
                      <td
                        className={`py-2 px-4 text-right font-mono tabular-nums ${
                          t.pnlPct === undefined
                            ? 'text-slate-500'
                            : t.pnlPct >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {t.pnlPct === undefined
                          ? '—'
                          : `${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%`}
                      </td>
                      <td className="py-2 px-4 text-slate-400">{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
