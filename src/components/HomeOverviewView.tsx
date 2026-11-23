import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookmarkPlus,
  CheckCircle2,
  LineChart,
  MinusCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  calcAtrPosition,
  calcDaysLeft,
  classifyTrend,
  computeIndicators,
  computeStockForecast,
  formatMoney,
} from '../lib/quant';
import type { AlertPriceQuote } from '../lib/usePriceAlertMonitor';
import type {
  BuyVerdictType,
  CurrencyType,
  GlobalRiskConfig,
  LedgerEntry,
  MarketType,
  StockHistoryResponse,
  ToastType,
  WatchlistItemSpec,
  WatchlistScanItem,
} from '../types/trading';

interface HomeOverviewViewProps {
  riskConfig: GlobalRiskConfig;
  usdCny: number;
  hkdCny: number;
  selectedMarket: MarketType;
  selectedSymbol: string;
  watchlist: WatchlistItemSpec[];
  ledgerEntries: LedgerEntry[];
  onSelectSymbol: (market: MarketType, symbol: string) => void;
  onAddWatchlist: (item: WatchlistItemSpec) => void;
  onRemoveWatchlist: (market: MarketType, symbol: string) => void;
  onAddToLedger: (entry: Omit<LedgerEntry, 'id' | 'createdAt'>) => void;
  onOpenStrategyRadar: (market: MarketType, symbol: string) => void;
  onOpenStrategyOptions: (symbol: string) => void;
  onOpenLedger: () => void;
  onEvaluateAlerts?: (quotes: AlertPriceQuote[]) => void;
  onNotify: (type: ToastType, title: string, detail?: string) => void;
}

const MARKET_PRESETS: Record<
  MarketType,
  { label: string; codes: string[]; defaultLot: number }
> = {
  US: { label: '美股', codes: ['NVDA', 'QQQ', 'AAPL', 'TSLA', 'MSFT'], defaultLot: 1 },
  HK: { label: '港股', codes: ['0700', '9988', '3690', '1810'], defaultLot: 100 },
  CN: { label: 'A股', codes: ['510300', '518880', '600519', '300750'], defaultLot: 100 },
};

function verdictShortLabel(v: BuyVerdictType): string {
  if (v === 'buy') return '建议买入';
  if (v === 'pullback') return '回踩低吸';
  if (v === 'avoid') return '不建议买';
  return '震荡观望';
}

function verdictTextColor(v: BuyVerdictType): string {
  if (v === 'buy') return 'text-emerald-400';
  if (v === 'pullback') return 'text-sky-300';
  if (v === 'avoid') return 'text-rose-400';
  return 'text-amber-400';
}

function toRadarLookup(
  mkt: LedgerEntry['market'],
  rawSymbol: string
): { market: MarketType; symbol: string } | null {
  const clean = rawSymbol.trim().toUpperCase().replace(/\.(HK|SH|SZ|SS|US)$/i, '');
  if (!clean) return null;
  if (mkt === 'A股') return { market: 'CN', symbol: clean };
  if (mkt === '港股') return { market: 'HK', symbol: clean };
  if (mkt === '美股') return { market: 'US', symbol: clean };
  return null;
}

function currencySymbolOf(c: CurrencyType): string {
  return c === 'CNY' ? '¥' : c === 'HKD' ? 'HK$' : '$';
}

function formatMarketStateShort(state?: string): string {
  switch (state) {
    case 'PRE':
      return '美股盘前交易中';
    case 'REGULAR':
      return '美股盘中交易中';
    case 'POST':
      return '美股盘后交易中';
    case 'PREPRE':
      return '盘前未开';
    default:
      return '延伸时段参考';
  }
}

