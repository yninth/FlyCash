import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  BellOff,
  BellRing,
  BookmarkPlus,
  CheckCircle2,
  ClipboardCheck,
  MinusCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  calcAtrPosition,
  classifyTrend,
  computeAtrAnomalyReport,
  computeIndicators,
  computeStockForecast,
  formatMoney,
} from '../lib/quant';
import type { AlertPriceQuote } from '../lib/usePriceAlertMonitor';
import type {
  BuyVerdictType,
  CurrencyType,
  ForecastModelMode,
  GlobalRiskConfig,
  LedgerEntry,
  MarketType,
  PriceAlertRule,
  StockHistoryResponse,
  ToastType,
  WatchlistItemSpec,
} from '../types/trading';
import { AtrAnomalyPanel } from './AtrAnomalyPanel';
import { CandlestickChart, ExtendedIntradayChart, PriceForecastChart } from './Charts';
import { FundFlowForecastPanel } from './FundFlowForecastPanel';
import { PreMarketSentimentPanel } from './PreMarketSentimentPanel';
import { StockNewsPanel } from './StockNewsPanel';

interface EquityRadarViewProps {
  riskConfig: GlobalRiskConfig;
  usdCny: number;
  hkdCny: number;
  selectedMarket: MarketType;
  selectedSymbol: string;
  watchlist: WatchlistItemSpec[];
  alerts: PriceAlertRule[];
  onAddWatchlist: (item: WatchlistItemSpec) => void;
  onRemoveWatchlist: (mkt: MarketType, sym: string) => void;
  onSelectSymbol: (market: MarketType, symbol: string) => void;
  onOpenOptionsForSymbol: (symbol: string) => void;
  onAddToLedger: (entry: Omit<LedgerEntry, 'id' | 'createdAt'>) => void;
  onUpsertAlert: (rule: PriceAlertRule) => void;
  onDeleteAlert: (id: string) => void;
  onEvaluateAlerts?: (quotes: AlertPriceQuote[]) => void;
  onClearAlertGuard?: (ruleId: string) => void;
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

function verdictTextColor(v: BuyVerdictType): string {
  if (v === 'buy') return 'text-emerald-400';
  if (v === 'pullback') return 'text-sky-300';
  if (v === 'avoid') return 'text-rose-400';
  return 'text-amber-400';
}

function formatMarketStateLabel(state?: string): string {
  switch (state) {
    case 'PRE':
      return '美股盘前交易中 (04:00–09:30 ET)';
    case 'REGULAR':
      return '美股盘中交易中 (09:30–16:00 ET)';
    case 'POST':
      return '美股盘后交易中 (16:00–20:00 ET)';
    case 'PREPRE':
      return '盘前未开（美东04:00开盘）';
    default:
      return '美股休市 · 已载入延伸时段报价';
  }
}

function formatLocalHhMm(iso: string | null | undefined): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getInitialNotifPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

function currencySymbolOf(c: CurrencyType): string {
  return c === 'CNY' ? '¥' : c === 'HKD' ? 'HK$' : '$';
}

interface SymbolSuggestItem {
  market: MarketType;
  symbol: string;
  name: string;
  secid: string;
  exchangeLabel: string;
}

export const EquityRadarView: React.FC<EquityRadarViewProps> = ({
  riskConfig,
  usdCny,
  hkdCny,
  selectedMarket,
  selectedSymbol,
  watchlist,
  alerts,
  onAddWatchlist,
  onRemoveWatchlist,
  onSelectSymbol,
  onOpenOptionsForSymbol,
  onAddToLedger,
  onUpsertAlert,
  onDeleteAlert,
  onEvaluateAlerts,
  onClearAlertGuard,
  onNotify,
}) => {
  const [marketInput, setMarketInput] = useState<MarketType>(selectedMarket);
  const [symbolInput, setSymbolInput] = useState<string>(selectedSymbol);
  const [lotSize, setLotSize] = useState<number>(selectedMarket === 'US' ? 1 : 100);

  const [suggestions, setSuggestions] = useState<SymbolSuggestItem[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [activeSuggestIdx, setActiveSuggestIdx] = useState(-1);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const skipSuggestRef = useRef(true);

  const [forecastDays, setForecastDays] = useState<number>(20);
  const [forecastMode, setForecastMode] = useState<ForecastModelMode>('momentum');
  const [chartMode, setChartMode] = useState<'daily' | 'extended' | 'forecast'>('daily');
  const [useExtendedPrice, setUseExtendedPrice] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  const [stockData, setStockData] = useState<StockHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Price Alerts & Browser Notification API state
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>(
    getInitialNotifPermission
  );
  const [supportInput, setSupportInput] = useState<string>('');
  const [resistanceInput, setResistanceInput] = useState<string>('');
  const firedGuardRef = useRef<Set<string>>(new Set());

  // Pre-Trade SOP Checklist state (reset per symbol)
  const [sopChecks, setSopChecks] = useState<{
    eventCheck: boolean;
    orderSet: boolean;
    sizeApproved: boolean;
  }>({ eventCheck: false, orderSet: false, sizeApproved: false });

  useEffect(() => {
    setSopChecks({ eventCheck: false, orderSet: false, sizeApproved: false });
  }, [selectedMarket, selectedSymbol]);

  const activeAlertForSelected = useMemo(
    () =>
      alerts.find(
        (a) =>
          a.market === (stockData?.market ?? selectedMarket) &&
          a.symbol === (stockData?.symbol ?? selectedSymbol)
      ) ?? null,
    [alerts, stockData, selectedMarket, selectedSymbol]
  );

  useEffect(() => {
    if (activeAlertForSelected) {
      setSupportInput(
        activeAlertForSelected.supportPrice != null
          ? activeAlertForSelected.supportPrice.toFixed(2)
          : ''
      );
      setResistanceInput(
        activeAlertForSelected.resistancePrice != null
          ? activeAlertForSelected.resistancePrice.toFixed(2)
          : ''
      );
    } else {
      setSupportInput('');
      setResistanceInput('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAlertForSelected?.id, selectedMarket, selectedSymbol]);

  const sendBrowserNotification = useCallback((title: string, body: string, tag: string) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, {
        body,
        tag,
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // ignore Notification constructor errors
    }
  }, []);

  const requestNotifPermission = useCallback(async (): Promise<
    NotificationPermission | 'unsupported'
  > => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotifPerm('unsupported');
      onNotify('warning', '当前浏览器不支持原生桌面通知');
      return 'unsupported';
    }
    try {
      const perm = await Notification.requestPermission();
      setNotifPerm(perm);
      if (perm === 'granted') {
        onNotify('success', '浏览器通知权限已开启', '切换标签页后触发支撑/阻力位也会推送提醒');
      } else if (perm === 'denied') {
        onNotify('warning', '通知权限被拒绝', '请在浏览器地址栏站点权限中手动允许通知');
      }
      return perm;
    } catch {
      return notifPerm;
    }
  }, [notifPerm, onNotify]);

  useEffect(() => {
    skipSuggestRef.current = true;
    setMarketInput(selectedMarket);
    setSymbolInput(selectedSymbol);
    setLotSize(selectedMarket === 'US' ? 1 : 100);
    setSuggestOpen(false);
    setSuggestions([]);
    if (selectedMarket !== 'US' && chartMode === 'extended') {
      setChartMode('daily');
    }
  }, [selectedMarket, selectedSymbol, chartMode]);

  useEffect(() => {
    const handleClickOutside = (ev: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(ev.target as Node)) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (skipSuggestRef.current) return;
    const q = symbolInput.trim();
    if (!q || q.length < 1) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const res = await fetch(`/api/symbol-search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const json = (await res.json()) as { items?: SymbolSuggestItem[] };
        const list = Array.isArray(json.items) ? json.items : [];
        setSuggestions(list);
        setActiveSuggestIdx(-1);
        setSuggestOpen(list.length > 0);
      } catch {
        // ignore abort/network error
      } finally {
        setSuggestLoading(false);
      }
    }, 240);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [symbolInput]);

  const loadStock = useCallback(
    async (
      mkt: MarketType,
      sym: string,
      announce = false,
      forceRefresh = false,
      silent = false
    ) => {
      const clean = sym.trim().toUpperCase();
      if (!clean) return;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await fetch(
          `/api/stock?market=${encodeURIComponent(mkt)}&symbol=${encodeURIComponent(clean)}&days=500${
            forceRefresh ? '&refresh=1' : ''
          }`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '行情请求失败');
        const typed = data as StockHistoryResponse;
        setStockData(typed);
        if (typed.symbol && typed.symbol !== clean) {
          skipSuggestRef.current = true;
          setSymbolInput(typed.symbol);
        }
        if (announce) {
          onNotify(
            'success',
            `已更新 ${typed.name} (${typed.resolvedSymbol}) 行情与预测`,
            `数据源：${typed.source}`
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '数据获取失败';
        if (!silent) {
          setError(msg);
        }
        if (announce) {
          onNotify('error', `获取 ${clean} 行情失败`, msg);
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [onNotify]
  );

  useEffect(() => {
    loadStock(selectedMarket, selectedSymbol, false, false, false);
  }, [selectedMarket, selectedSymbol, loadStock]);

  const hasEnabledAlerts = useMemo(() => alerts.some((a) => a.enabled), [alerts]);

  useEffect(() => {
    if (!autoRefresh && !hasEnabledAlerts) return;
    const timer = window.setInterval(() => {
      if (!document.hidden || hasEnabledAlerts) {
        loadStock(selectedMarket, selectedSymbol, false, false, true);
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, hasEnabledAlerts, selectedMarket, selectedSymbol, loadStock]);

  const enrichedBars = useMemo(
    () => (stockData ? computeIndicators(stockData.bars) : []),
    [stockData]
  );

  const analysis = useMemo(() => {
    if (enrichedBars.length < 2) return null;
    const last = enrichedBars[enrichedBars.length - 1];
    const prev = enrichedBars[enrichedBars.length - 2];
    const fx =
      stockData?.currency === 'CNY' ? 1 : stockData?.currency === 'HKD' ? hkdCny : usdCny;
    const currSym = currencySymbolOf(stockData?.currency ?? 'USD');

    const ext = stockData?.extendedQuote ?? null;
    const regularPrice =
      stockData?.market === 'US' && ext?.regularPrice != null ? ext.regularPrice : last.close;
    const changePct =
      stockData?.market === 'US' && ext?.regularChangePct != null
        ? ext.regularChangePct
        : prev.close > 0
          ? ((last.close - prev.close) / prev.close) * 100
          : 0;

    const activeExtended =
      stockData?.market === 'US' && ext
        ? ext.preMarketPrice != null
          ? {
              sessionLabel: '盘前',
              price: ext.preMarketPrice,
              changePct: ext.preMarketChangePct,
              time: ext.preMarketTime,
            }
          : ext.postMarketPrice != null
            ? {
                sessionLabel: '盘后',
                price: ext.postMarketPrice,
                changePct: ext.postMarketChangePct,
                time: ext.postMarketTime,
              }
            : null
        : null;

    const sizingPrice =
      stockData?.market === 'US' && useExtendedPrice && activeExtended
        ? activeExtended.price
        : regularPrice;

    const position = calcAtrPosition({
      totalCapitalCny: riskConfig.totalCapitalCny,
      riskPct: riskConfig.stockRiskPct,
      priceLocal: sizingPrice,
      atrLocal: last.atr14 ?? sizingPrice * 0.03,
      atrMultiplier: riskConfig.atrMultiplier,
      fxToCny: fx,
      lotSize,
    });

    const forecast = computeStockForecast(enrichedBars, {
      horizonDays: forecastDays,
      mode: forecastMode,
      atrMultiplier: riskConfig.atrMultiplier,
    });

    const trend = classifyTrend(last);
    const atrAnomaly = computeAtrAnomalyReport(
      enrichedBars,
      120,
      riskConfig.atrMultiplier
    );

    return {
      last,
      prev,
      fx,
      currSym,
      position,
      forecast,
      trend,
      atrAnomaly,
      regularPrice,
      changePct,
      ext,
      activeExtended,
      sizingPrice,
    };
  }, [
    enrichedBars,
    stockData,
    hkdCny,
    usdCny,
    riskConfig,
    lotSize,
    forecastDays,
    forecastMode,
    useExtendedPrice,
  ]);

  useEffect(() => {
    if (!stockData || !analysis || !onEvaluateAlerts) return;
    onEvaluateAlerts([
      {
        market: stockData.market,
        symbol: stockData.symbol,
        name: stockData.name,
        currency: stockData.currency,
        price: analysis.sizingPrice,
      },
    ]);
  }, [stockData, analysis, onEvaluateAlerts]);

  const handleSaveAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockData || !analysis) return;

    const supVal = supportInput.trim() ? Number(supportInput) : null;
    const resVal = resistanceInput.trim() ? Number(resistanceInput) : null;

    if (
      (supVal === null || !Number.isFinite(supVal) || supVal <= 0) &&
      (resVal === null || !Number.isFinite(resVal) || resVal <= 0)
    ) {
      onNotify('warning', '请至少填写一个有效的支撑位或阻力位价格');
      return;
    }

    if (notifPerm === 'default') {
      await requestNotifPermission();
    }

    const nowIso = new Date().toISOString();
    const id = `${stockData.market}_${stockData.symbol}`;
    firedGuardRef.current.delete(`${id}:support`);
    firedGuardRef.current.delete(`${id}:resistance`);
    onClearAlertGuard?.(id);

    const newRule: PriceAlertRule = {
      id,
      market: stockData.market,
      symbol: stockData.symbol,
      name: stockData.name,
      currency: stockData.currency,
      supportPrice: supVal && supVal > 0 ? supVal : null,
      resistancePrice: resVal && resVal > 0 ? resVal : null,
      enabled: true,
      triggeredSupportAt: null,
      triggeredResistanceAt: null,
      createdAt: activeAlertForSelected?.createdAt ?? nowIso,
    };

    onUpsertAlert(newRule);

    const parts: string[] = [];
    if (newRule.supportPrice) parts.push(`支撑 ${analysis.currSym}${newRule.supportPrice.toFixed(2)}`);
    if (newRule.resistancePrice)
      parts.push(`阻力 ${analysis.currSym}${newRule.resistancePrice.toFixed(2)}`);
    onNotify('success', `已开启 ${stockData.symbol} 价格提醒`, `${parts.join(' · ')}（后台持续监控）`);
  };

  const handleToggleAlert = (rule: PriceAlertRule) => {
    onUpsertAlert({ ...rule, enabled: !rule.enabled });
  };

  const handleResetAlert = (rule: PriceAlertRule) => {
    firedGuardRef.current.delete(`${rule.id}:support`);
    firedGuardRef.current.delete(`${rule.id}:resistance`);
    onClearAlertGuard?.(rule.id);
    onUpsertAlert({
      ...rule,
      enabled: true,
      triggeredSupportAt: null,
      triggeredResistanceAt: null,
    });
    onNotify('info', '已重置该标的提醒触发状态');
  };

  const handleDeleteAlert = (id: string) => {
    firedGuardRef.current.delete(`${id}:support`);
    firedGuardRef.current.delete(`${id}:resistance`);
    onClearAlertGuard?.(id);
    onDeleteAlert(id);
    onNotify('info', '已删除价格提醒规则');
  };

  const handleLogEquityToLedger = () => {
    if (!stockData || !analysis) return;
    const qty = analysis.position.shares > 0 ? analysis.position.shares : lotSize;
    const ledgerMkt: LedgerEntry['market'] =
      stockData.market === 'CN' ? 'A股' : stockData.market === 'HK' ? '港股' : '美股';
    onAddToLedger({
      market: ledgerMkt,
      symbol: stockData.symbol,
      currency: stockData.currency,
      quantity: qty,
      costPrice: Number(analysis.sizingPrice.toFixed(2)),
      expiryDate: '',
      note: `雷达定仓买入 · 止损 ${analysis.currSym}${analysis.position.stopPrice.toFixed(2)}`,
    });
    onNotify(
      'success',
      `已按建议仓位记入我的账本：${stockData.symbol}`,
      `${qty.toLocaleString()} 股 · 参考价 ${analysis.currSym}${analysis.sizingPrice.toFixed(2)} · 止损 ${analysis.currSym}${analysis.position.stopPrice.toFixed(2)}`
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    skipSuggestRef.current = true;
    setSuggestOpen(false);
    let clean = symbolInput.trim().toUpperCase();
    if (!clean) {
      onNotify('warning', '请输入股票或 ETF 代码');
      return;
    }

    let targetMarket = marketInput;
    // Handle broker copy-pastes like "US.SNXX", "SNXX.US", "SNXX 2倍做多SNDK ETF-Tradr"
    if (/^(?:US|NASDAQ|NYSE|AMEX)\./i.test(clean) || /\.US$/i.test(clean)) {
      targetMarket = 'US';
      clean = clean.replace(/^(?:US|NASDAQ|NYSE|AMEX)\./i, '').replace(/\.US$/i, '');
    } else if (/^HK\./i.test(clean) || /\.HK$/i.test(clean)) {
      targetMarket = 'HK';
      clean = clean.replace(/^HK\./i, '').replace(/\.HK$/i, '');
    } else if (/^(?:SH|SZ)\./i.test(clean) || /\.(?:SH|SZ|SS)$/i.test(clean)) {
      targetMarket = 'CN';
      clean = clean.replace(/^(?:SH|SZ)\./i, '').replace(/\.(?:SH|SZ|SS)$/i, '');
    }

    const tokenMatch = clean.match(/^([A-Z0-9]{1,6}(?:[.-][A-Z]{1,2})?)(?:\s+.*)?$/);
    if (tokenMatch) {
      clean = tokenMatch[1];
    }

    if (targetMarket !== 'US' && /^[A-Z]{1,6}(?:[.-][A-Z]{1,2})?$/.test(clean)) {
      targetMarket = 'US';
      setMarketInput('US');
      setLotSize(1);
      onNotify('info', `已自动切换为美股市场查询 ${clean}`);
    }

    setSymbolInput(clean);

    if (targetMarket === selectedMarket && clean === selectedSymbol) {
      loadStock(targetMarket, clean, true, true);
    } else {
      onSelectSymbol(targetMarket, clean);
      onNotify('info', `正在分析 ${MARKET_PRESETS[targetMarket].label} ${clean}...`);
    }
  };

  const handleAddToWatchlist = () => {
    const clean = symbolInput.trim().toUpperCase();
    if (!clean) {
      onNotify('warning', '请先输入标的代码');
      return;
    }
    if (watchlist.some((w) => w.market === marketInput && w.symbol === clean)) {
      onNotify('info', `${clean} 已在自选雷达中`, '无需重复添加');
      return;
    }
    onAddWatchlist({ market: marketInput, symbol: clean, lotSize });
  };

  const handleSelectSuggestion = (item: SymbolSuggestItem) => {
    skipSuggestRef.current = true;
    const nextLot = item.market === 'US' ? 1 : 100;
    setMarketInput(item.market);
    setSymbolInput(item.symbol);
    setLotSize(nextLot);
    setSuggestOpen(false);
    setSuggestions([]);
    setActiveSuggestIdx(-1);
    if (item.market === selectedMarket && item.symbol === selectedSymbol) {
      loadStock(item.market, item.symbol, true, true);
    } else {
      onSelectSymbol(item.market, item.symbol);
      onNotify(
        'info',
        `正在分析 ${MARKET_PRESETS[item.market].label} ${item.name} (${item.symbol})`
      );
    }
  };

  return (
    <div className="space-y-5">
      {/* Row 1: Unified Search Control, Watchlist Quick-Switch & Quote/KPI Strip */}
      <section className="rounded-lg border border-slate-800 bg-[#0F172A] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">市场选择</label>
              <div className="flex items-center rounded-md bg-slate-900 p-0.5 border border-slate-800 text-xs">
                {(['US', 'HK', 'CN'] as MarketType[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      skipSuggestRef.current = true;
                      setSuggestOpen(false);
                      setMarketInput(m);
                      setSymbolInput(MARKET_PRESETS[m].codes[0]);
                      setLotSize(MARKET_PRESETS[m].defaultLot);
                    }}
                    className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                      marketInput === m
                        ? 'bg-sky-500/20 text-sky-300 font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {MARKET_PRESETS[m].label}
                  </button>
                ))}
              </div>
            </div>

            <div ref={searchBoxRef} className="relative">
              <label htmlFor="radar-symbol" className="block text-[11px] text-slate-400 mb-1">
                标的代码 / 名称
              </label>
              <input
                id="radar-symbol"
                value={symbolInput}
                autoComplete="off"
                onFocus={() => {
                  if (suggestions.length > 0) setSuggestOpen(true);
                }}
                onChange={(e) => {
                  skipSuggestRef.current = false;
                  setSymbolInput(e.target.value);
                  setSuggestOpen(true);
                }}
                onKeyDown={(e) => {
                  if (!suggestOpen || suggestions.length === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveSuggestIdx((idx) => (idx + 1) % suggestions.length);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveSuggestIdx((idx) =>
                      idx <= 0 ? suggestions.length - 1 : idx - 1
                    );
                  } else if (e.key === 'Enter' && activeSuggestIdx >= 0) {
                    e.preventDefault();
                    handleSelectSuggestion(suggestions[activeSuggestIdx]);
                  } else if (e.key === 'Escape') {
                    setSuggestOpen(false);
                  }
                }}
                placeholder="NVDA / 腾讯 / 二倍做多SNDK"
                className="w-44 sm:w-52 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-mono text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              />

              {suggestOpen && (suggestLoading || suggestions.length > 0) && (
                <div className="absolute left-0 top-full z-40 mt-1 w-72 sm:w-80 rounded-md border border-slate-700 bg-[#0F172A] shadow-xl overflow-hidden">
                  {suggestLoading && suggestions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-slate-400">
                      正在检索东方财富标的...
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/80 max-h-64 overflow-y-auto">
                      {suggestions.map((item, idx) => (
                        <button
                          key={`${item.market}-${item.secid}`}
                          type="button"
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            handleSelectSuggestion(item);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
                            idx === activeSuggestIdx
                              ? 'bg-sky-500/15 text-slate-100'
                              : 'hover:bg-slate-800/70 text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[11px] text-slate-400 shrink-0">
                              {MARKET_PRESETS[item.market].label}
                            </span>
                            <span className="font-mono font-semibold text-sky-300 tabular-nums shrink-0">
                              {item.symbol}
                            </span>
                            <span className="truncate text-slate-200">{item.name}</span>
                          </div>
                          <span className="text-[11px] text-slate-500 shrink-0">
                            {item.exchangeLabel}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="radar-lot" className="block text-[11px] text-slate-400 mb-1">
                每手
              </label>
              <input
                id="radar-lot"
                type="number"
                min={1}
                value={lotSize}
                onChange={(e) => setLotSize(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
              {loading ? '分析中...' : '分析并定仓'}
            </button>

            <button
              type="button"
              onClick={handleAddToWatchlist}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              加自选
            </button>
          </form>

          {stockData && analysis && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAutoRefresh((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  autoRefresh
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                {autoRefresh ? '15s 自动' : '自动暂停'}
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => loadStock(stockData.market, stockData.symbol, true, true, false)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </button>

              <button
                type="button"
                onClick={handleLogEquityToLedger}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition-colors whitespace-nowrap shrink-0"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                记入我的账本
              </button>

              {stockData.market === 'US' && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenOptionsForSymbol(stockData.symbol);
                    onNotify('info', `已跳转至 ${stockData.symbol} 美股期权链`);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 transition-colors whitespace-nowrap shrink-0"
                >
                  {stockData.symbol} 期权链
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* 1-Line Watchlist & Market Quick-Switch Strip */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-3 text-xs">
          <span className="text-slate-500 shrink-0">自选快切:</span>
          {watchlist.map((w) => {
            const active = w.market === selectedMarket && w.symbol === selectedSymbol;
            return (
              <div
                key={`${w.market}-${w.symbol}`}
                className={`inline-flex items-center rounded border transition-colors ${
                  active
                    ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                    : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectSymbol(w.market, w.symbol);
                    onNotify('info', `切换分析标的：${MARKET_PRESETS[w.market].label} ${w.symbol}`);
                  }}
                  className="px-2 py-0.5 font-mono whitespace-nowrap"
                >
                  <span className="text-[10px] text-slate-500 mr-1">
                    {MARKET_PRESETS[w.market].label}
                  </span>
                  {w.symbol}
                </button>
                <button
                  type="button"
                  title={`移出 ${w.symbol}`}
                  onClick={() => onRemoveWatchlist(w.market, w.symbol)}
                  className="pr-1.5 pl-0.5 py-0.5 text-slate-500 hover:text-rose-400 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          <span className="text-slate-700 mx-1 hidden sm:inline">|</span>
          <span className="text-slate-500 shrink-0">{MARKET_PRESETS[marketInput].label}热门:</span>
          {MARKET_PRESETS[marketInput].codes.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                setSymbolInput(code);
                onSelectSymbol(marketInput, code);
              }}
              className="px-2 py-0.5 rounded border border-slate-800/80 bg-slate-900/40 font-mono text-slate-400 hover:text-sky-300 hover:border-sky-500/40 transition-colors whitespace-nowrap shrink-0"
            >
              {code}
            </button>
          ))}
        </div>

        {/* Quote Title & 5-KPI Strip */}
        {stockData && analysis && (
          <div className="border-t border-slate-800 pt-4 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-xl font-semibold text-slate-100">{stockData.name}</h2>
                <span className="text-xs font-mono text-slate-400">
                  {MARKET_PRESETS[stockData.market].label} · {stockData.resolvedSymbol}
                </span>
                <span
                  className={`text-xs font-medium ${
                    analysis.trend === 'bull'
                      ? 'text-emerald-400'
                      : analysis.trend === 'bear'
                        ? 'text-rose-400'
                        : 'text-amber-400'
                  }`}
                >
                  {analysis.trend === 'bull'
                    ? '多头上升趋势 · 顺势做多'
                    : analysis.trend === 'bear'
                      ? '空头下降趋势 · 谨慎观望'
                      : '震荡整理期 · 控制仓位'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>数据源 {stockData.source}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{analysis.last.date}</span>
                {typeof stockData.quoteDelayMinutes === 'number' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        stockData.quoteDelayMinutes === 0
                          ? 'text-emerald-400 font-medium'
                          : 'text-amber-300'
                      }
                    >
                      {stockData.quoteDelayMinutes === 0
                        ? '准实时快照'
                        : `公共源延迟约 ${stockData.quoteDelayMinutes}m`}
                    </span>
                  </>
                )}
                {stockData.market === 'US' && analysis.ext && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-sky-300 font-medium">
                      {formatMarketStateLabel(analysis.ext.marketState)}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-slate-800">
              <div className="pr-4 py-1">
                <div className="text-xs text-slate-400">
                  {stockData.market === 'US' ? '常规收盘 / 盘前·盘后' : '最新收盘价'}
                </div>
                <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-xl font-semibold text-slate-100">
                    {analysis.currSym}
                    {analysis.regularPrice.toFixed(2)}
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      analysis.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {analysis.changePct >= 0 ? '+' : ''}
                    {analysis.changePct.toFixed(2)}%
                  </span>
                </div>

                {stockData.market === 'US' && analysis.ext && (
                  <div className="mt-1 space-y-0.5 text-[11px] font-mono tabular-nums">
                    {analysis.ext.preMarketPrice != null ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-sky-400 font-medium">盘前</span>
                        <span className="text-slate-100 font-semibold">
                          ${analysis.ext.preMarketPrice.toFixed(2)}
                        </span>
                        {analysis.ext.preMarketChangePct != null && (
                          <span
                            className={
                              analysis.ext.preMarketChangePct >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }
                          >
                            {analysis.ext.preMarketChangePct >= 0 ? '+' : ''}
                            {analysis.ext.preMarketChangePct.toFixed(2)}%
                          </span>
                        )}
                        {analysis.ext.preMarketTime && (
                          <span className="text-slate-500">
                            {formatLocalHhMm(analysis.ext.preMarketTime)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-slate-500">盘前未开（美东 04:00）</div>
                    )}

                    {analysis.ext.postMarketPrice != null && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-amber-400 font-medium">盘后</span>
                        <span className="text-slate-200">
                          ${analysis.ext.postMarketPrice.toFixed(2)}
                        </span>
                        {analysis.ext.postMarketChangePct != null && (
                          <span
                            className={
                              analysis.ext.postMarketChangePct >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }
                          >
                            {analysis.ext.postMarketChangePct >= 0 ? '+' : ''}
                            {analysis.ext.postMarketChangePct.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="md:pl-4 pr-4 py-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">14日波动 ATR14</span>
                  {analysis.atrAnomaly &&
                    (analysis.atrAnomaly.level === 'extreme' ||
                      analysis.atrAnomaly.level === 'elevated') && (
                      <span
                        className={`text-[11px] font-mono tabular-nums font-semibold ${
                          analysis.atrAnomaly.level === 'extreme'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                        }`}
                      >
                        {analysis.atrAnomaly.level === 'extreme' ? '高危异常' : '波动偏高'}
                      </span>
                    )}
                </div>
                <div className="mt-1 font-mono tabular-nums">
                  <span className="text-xl font-semibold text-slate-100">
                    {analysis.currSym}
                    {(analysis.last.atr14 ?? 0).toFixed(2)}
                  </span>
                  <div className="text-xs text-slate-400 mt-0.5">
                    日均振幅{' '}
                    {(((analysis.last.atr14 ?? 0) / analysis.sizingPrice) * 100).toFixed(2)}%
                    {analysis.atrAnomaly && (
                      <span
                        className={`ml-1.5 ${
                          analysis.atrAnomaly.level === 'extreme'
                            ? 'text-rose-400'
                            : analysis.atrAnomaly.level === 'elevated'
                              ? 'text-amber-300'
                              : 'text-slate-500'
                        }`}
                      >
                        ({analysis.atrAnomaly.deviationPct >= 0 ? '+' : ''}
                        {analysis.atrAnomaly.deviationPct.toFixed(0)}%)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="md:pl-4 pr-4 py-1">
                <div className="text-xs text-slate-400">HV20 / 波动率分位</div>
                <div className="mt-1 font-mono tabular-nums">
                  <span className="text-xl font-semibold text-slate-100">
                    {(analysis.last.hv20 ?? 0).toFixed(1)}%
                  </span>
                  <div className="text-xs text-slate-400 mt-0.5">
                    一年分位{' '}
                    {analysis.last.hvRank !== null
                      ? `${analysis.last.hvRank.toFixed(0)}%`
                      : '样本积累中'}
                  </div>
                </div>
              </div>

              <div className="md:pl-4 pr-4 py-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">以损定仓建议买量</span>
                  {stockData.market === 'US' && analysis.activeExtended && (
                    <button
                      type="button"
                      onClick={() => setUseExtendedPrice((v) => !v)}
                      className="text-[10px] font-mono text-sky-400 hover:text-sky-300 underline underline-offset-2"
                    >
                      {useExtendedPrice
                        ? `按${analysis.activeExtended.sessionLabel}价`
                        : '按常规价'}
                    </button>
                  )}
                </div>
                <div className="mt-1 font-mono tabular-nums">
                  <span className="text-xl font-semibold text-sky-400">
                    {analysis.position.shares.toLocaleString()} 股
                  </span>
                  <div className="text-xs text-slate-400 mt-0.5">
                    市值 {formatMoney(analysis.position.costCny)} (
                    {analysis.position.weightPct.toFixed(1)}%)
                  </div>
                </div>
              </div>

              <div className="md:pl-4 py-1">
                <div className="text-xs text-slate-400">
                  ATR 止损位 ({riskConfig.atrMultiplier}×ATR)
                </div>
                <div className="mt-1 font-mono tabular-nums">
                  <span className="text-xl font-semibold text-rose-400">
                    {analysis.currSym}
                    {analysis.position.stopPrice.toFixed(2)}
                  </span>
                  <div className="text-xs text-slate-400 mt-0.5">
                    触发止损亏损 {formatMoney(analysis.position.riskCny)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-lg border border-rose-900/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {stockData && analysis && (
        <>
          {/* Row 2: 7-Col Unified Chart Viewport + 5-Col Buy Decision & SOP */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
            {/* Left 7 Cols: Chart Viewport with 3-Mode Switcher */}
            <section className="xl:col-span-7 rounded-lg border border-slate-800 bg-[#0F172A] p-5 flex flex-col justify-between space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
                <div className="flex flex-wrap items-center rounded-md bg-slate-900 p-1 border border-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setChartMode('daily')}
                    className={`px-3 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                      chartMode === 'daily'
                        ? 'bg-sky-500/20 text-sky-300 font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    日 K 线 + 止损/提醒线
                  </button>
                  {stockData.market === 'US' && (
                    <button
                      type="button"
                      onClick={() => setChartMode('extended')}
                      className={`px-3 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                        chartMode === 'extended'
                          ? 'bg-sky-500/20 text-sky-300 font-medium'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      盘前·盘中·盘后分时 ({stockData.extendedBars?.length ?? 0})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setChartMode('forecast')}
                    className={`px-3 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                      chartMode === 'forecast'
                        ? 'bg-sky-500/20 text-sky-300 font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    GBM 未来价格概率锥
                  </button>
                </div>

                {chartMode === 'forecast' ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <div className="flex items-center rounded-md bg-slate-900 p-0.5 border border-slate-800">
                      {[10, 20, 30].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            setForecastDays(d);
                            onNotify('info', `已切换为未来 ${d} 个交易日预测`);
                          }}
                          className={`px-2 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                            forecastDays === d
                              ? 'bg-sky-500/20 text-sky-300 font-medium'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {d}日
                        </button>
                      ))}
                    </div>

                    <select
                      value={forecastMode}
                      aria-label="预测模型"
                      onChange={(e) => {
                        const m = e.target.value as ForecastModelMode;
                        setForecastMode(m);
                        const label =
                          m === 'momentum'
                            ? '动量延续模型'
                            : m === 'mean_revert'
                              ? '均值回归模型'
                              : '中性随机游走';
                        onNotify('info', `预测模型已切换为：${label}`);
                      }}
                      className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                    >
                      <option value="momentum">动量延续模型</option>
                      <option value="neutral">中性随机游走</option>
                      <option value="mean_revert">均值回归模型</option>
                    </select>
                  </div>
                ) : (
                  analysis.activeExtended && (
                    <div className="text-xs font-mono text-slate-400">
                      定仓基准：
                      <span className="text-slate-200 font-semibold ml-1">
                        {useExtendedPrice
                          ? `${analysis.activeExtended.sessionLabel} $${analysis.activeExtended.price.toFixed(2)}`
                          : `常规收盘 $${analysis.regularPrice.toFixed(2)}`}
                      </span>
                    </div>
                  )
                )}
              </div>

              {chartMode === 'forecast' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 border-b border-slate-800 pb-3 font-mono tabular-nums">
                  <div className="pr-3 py-1">
                    <div className="text-[11px] text-slate-400">收涨概率 P(期末&gt;现价)</div>
                    <div
                      className={`mt-0.5 text-base font-semibold ${
                        analysis.forecast.probAboveCurrentPct >= 52
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }`}
                    >
                      {analysis.forecast.probAboveCurrentPct.toFixed(1)}%
                    </div>
                  </div>
                  <div className="sm:px-3 py-1">
                    <div className="text-[11px] text-slate-400">悲观下沿 P10</div>
                    <div className="mt-0.5 text-base font-semibold text-rose-400">
                      {analysis.currSym}
                      {analysis.forecast.points[analysis.forecast.points.length - 1].p10.toFixed(2)}
                    </div>
                  </div>
                  <div className="sm:px-3 py-1">
                    <div className="text-[11px] text-slate-400">中位预期 P50</div>
                    <div className="mt-0.5 text-base font-semibold text-sky-300">
                      {analysis.currSym}
                      {analysis.forecast.points[analysis.forecast.points.length - 1].p50.toFixed(2)}
                    </div>
                  </div>
                  <div className="sm:pl-3 py-1">
                    <div className="text-[11px] text-slate-400">乐观上沿 P90</div>
                    <div className="mt-0.5 text-base font-semibold text-emerald-400">
                      {analysis.currSym}
                      {analysis.forecast.points[analysis.forecast.points.length - 1].p90.toFixed(2)}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex-1 min-h-[340px]">
                {stockData.market === 'US' && chartMode === 'extended' ? (
                  <ExtendedIntradayChart
                    bars={stockData.extendedBars ?? []}
                    prevClose={stockData.prevClose ?? analysis.regularPrice}
                    currencySymbol={analysis.currSym}
                  />
                ) : chartMode === 'forecast' ? (
                  <PriceForecastChart
                    historyBars={enrichedBars}
                    forecast={analysis.forecast}
                    currencySymbol={analysis.currSym}
                  />
                ) : (
                  <CandlestickChart
                    bars={enrichedBars}
                    stopPrice={analysis.position.stopPrice}
                    currencySymbol={analysis.currSym}
                    alertSupportPrice={
                      activeAlertForSelected?.enabled ? activeAlertForSelected.supportPrice : null
                    }
                    alertResistancePrice={
                      activeAlertForSelected?.enabled
                        ? activeAlertForSelected.resistancePrice
                        : null
                    }
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3 text-xs text-slate-400">
                <span>
                  {chartMode === 'forecast'
                    ? analysis.forecast.summaryText
                    : `未来 ${forecastDays} 日中性预期 P50：${analysis.currSym}${analysis.forecast.points[
                        analysis.forecast.points.length - 1
                      ].p50.toFixed(2)} · 收涨概率 ${analysis.forecast.probAboveCurrentPct.toFixed(
                        1
                      )}%`}
                </span>
                <span className="font-mono tabular-nums text-slate-300">
                  20日支撑 {analysis.currSym}
                  {analysis.forecast.signals.support20.toFixed(2)} · 阻力 {analysis.currSym}
                  {analysis.forecast.signals.resistance20.toFixed(2)}
                </span>
              </div>
            </section>

            {/* Right 5 Cols: Explicit Buy Recommendation, 5-Factor Checklist & Pre-Trade SOP */}
            <section className="xl:col-span-5 rounded-lg border border-slate-800 bg-[#0F172A] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
                  <div>
                    <div className="text-xs text-slate-400">多因子买入决策评估</div>
                    <h3
                      className={`mt-1 text-xl font-semibold ${verdictTextColor(
                        analysis.forecast.buyDecision.verdict
                      )}`}
                    >
                      {analysis.forecast.buyDecision.verdictLabel}
                    </h3>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div className="text-xs text-slate-400">预期盈亏比</div>
                    <div className="mt-1 text-base font-semibold text-slate-100">
                      {analysis.forecast.buyDecision.riskRewardRatio.toFixed(2)} : 1
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-100">
                    {analysis.forecast.buyDecision.actionHeadline}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {analysis.forecast.buyDecision.reasonSummary}
                  </p>
                  <div className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-sky-200/90 leading-relaxed">
                    <span className="font-semibold text-sky-300">期权联动建议：</span>
                    {analysis.forecast.buyDecision.optionAction}
                  </div>
                </div>

                <div className="grid grid-cols-3 divide-x divide-slate-800 border-y border-slate-800 py-2.5 font-mono tabular-nums">
                  <div className="pr-2.5">
                    <div className="text-[11px] text-slate-400">参考低吸区间</div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-100">
                      {analysis.currSym}
                      {analysis.forecast.buyDecision.idealEntryLow.toFixed(2)}–
                      {analysis.forecast.buyDecision.idealEntryHigh.toFixed(2)}
                    </div>
                  </div>
                  <div className="px-2.5">
                    <div className="text-[11px] text-slate-400">上方第一目标</div>
                    <div className="mt-0.5 text-xs font-semibold text-emerald-400">
                      {analysis.currSym}
                      {analysis.forecast.buyDecision.targetPrice.toFixed(2)}
                    </div>
                  </div>
                  <div className="pl-2.5">
                    <div className="text-[11px] text-slate-400">硬性止损红线</div>
                    <div className="mt-0.5 text-xs font-semibold text-rose-400">
                      {analysis.currSym}
                      {analysis.position.stopPrice.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* 5-Factor Checklist */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-300">
                    买入决策依据拆解（5项量化因子）
                  </div>
                  <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-md">
                    {analysis.forecast.buyDecision.factors.map((f) => (
                      <div
                        key={f.name}
                        className="px-3 py-1.5 flex items-start justify-between gap-2 text-xs"
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          {f.status === 'pass' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          ) : f.status === 'fail' ? (
                            <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                          ) : (
                            <MinusCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0">
                            <div className="text-slate-200 font-medium">{f.name}</div>
                            <div className="text-[11px] text-slate-400 truncate">{f.detail}</div>
                          </div>
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
              </div>

              {/* Pre-Trade Discipline SOP Checklist */}
              <div className="border-t border-slate-800 pt-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-300">
                    <ClipboardCheck className="w-3.5 h-3.5 text-sky-400" />
                    下单前纪律核查 (SOP)
                  </span>
                  <span className="font-mono tabular-nums text-sky-300">
                    {Number(sopChecks.eventCheck) +
                      Number(sopChecks.orderSet) +
                      Number(sopChecks.sizeApproved)}
                    /3 已确认
                  </span>
                </div>
                <div className="space-y-1 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-slate-100">
                    <input
                      type="checkbox"
                      checked={sopChecks.eventCheck}
                      onChange={(e) =>
                        setSopChecks((p) => ({ ...p, eventCheck: e.target.checked }))
                      }
                      className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                    />
                    <span>已核对财报发布日 / FOMC 等事件波动风险</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-slate-100">
                    <input
                      type="checkbox"
                      checked={sopChecks.orderSet}
                      onChange={(e) =>
                        setSopChecks((p) => ({ ...p, orderSet: e.target.checked }))
                      }
                      className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                    />
                    <span>
                      同步在券商挂好硬止损条件单（{analysis.currSym}
                      {analysis.position.stopPrice.toFixed(2)}）
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-slate-100">
                    <input
                      type="checkbox"
                      checked={sopChecks.sizeApproved}
                      onChange={(e) =>
                        setSopChecks((p) => ({ ...p, sizeApproved: e.target.checked }))
                      }
                      className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                    />
                    <span>
                      单笔风险 {formatMoney(analysis.position.riskCny)} 未超{' '}
                      {riskConfig.stockRiskPct}% 红线
                    </span>
                  </label>
                </div>

                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>量化规则不构成投资保证，实盘请严格执行止损。</span>
                </div>
              </div>
            </section>
          </div>

          {/* Row 3: ATR Volatility Anomaly Monitor & Historical Baseline Deviation */}
          <AtrAnomalyPanel
            symbol={stockData.symbol}
            stockName={stockData.name}
            currencySymbol={analysis.currSym}
            atrMultiplier={riskConfig.atrMultiplier}
            bars={enrichedBars}
          />

          {/* Row 4: Main-Force Capital Inflow/Outflow & Future Flow Forecast */}
          <FundFlowForecastPanel
            market={stockData.market}
            symbol={stockData.symbol}
            stockName={stockData.name}
            currencySymbol={analysis.currSym}
          />

          {/* Row 5: AI Pre-Market Sentiment Heat & Bull/Bear Polarity Comparison */}
          <PreMarketSentimentPanel
            market={stockData.market}
            symbol={stockData.symbol}
            stockName={stockData.name}
            onNotify={onNotify}
          />

          {/* Row 4: 8-Col Live Stock News & Earnings Panel + 4-Col Price Alerts Panel */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            <div className="xl:col-span-8">
              <StockNewsPanel
                market={stockData.market}
                symbol={stockData.symbol}
                stockName={stockData.name}
                onNotify={onNotify}
              />
            </div>

            <section className="xl:col-span-4 rounded-lg border border-slate-800 bg-[#0F172A] p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-3.5">
                <div className="flex items-start gap-2">
                  <BellRing className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      价格到达提醒 · 浏览器推送
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5 font-mono tabular-nums">
                      {stockData.symbol} 监控价 {analysis.currSym}
                      {analysis.sizingPrice.toFixed(2)}（后台轮询）
                    </p>
                  </div>
                </div>

                <div className="text-xs">
                  {notifPerm === 'granted' ? (
                    <button
                      type="button"
                      onClick={() => {
                        sendBrowserNotification(
                          `测试提醒 · ${stockData.symbol}`,
                          `${stockData.name} 当前监控价 ${analysis.currSym}${analysis.sizingPrice.toFixed(2)}，通知通道工作正常。`,
                          `test-${Date.now()}`
                        );
                        onNotify('info', '已发送浏览器测试通知', '请留意系统/浏览器右上角弹窗');
                      }}
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-emerald-400 hover:border-slate-600 transition-colors whitespace-nowrap shrink-0"
                    >
                      推送已就绪 · 测试
                    </button>
                  ) : notifPerm === 'denied' ? (
                    <span className="text-[11px] text-rose-400">浏览器权限已拦截</span>
                  ) : notifPerm === 'unsupported' ? (
                    <span className="text-[11px] text-amber-400">仅页面提示</span>
                  ) : (
                    <button
                      type="button"
                      onClick={requestNotifPermission}
                      className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-[11px] font-medium text-sky-300 hover:bg-sky-500/25 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Bell className="w-3 h-3" />
                      开启推送权限
                    </button>
                  )}
                </div>
              </div>

              <form onSubmit={handleSaveAlert} className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="alert-support" className="block text-[11px] text-slate-400 mb-1">
                      支撑位 (≤ 触发)
                    </label>
                    <input
                      id="alert-support"
                      type="number"
                      step="0.01"
                      min="0"
                      value={supportInput}
                      onChange={(e) => setSupportInput(e.target.value)}
                      placeholder={analysis.forecast.signals.support20.toFixed(2)}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm font-mono tabular-nums text-sky-300 focus:border-sky-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="alert-resistance"
                      className="block text-[11px] text-slate-400 mb-1"
                    >
                      阻力位 (≥ 触发)
                    </label>
                    <input
                      id="alert-resistance"
                      type="number"
                      step="0.01"
                      min="0"
                      value={resistanceInput}
                      onChange={(e) => setResistanceInput(e.target.value)}
                      placeholder={analysis.forecast.signals.resistance20.toFixed(2)}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm font-mono tabular-nums text-amber-300 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSupportInput(analysis.forecast.signals.support20.toFixed(2));
                      setResistanceInput(analysis.forecast.signals.resistance20.toFixed(2));
                      onNotify(
                        'info',
                        `已填入 ${stockData.symbol} 20日支撑与阻力位`,
                        `支撑 ${analysis.currSym}${analysis.forecast.signals.support20.toFixed(2)} · 阻力 ${analysis.currSym}${analysis.forecast.signals.resistance20.toFixed(2)}`
                      );
                    }}
                    className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 hover:text-white transition-colors whitespace-nowrap"
                  >
                    填入20日位
                  </button>

                  <button
                    type="submit"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors whitespace-nowrap"
                  >
                    <Bell className="w-3.5 h-3.5" />
                    {activeAlertForSelected ? '更新提醒' : '开启提醒'}
                  </button>
                </div>
              </form>

              {alerts.length > 0 && (
                <div className="border-t border-slate-800 pt-3 space-y-2">
                  <div className="text-xs text-slate-400">
                    已设规则（{alerts.filter((a) => a.enabled).length} 条监控中）
                  </div>
                  <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-md max-h-[260px] overflow-y-auto">
                    {alerts.map((a) => {
                      const sym = currencySymbolOf(a.currency);
                      const hasTriggered = Boolean(
                        a.triggeredSupportAt || a.triggeredResistanceAt
                      );
                      return (
                        <div
                          key={a.id}
                          className="px-3 py-2 flex items-center justify-between gap-2 text-xs bg-slate-900/40 hover:bg-slate-900/70 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(a.market, a.symbol)}
                            className="min-w-0 text-left"
                          >
                            <div className="font-mono font-semibold text-slate-100 truncate">
                              {MARKET_PRESETS[a.market].label} {a.symbol}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums space-x-2">
                              {a.supportPrice != null && (
                                <span className="text-sky-300">
                                  ≤{sym}
                                  {a.supportPrice.toFixed(2)}
                                </span>
                              )}
                              {a.resistancePrice != null && (
                                <span className="text-amber-300">
                                  ≥{sym}
                                  {a.resistancePrice.toFixed(2)}
                                </span>
                              )}
                            </div>
                          </button>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`text-[11px] font-medium ${
                                !a.enabled
                                  ? 'text-slate-500'
                                  : hasTriggered
                                    ? 'text-amber-300'
                                    : 'text-emerald-400'
                              }`}
                            >
                              {!a.enabled ? '暂停' : hasTriggered ? '已触发' : '监控'}
                            </span>

                            {hasTriggered && (
                              <button
                                type="button"
                                title="重置为重新监控"
                                onClick={() => handleResetAlert(a)}
                                className="p-1 text-slate-400 hover:text-sky-300 transition-colors"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            )}

                            <button
                              type="button"
                              title={a.enabled ? '暂停提醒' : '恢复提醒'}
                              onClick={() => handleToggleAlert(a)}
                              className="p-1 text-slate-400 hover:text-slate-100 transition-colors"
                            >
                              {a.enabled ? (
                                <Bell className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <BellOff className="w-3.5 h-3.5 text-slate-500" />
                              )}
                            </button>

                            <button
                              type="button"
                              title="删除提醒"
                              onClick={() => handleDeleteAlert(a.id)}
                              className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
};