export const HomeOverviewView: React.FC<HomeOverviewViewProps> = ({
  riskConfig,
  usdCny,
  hkdCny,
  selectedMarket,
  selectedSymbol,
  watchlist,
  ledgerEntries,
  onSelectSymbol,
  onAddWatchlist,
  onRemoveWatchlist,
  onAddToLedger,
  onOpenStrategyRadar,
  onOpenStrategyOptions,
  onOpenLedger,
  onEvaluateAlerts,
  onNotify,
}) => {
  const [addMarket, setAddMarket] = useState<MarketType>('US');
  const [addSymbol, setAddSymbol] = useState('');

  const [queryMarket, setQueryMarket] = useState<MarketType>(selectedMarket);
  const [querySymbol, setQuerySymbol] = useState<string>(selectedSymbol);
  const [queryLotSize, setQueryLotSize] = useState<number>(selectedMarket === 'US' ? 1 : 100);

  const [batchLoading, setBatchLoading] = useState(false);
  const [scanRows, setScanRows] = useState<WatchlistScanItem[]>([]);
  const [liveHoldingsMap, setLiveHoldingsMap] = useState<
    Record<string, { price: number; changePct: number }>
  >({});

  const [quickStock, setQuickStock] = useState<StockHistoryResponse | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  const quickSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setQueryMarket(selectedMarket);
    setQuerySymbol(selectedSymbol);
    setQueryLotSize(selectedMarket === 'US' ? 1 : 100);
  }, [selectedMarket, selectedSymbol]);

  const combinedTargets = useMemo(() => {
    const map = new Map<string, { market: MarketType; symbol: string }>();
    for (const w of watchlist) {
      map.set(`${w.market}:${w.symbol}`, { market: w.market, symbol: w.symbol });
    }
    for (const item of ledgerEntries) {
      const target = toRadarLookup(item.market, item.symbol);
      if (target) {
        map.set(`${target.market}:${target.symbol}`, target);
      }
    }
    return Array.from(map.values());
  }, [watchlist, ledgerEntries]);

  const syncBatchQuotes = useCallback(
    async (announce = false, forceRefresh = false) => {
      if (combinedTargets.length === 0) {
        setScanRows([]);
        setLiveHoldingsMap({});
        return;
      }
      setBatchLoading(true);
      try {
        const res = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: combinedTargets, refresh: forceRefresh }),
        });
        if (!res.ok) throw new Error('行情同步失败');
        const json = (await res.json()) as {
          results: Array<{
            market: MarketType;
            symbol: string;
            ok: boolean;
            data?: StockHistoryResponse;
            error?: string;
          }>;
        };

        const dataByKey = new Map<
          string,
          { ok: boolean; data?: StockHistoryResponse; error?: string }
        >();
        const nextHoldings: Record<string, { price: number; changePct: number }> = {};
        const alertQuotes: AlertPriceQuote[] = [];

        for (const r of json.results || []) {
          const mktKey = r.market ?? r.data?.market ?? '';
          const symKey = r.symbol ?? r.data?.symbol ?? '';
          const key = `${mktKey}:${symKey}`;
          dataByKey.set(key, r);
          if (r.ok && r.data && r.data.bars.length > 0) {
            const d = r.data;
            const bars = d.bars;
            const last = bars[bars.length - 1];
            const prev = bars[bars.length - 2] || last;
            const ext = d.extendedQuote;
            const livePrice =
              d.market === 'US' && ext
                ? ext.preMarketPrice ?? ext.postMarketPrice ?? ext.regularPrice ?? last.close
                : last.close;
            const changePct =
              d.market === 'US' && ext?.regularChangePct != null
                ? ext.regularChangePct
                : prev.close > 0
                  ? ((last.close - prev.close) / prev.close) * 100
                  : 0;
            nextHoldings[key] = { price: livePrice, changePct };
            alertQuotes.push({
              market: d.market,
              symbol: d.symbol,
              name: d.name,
              currency: d.currency,
              price: livePrice,
            });
          }
        }

        setLiveHoldingsMap(nextHoldings);
        if (onEvaluateAlerts && alertQuotes.length > 0) {
          onEvaluateAlerts(alertQuotes);
        }

        const nextRows: WatchlistScanItem[] = watchlist.map((w) => {
          const match = dataByKey.get(`${w.market}:${w.symbol}`);
          if (!match || !match.ok || !match.data || match.data.bars.length === 0) {
            return {
              market: w.market,
              symbol: w.symbol,
              name: w.symbol,
              currency: w.market === 'CN' ? 'CNY' : w.market === 'HK' ? 'HKD' : 'USD',
              price: 0,
              changePct: 0,
              trend: 'range',
              atr14: 0,
              hv20: 0,
              hvRank: null,
              suggestedShares: 0,
              stopPrice: 0,
              weightPct: 0,
              buyVerdict: 'wait',
              buyVerdictLabel: '待加载',
              error: match?.error || '暂无行情',
            };
          }
          const d = match.data;
          const ind = computeIndicators(d.bars);
          const last = ind[ind.length - 1];
          const prev = ind[ind.length - 2] || last;
          const ext = d.extendedQuote;
          const refPrice =
            d.market === 'US' && ext
              ? ext.preMarketPrice ?? ext.postMarketPrice ?? ext.regularPrice ?? last.close
              : last.close;
          const fx = d.currency === 'CNY' ? 1 : d.currency === 'HKD' ? hkdCny : usdCny;
          const pos = calcAtrPosition({
            totalCapitalCny: riskConfig.totalCapitalCny,
            riskPct: riskConfig.stockRiskPct,
            priceLocal: refPrice,
            atrLocal: last.atr14 ?? refPrice * 0.03,
            atrMultiplier: riskConfig.atrMultiplier,
            fxToCny: fx,
            lotSize: w.lotSize,
          });
          const quickFc = computeStockForecast(ind, {
            horizonDays: 20,
            mode: 'momentum',
            atrMultiplier: riskConfig.atrMultiplier,
          });
          return {
            market: w.market,
            symbol: w.symbol,
            name: d.name,
            currency: d.currency,
            price: last.close,
            changePct: prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
            trend: classifyTrend(last),
            atr14: last.atr14 ?? 0,
            hv20: last.hv20 ?? 0,
            hvRank: last.hvRank ?? null,
            suggestedShares: pos.shares,
            stopPrice: pos.stopPrice,
            weightPct: pos.weightPct,
            buyVerdict: quickFc.buyDecision.verdict,
            buyVerdictLabel: quickFc.buyDecision.verdictLabel,
            extendedQuote: d.extendedQuote,
          };
        });

        setScanRows(nextRows);
        if (announce) {
          onNotify('success', '已刷新股票行情与持仓估值', `同步 ${alertQuotes.length} 只标的`);
        }
      } catch (err) {
        if (announce) {
          onNotify('error', '首页行情刷新失败', err instanceof Error ? err.message : '');
        }
      } finally {
        setBatchLoading(false);
      }
    },
    [combinedTargets, watchlist, riskConfig, usdCny, hkdCny, onEvaluateAlerts, onNotify]
  );

  useEffect(() => {
    syncBatchQuotes(false, false);
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        syncBatchQuotes(false, false);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [syncBatchQuotes]);

  const loadQuickStock = useCallback(
    async (mkt: MarketType, sym: string, announce = false, forceRefresh = false) => {
      const clean = sym.trim().toUpperCase();
      if (!clean) return;
      setQuickLoading(true);
      setQuickError(null);
      try {
        const res = await fetch(
          `/api/stock?market=${encodeURIComponent(mkt)}&symbol=${encodeURIComponent(
            clean
          )}&days=400${forceRefresh ? '&refresh=1' : ''}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '标的诊断失败');
        const typed = data as StockHistoryResponse;
        setQuickStock(typed);

        if (onEvaluateAlerts && typed.bars.length > 0) {
          const ext = typed.extendedQuote;
          const livePrice =
            typed.market === 'US' && ext
              ? ext.preMarketPrice ??
                ext.postMarketPrice ??
                ext.regularPrice ??
                typed.bars[typed.bars.length - 1].close
              : typed.bars[typed.bars.length - 1].close;
          onEvaluateAlerts([
            {
              market: typed.market,
              symbol: typed.symbol,
              name: typed.name,
              currency: typed.currency,
              price: livePrice,
            },
          ]);
        }

        if (announce) {
          onNotify('success', `已完成 ${typed.name} (${typed.symbol}) 买入诊断`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '拉取行情失败';
        setQuickError(msg);
        if (announce) onNotify('error', '买入诊断失败', msg);
      } finally {
        setQuickLoading(false);
      }
    },
    [onEvaluateAlerts, onNotify]
  );

  useEffect(() => {
    loadQuickStock(selectedMarket, selectedSymbol, false, false);
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        loadQuickStock(selectedMarket, selectedSymbol, false, false);
      }
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [selectedMarket, selectedSymbol, loadQuickStock]);

  const holdingsSummary = useMemo(() => {
    const fxOf = (ccy: CurrencyType) =>
      ccy === 'CNY' ? 1 : ccy === 'HKD' ? hkdCny : usdCny;

    let totalCostCny = 0;
    let totalMarketCny = 0;
    let totalPnlCny = 0;
    let pricedCostCny = 0;
    let expiringCount = 0;

    const items = ledgerEntries.map((entry) => {
      const mult = entry.market.includes('期权') ? 100 : 1;
      const fx = fxOf(entry.currency);
      const costCny = entry.quantity * entry.costPrice * mult * fx;
      totalCostCny += costCny;

      const lookup = toRadarLookup(entry.market, entry.symbol);
      const quote = lookup ? liveHoldingsMap[`${lookup.market}:${lookup.symbol}`] : undefined;
      const marketCny = quote ? entry.quantity * quote.price * mult * fx : costCny;
      const pnlCny = quote ? marketCny - costCny : null;
      const pnlPct =
        quote && entry.costPrice > 0
          ? ((quote.price - entry.costPrice) / entry.costPrice) * 100
          : null;

      totalMarketCny += marketCny;
      if (pnlCny !== null) {
        totalPnlCny += pnlCny;
        pricedCostCny += costCny;
      }

      const daysLeft = entry.expiryDate ? calcDaysLeft(entry.expiryDate) : null;
      if (daysLeft !== null && daysLeft <= 14) expiringCount++;

      return {
        ...entry,
        lookup,
        livePrice: quote?.price ?? null,
        marketCny,
        pnlCny,
        pnlPct,
        daysLeft,
      };
    });

    const totalPnlPct = totalCostCny > 0 ? (totalPnlCny / totalCostCny) * 100 : 0;

    return {
      items,
      totalCostCny,
      totalMarketCny,
      totalPnlCny,
      totalPnlPct,
      hasLivePrices: pricedCostCny > 0,
      expiringCount,
    };
  }, [ledgerEntries, liveHoldingsMap, usdCny, hkdCny]);

  const quickAnalysis = useMemo(() => {
    if (!quickStock || quickStock.bars.length === 0) return null;
    const enriched = computeIndicators(quickStock.bars);
    const last = enriched[enriched.length - 1];
    const prev = enriched[enriched.length - 2] || last;
    const ext = quickStock.extendedQuote;
    const regularPrice = ext?.regularPrice ?? last.close;
    const changePct =
      ext?.regularChangePct != null
        ? ext.regularChangePct
        : prev.close > 0
          ? ((last.close - prev.close) / prev.close) * 100
          : 0;

    let extPrice: number | null = null;
    let extLabel = '';
    if (quickStock.market === 'US' && ext) {
      if (ext.preMarketPrice != null) {
        extPrice = ext.preMarketPrice;
        extLabel = '盘前';
      } else if (ext.postMarketPrice != null) {
        extPrice = ext.postMarketPrice;
        extLabel = '盘后';
      }
    }

    const sizingPrice = extPrice ?? regularPrice;
    const fx =
      quickStock.currency === 'CNY' ? 1 : quickStock.currency === 'HKD' ? hkdCny : usdCny;
    const position = calcAtrPosition({
      totalCapitalCny: riskConfig.totalCapitalCny,
      riskPct: riskConfig.stockRiskPct,
      priceLocal: sizingPrice,
      atrLocal: last.atr14 ?? sizingPrice * 0.03,
      atrMultiplier: riskConfig.atrMultiplier,
      fxToCny: fx,
      lotSize: queryLotSize,
    });
    const forecast = computeStockForecast(enriched, {
      horizonDays: 20,
      mode: 'momentum',
      atrMultiplier: riskConfig.atrMultiplier,
    });
    const trend = classifyTrend(last);

    return {
      last,
      ext,
      extPrice,
      extLabel,
      regularPrice,
      changePct,
      sizingPrice,
      position,
      forecast,
      trend,
      currSym: currencySymbolOf(quickStock.currency),
    };
  }, [quickStock, queryLotSize, riskConfig, usdCny, hkdCny]);

  const handleQuickQuerySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = querySymbol.trim().toUpperCase();
    if (!clean) {
      onNotify('warning', '请输入要诊断的股票代码');
      return;
    }
    if (queryMarket === selectedMarket && clean === selectedSymbol) {
      loadQuickStock(queryMarket, clean, true, true);
    } else {
      onSelectSymbol(queryMarket, clean);
    }
  };

  const handleInspectFromLeft = (mkt: MarketType, sym: string) => {
    setQueryMarket(mkt);
    setQuerySymbol(sym);
    setQueryLotSize(mkt === 'US' ? 1 : 100);
    onSelectSymbol(mkt, sym);
    if (window.innerWidth < 1280) {
      quickSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const handleQuickAddWatch = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = addSymbol.trim().toUpperCase();
    if (!clean) {
      onNotify('warning', '请输入要添加的自选代码');
      return;
    }
    if (watchlist.some((w) => w.market === addMarket && w.symbol === clean)) {
      onNotify('info', `${clean} 已在股票信息列表中`);
      return;
    }
    onAddWatchlist({
      market: addMarket,
      symbol: clean,
      lotSize: addMarket === 'US' ? 1 : 100,
    });
    setAddSymbol('');
  };

  const handleLogQuickToLedger = () => {
    if (!quickStock || !quickAnalysis) return;
    const qty =
      quickAnalysis.position.shares > 0 ? quickAnalysis.position.shares : queryLotSize;
    const ledgerMkt: LedgerEntry['market'] =
      quickStock.market === 'CN' ? 'A股' : quickStock.market === 'HK' ? '港股' : '美股';
    onAddToLedger({
      market: ledgerMkt,
      symbol: quickStock.symbol,
      currency: quickStock.currency,
      quantity: qty,
      costPrice: Number(quickAnalysis.sizingPrice.toFixed(2)),
      expiryDate: '',
      note: `首页快速定仓 · 止损 ${quickAnalysis.currSym}${quickAnalysis.position.stopPrice.toFixed(2)}`,
    });
    onNotify(
      'success',
      `已按建议仓位记入账本：${quickStock.symbol}`,
      `${qty.toLocaleString()} 股 · 参考价 ${quickAnalysis.currSym}${quickAnalysis.sizingPrice.toFixed(2)}`
    );
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* LEFT 5 COLS: 1. 股票信息 + 2. 持仓信息 */}
      <div className="xl:col-span-5 space-y-5">
        {/* 1. 股票信息（三地自选实时行情） */}
        <section className="rounded-lg border border-slate-800 bg-[#0F172A] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                股票信息 · 三地自选行情
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                点选任意股票立即在右侧诊断能否买入
              </p>
            </div>
            <button
              type="button"
              onClick={() => syncBatchQuotes(true, true)}
              disabled={batchLoading}
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200 hover:border-slate-600 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3 h-3 ${batchLoading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          <form
            onSubmit={handleQuickAddWatch}
            className="px-4 py-2 border-b border-slate-800 bg-slate-900/40 flex items-center gap-2"
          >
            <select
              value={addMarket}
              onChange={(e) => setAddMarket(e.target.value as MarketType)}
              aria-label="自选市场"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="US">美股</option>
              <option value="HK">港股</option>
              <option value="CN">A股</option>
            </select>
            <input
              value={addSymbol}
              onChange={(e) => setAddSymbol(e.target.value)}
              placeholder="加自选代码如 TSLA / 0700"
              className="flex-1 min-w-0 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200 hover:border-sky-500/50 hover:text-sky-300 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3 h-3" />
              加入
            </button>
          </form>

          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-900/50 text-slate-400 sticky top-0">
                <tr>
                  <th className="py-2 px-4 font-medium">标的</th>
                  <th className="py-2 px-2 font-medium text-right">现价</th>
                  <th className="py-2 px-2 font-medium text-right">涨跌</th>
                  <th className="py-2 px-2 font-medium">买入信号</th>
                  <th className="py-2 px-3 font-medium text-right">删</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {scanRows.length === 0 && batchLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="py-2.5 px-4">
                        <div className="h-4 rounded bg-slate-800/60 animate-pulse" />
                      </td>
                    </tr>
                  ))
                ) : scanRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      暂无自选股票，请在上方输入代码添加。
                    </td>
                  </tr>
                ) : (
                  scanRows.map((row) => {
                    const sym = currencySymbolOf(row.currency);
                    const isSelected =
                      row.market === selectedMarket && row.symbol === selectedSymbol;
                    return (
                      <tr
                        key={`${row.market}-${row.symbol}`}
                        onClick={() => handleInspectFromLeft(row.market, row.symbol)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-sky-500/10' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2 px-4">
                          <div className="flex items-center gap-1.5 font-mono">
                            <span className="text-[10px] text-slate-400">
                              {MARKET_PRESETS[row.market].label}
                            </span>
                            <span className="font-semibold text-slate-100">{row.symbol}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate max-w-[115px]">
                            {row.error ? (
                              <span className="text-rose-400">{row.error}</span>
                            ) : (
                              row.name
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-100">
                          {row.error ? (
                            '—'
                          ) : (
                            <div>
                              <div>{`${sym}${row.price.toFixed(2)}`}</div>
                              {row.market === 'US' && row.extendedQuote?.preMarketPrice != null && (
                                <div className="text-[10px] text-sky-300">
                                  盘前 ${row.extendedQuote.preMarketPrice.toFixed(2)}
                                </div>
                              )}
                              {row.market === 'US' &&
                                row.extendedQuote?.preMarketPrice == null &&
                                row.extendedQuote?.postMarketPrice != null && (
                                  <div className="text-[10px] text-amber-300">
                                    盘后 ${row.extendedQuote.postMarketPrice.toFixed(2)}
                                  </div>
                                )}
                            </div>
                          )}
                        </td>
                        <td
                          className={`py-2 px-2 text-right font-mono tabular-nums ${
                            row.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {row.error
                            ? '—'
                            : `${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%`}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          {row.error ? (
                            '—'
                          ) : (
                            <div>
                              <div className={`font-medium ${verdictTextColor(row.buyVerdict)}`}>
                                {verdictShortLabel(row.buyVerdict)}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                {row.trend === 'bull'
                                  ? '多头趋势'
                                  : row.trend === 'bear'
                                    ? '空头趋势'
                                    : '震荡'}
                              </div>
                            </div>
                          )}
                        </td>
                        <td
                          className="py-2 px-3 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            title="移出自选"
                            onClick={() => onRemoveWatchlist(row.market, row.symbol)}
                            className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 2. 持仓信息（我的账本概览） */}
        <section className="rounded-lg border border-slate-800 bg-[#0F172A] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                持仓信息 · 我的账本
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5 font-mono tabular-nums">
                {holdingsSummary.items.length} 笔持仓 · USD/CNY {usdCny.toFixed(2)}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenLedger}
              className="inline-flex items-center gap-1 text-xs font-medium text-sky-300 hover:text-sky-200 whitespace-nowrap shrink-0"
            >
              查看收益与账本
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 divide-x divide-slate-800 border-b border-slate-800 px-4 py-3">
            <div className="pr-3">
              <div className="text-[11px] text-slate-400">当前总市值 (CNY)</div>
              <div className="mt-0.5 text-lg font-semibold font-mono tabular-nums text-slate-100">
                {formatMoney(holdingsSummary.totalMarketCny)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                成本 {formatMoney(holdingsSummary.totalCostCny)}
              </div>
            </div>

            <div className="pl-3">
              <div className="text-[11px] text-slate-400">总盈亏预估 (CNY)</div>
              <div
                className={`mt-0.5 text-lg font-semibold font-mono tabular-nums ${
                  !holdingsSummary.hasLivePrices
                    ? 'text-slate-400'
                    : holdingsSummary.totalPnlCny >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                }`}
              >
                {holdingsSummary.hasLivePrices
                  ? `${holdingsSummary.totalPnlCny >= 0 ? '+' : ''}${formatMoney(
                      holdingsSummary.totalPnlCny
                    )}`
                  : '同步中'}
              </div>
              <div className="text-[11px] font-mono tabular-nums">
                {holdingsSummary.hasLivePrices ? (
                  <span
                    className={
                      holdingsSummary.totalPnlCny >= 0 ? 'text-emerald-400/90' : 'text-rose-400/90'
                    }
                  >
                    收益率 {holdingsSummary.totalPnlPct >= 0 ? '+' : ''}
                    {holdingsSummary.totalPnlPct.toFixed(2)}%
                  </span>
                ) : (
                  <span className="text-slate-500">正股估值中</span>
                )}
              </div>
            </div>
          </div>

          {holdingsSummary.expiringCount > 0 && (
            <div className="px-4 py-1.5 border-b border-slate-800 bg-amber-950/25 flex items-center justify-between text-[11px] text-amber-300">
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {holdingsSummary.expiringCount} 笔期权 ≤ 14 天到期
              </span>
              <button
                type="button"
                onClick={onOpenLedger}
                className="underline underline-offset-2 whitespace-nowrap shrink-0"
              >
                前往处理
              </button>
            </div>
          )}

          <div className="divide-y divide-slate-800/80 max-h-[210px] overflow-y-auto">
            {holdingsSummary.items.length === 0 ? (
              <div className="py-6 px-4 text-center text-xs text-slate-400">
                当前账本暂无持仓，可在右侧诊断后一键记入。
              </div>
            ) : (
              holdingsSummary.items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    if (item.lookup) {
                      handleInspectFromLeft(item.lookup.market, item.lookup.symbol);
                    }
                  }}
                  className={`px-4 py-2 flex items-center justify-between gap-2 text-xs ${
                    item.lookup ? 'cursor-pointer hover:bg-slate-800/40' : ''
                  } transition-colors`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-semibold text-slate-100">
                        {item.symbol}
                      </span>
                      <span className="text-[11px] text-slate-400">{item.market}</span>
                      {item.daysLeft !== null && item.daysLeft <= 14 && (
                        <span className="text-[10px] font-mono text-amber-300">
                          剩{item.daysLeft}天
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {item.quantity.toLocaleString()}{' '}
                      {item.market.includes('期权') ? '张' : '股'} · 成本{' '}
                      {currencySymbolOf(item.currency)}
                      {item.costPrice.toFixed(2)}
                    </div>
                  </div>

                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div className="text-slate-100 font-medium">
                      {formatMoney(item.marketCny)}
                    </div>
                    {item.pnlCny !== null && item.pnlPct !== null ? (
                      <div
                        className={`text-[11px] ${
                          item.pnlCny >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {item.pnlCny >= 0 ? '+' : ''}
                        {formatMoney(item.pnlCny)} ({item.pnlPct >= 0 ? '+' : ''}
                        {item.pnlPct.toFixed(1)}%)
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500">按成本计</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* RIGHT 7 COLS: 3. 快速股票可否买入判断入口 (Sticky Focus Panel) */}
      <section
        ref={quickSectionRef}
        className="xl:col-span-7 xl:sticky xl:top-4 rounded-lg border border-slate-800 bg-[#0F172A] p-5 space-y-5"
      >
        <div className="space-y-3 border-b border-slate-800 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                快速股票可否买入判断入口
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                输入任意代码或点选左侧股票/持仓，即时生成买入结论、参考点位与以损定仓建议
              </p>
            </div>
          </div>

          <form onSubmit={handleQuickQuerySubmit} className="flex flex-wrap items-end gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">市场</label>
              <div className="flex items-center rounded-md bg-slate-900 p-0.5 border border-slate-800 text-xs">
                {(['US', 'HK', 'CN'] as MarketType[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setQueryMarket(m);
                      setQuerySymbol(MARKET_PRESETS[m].codes[0]);
                      setQueryLotSize(MARKET_PRESETS[m].defaultLot);
                    }}
                    className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                      queryMarket === m
                        ? 'bg-sky-500/20 text-sky-300 font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {MARKET_PRESETS[m].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-w-[140px]">
              <label htmlFor="home-quick-symbol" className="block text-[11px] text-slate-400 mb-1">
                标的代码
              </label>
              <input
                id="home-quick-symbol"
                value={querySymbol}
                onChange={(e) => setQuerySymbol(e.target.value)}
                placeholder="NVDA / 0700 / 510300"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="home-quick-lot" className="block text-[11px] text-slate-400 mb-1">
                每手股数
              </label>
              <input
                id="home-quick-lot"
                type="number"
                min={1}
                value={queryLotSize}
                onChange={(e) => setQueryLotSize(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={quickLoading}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
              {quickLoading ? '诊断中...' : '判断可否买入'}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500 mr-1">快捷:</span>
            {MARKET_PRESETS[queryMarket].codes.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  setQuerySymbol(code);
                  onSelectSymbol(queryMarket, code);
                }}
                className={`px-2 py-0.5 rounded border font-mono transition-colors whitespace-nowrap shrink-0 ${
                  selectedMarket === queryMarket && selectedSymbol === code
                    ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                    : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
                }`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>

        {quickError && (
          <div className="rounded-md border border-rose-900/70 bg-rose-950/30 px-4 py-3 text-xs text-rose-300">
            {quickError}
          </div>
        )}

        {quickLoading && !quickAnalysis && (
          <div className="h-64 rounded bg-slate-800/40 animate-pulse" />
        )}

        {quickStock && quickAnalysis && (
          <div className="space-y-5">
            {/* Quote & Verdict Header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span>{MARKET_PRESETS[quickStock.market].label}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{quickStock.resolvedSymbol}</span>
                  {quickStock.market === 'US' && quickAnalysis.ext && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-sky-300">
                        {formatMarketStateShort(quickAnalysis.ext.marketState)}
                      </span>
                    </>
                  )}
                </div>
                <h3 className="mt-0.5 text-xl font-semibold text-slate-100">
                  {quickStock.name}
                </h3>
              </div>

              <div className="text-right font-mono tabular-nums">
                <div className="flex items-baseline justify-end gap-2">
                  <span className="text-2xl font-semibold text-slate-100">
                    {quickAnalysis.currSym}
                    {quickAnalysis.regularPrice.toFixed(2)}
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      quickAnalysis.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {quickAnalysis.changePct >= 0 ? '+' : ''}
                    {quickAnalysis.changePct.toFixed(2)}%
                  </span>
                </div>
                {quickAnalysis.extPrice != null && (
                  <div className="text-xs text-sky-300">
                    {quickAnalysis.extLabel}实时 ${quickAnalysis.extPrice.toFixed(2)}
                  </div>
                )}
              </div>
            </div>

            {/* Explicit Buy Verdict */}
            <div className="border-y border-slate-800 py-3.5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                {quickAnalysis.forecast.buyDecision.verdict === 'buy' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                ) : quickAnalysis.forecast.buyDecision.verdict === 'pullback' ? (
                  <AlertTriangle className="w-5 h-5 text-sky-300 shrink-0 mt-0.5" />
                ) : quickAnalysis.forecast.buyDecision.verdict === 'avoid' ? (
                  <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                ) : (
                  <MinusCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div
                    className={`text-lg font-semibold ${verdictTextColor(
                      quickAnalysis.forecast.buyDecision.verdict
                    )}`}
                  >
                    {quickAnalysis.forecast.buyDecision.verdictLabel}
                  </div>
                  <div className="text-xs text-slate-200 mt-0.5">
                    {quickAnalysis.forecast.buyDecision.actionHeadline}
                  </div>
                </div>
              </div>

              <div className="text-right font-mono tabular-nums">
                <div className="text-[11px] text-slate-400">预期盈亏比</div>
                <div className="text-lg font-semibold text-slate-100">
                  {quickAnalysis.forecast.buyDecision.riskRewardRatio.toFixed(2)} : 1
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              {quickAnalysis.forecast.buyDecision.reasonSummary}
            </p>

            {/* 4-Column Price Plan */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 border-y border-slate-800 py-3 font-mono tabular-nums">
              <div className="pr-3 py-1">
                <div className="text-[11px] text-slate-400">参考低吸区间</div>
                <div className="mt-0.5 text-xs font-semibold text-slate-100">
                  {quickAnalysis.currSym}
                  {quickAnalysis.forecast.buyDecision.idealEntryLow.toFixed(2)}–
                  {quickAnalysis.forecast.buyDecision.idealEntryHigh.toFixed(2)}
                </div>
              </div>
              <div className="sm:px-3 py-1">
                <div className="text-[11px] text-slate-400">上方第一目标</div>
                <div className="mt-0.5 text-xs font-semibold text-emerald-400">
                  {quickAnalysis.currSym}
                  {quickAnalysis.forecast.buyDecision.targetPrice.toFixed(2)}
                </div>
              </div>
              <div className="sm:px-3 py-1">
                <div className="text-[11px] text-slate-400">ATR 止损红线</div>
                <div className="mt-0.5 text-xs font-semibold text-rose-400">
                  {quickAnalysis.currSym}
                  {quickAnalysis.position.stopPrice.toFixed(2)}
                </div>
              </div>
              <div className="sm:pl-3 py-1">
                <div className="text-[11px] text-slate-400">建议买量</div>
                <div className="mt-0.5 text-xs font-semibold text-sky-300">
                  {quickAnalysis.position.shares.toLocaleString()} 股 (
                  {quickAnalysis.position.weightPct.toFixed(1)}%)
                </div>
              </div>
            </div>

            {/* 5-Factor Quick Checklist */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">5项核心量化因子拆解</span>
                <span className="font-mono tabular-nums text-slate-400">
                  20日收涨概率 {quickAnalysis.forecast.probAboveCurrentPct.toFixed(1)}%
                </span>
              </div>
              <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-md">
                {quickAnalysis.forecast.buyDecision.factors.map((f) => (
                  <div
                    key={f.name}
                    className="px-3 py-2 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {f.status === 'pass' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : f.status === 'fail' ? (
                        <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      ) : (
                        <MinusCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      )}
                      <span className="text-slate-200 font-medium whitespace-nowrap">
                        {f.name}
                      </span>
                      <span className="text-[11px] text-slate-400 truncate">
                        {f.detail}
                      </span>
                    </div>
                    <span
                      className={`font-mono tabular-nums shrink-0 font-medium ${
                        f.status === 'pass'
                          ? 'text-emerald-400'
                          : f.status === 'fail'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                      }`}
                    >
                      {f.reading}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Workflow Actions */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleLogQuickToLedger}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition-colors whitespace-nowrap shrink-0"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                按建议仓位记入账本
              </button>

              <button
                type="button"
                onClick={() => onOpenStrategyRadar(quickStock.market, quickStock.symbol)}
                className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-3.5 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/20 transition-colors whitespace-nowrap shrink-0"
              >
                <LineChart className="w-3.5 h-3.5" />
                查看 K 线、概率预测、新闻与提醒
              </button>

              {quickStock.market === 'US' && (
                <button
                  type="button"
                  onClick={() => onOpenStrategyOptions(quickStock.symbol)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600 transition-colors whitespace-nowrap shrink-0"
                >
                  美股期权模型
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
