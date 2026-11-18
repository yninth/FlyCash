import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  calcDaysLeft,
  classifyTrend,
  computeIndicators,
  diagnosePortfolioHealth,
  formatMoney,
} from '../lib/quant';
import type {
  CurrencyType,
  GlobalRiskConfig,
  LedgerEntry,
  MarketType,
  StockHistoryResponse,
  ToastType,
} from '../types/trading';
import { PortfolioPieChart, type PortfolioPieSlice } from './Charts';

interface LedgerViewProps {
  entries: LedgerEntry[];
  onAddEntry: (entry: Omit<LedgerEntry, 'id' | 'createdAt'>) => void;
  onUpdateEntry: (
    id: string,
    patch: { quantity: number; costPrice: number; note: string }
  ) => void;
  onDeleteEntry: (id: string) => void;
  onImportEntries: (entries: LedgerEntry[]) => void;
  onInspectSymbol: (market: MarketType, symbol: string) => void;
  usdCny: number;
  hkdCny: number;
  riskConfig: GlobalRiskConfig;
  onNotify: (type: ToastType, title: string, detail?: string) => void;
}

interface LiveQuoteSnapshot {
  price: number;
  changePct: number;
  hv20: number | null;
  hvRank: number | null;
  trend: 'bull' | 'bear' | 'range';
  atrPct: number | null;
}

const MARKET_DEFAULT_CCY: Record<LedgerEntry['market'], CurrencyType> = {
  A股: 'CNY',
  港股: 'HKD',
  美股: 'USD',
  美股期权: 'USD',
  港股期权: 'HKD',
};

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

export const LedgerView: React.FC<LedgerViewProps> = ({
  entries,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
  onImportEntries,
  onInspectSymbol,
  usdCny,
  hkdCny,
  riskConfig,
  onNotify,
}) => {
  const [market, setMarket] = useState<LedgerEntry['market']>('美股期权');
  const [symbol, setSymbol] = useState('');
  const [currency, setCurrency] = useState<CurrencyType>('USD');
  const [quantity, setQuantity] = useState<number>(1);
  const [costPrice, setCostPrice] = useState<number>(5.0);
  const [expiryDate, setExpiryDate] = useState('');
  const [note, setNote] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live equity market prices & unrealized P&L
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveQuoteSnapshot>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [hoverMarketId, setHoverMarketId] = useState<string | null>(null);

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<number>(1);
  const [editCost, setEditCost] = useState<number>(0);
  const [editNote, setEditNote] = useState<string>('');

  const fxOf = useCallback(
    (ccy: CurrencyType) => (ccy === 'CNY' ? 1 : ccy === 'HKD' ? hkdCny : usdCny),
    [hkdCny, usdCny]
  );

  const equityTargets = useMemo(() => {
    const map = new Map<string, { market: MarketType; symbol: string }>();
    for (const item of entries) {
      const target = toRadarLookup(item.market, item.symbol);
      if (target) {
        map.set(`${target.market}:${target.symbol}`, target);
      }
    }
    return Array.from(map.values());
  }, [entries]);

  const healthSectionRef = useRef<HTMLElement>(null);

  const syncLivePrices = useCallback(
    async (announce = false, forceRefresh = false) => {
      if (equityTargets.length === 0) return;
      setQuotesLoading(true);
      try {
        const res = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: equityTargets, refresh: forceRefresh }),
        });
        if (!res.ok) throw new Error('行情同步失败');
        const json = (await res.json()) as {
          results: Array<{ ok: boolean; data?: StockHistoryResponse }>;
        };
        const nextMap: Record<string, LiveQuoteSnapshot> = {};
        let syncedCount = 0;
        for (const r of json.results || []) {
          if (!r.ok || !r.data || r.data.bars.length === 0) continue;
          const d = r.data;
          const bars = d.bars;
          const indBars = computeIndicators(bars);
          const indLast = indBars[indBars.length - 1];
          const prev = bars[bars.length - 2] || bars[bars.length - 1];
          const ext = d.extendedQuote;
          const price =
            d.market === 'US' && ext
              ? ext.preMarketPrice ?? ext.postMarketPrice ?? ext.regularPrice ?? indLast.close
              : indLast.close;
          const changePct =
            d.market === 'US' && ext?.regularChangePct != null
              ? ext.regularChangePct
              : prev.close > 0
                ? ((indLast.close - prev.close) / prev.close) * 100
                : 0;
          const atrPct =
            indLast.atr14 !== null && price > 0 ? (indLast.atr14 / price) * 100 : null;
          nextMap[`${d.market}:${d.symbol}`] = {
            price,
            changePct,
            hv20: indLast.hv20,
            hvRank: indLast.hvRank,
            trend: classifyTrend(indLast),
            atrPct,
          };
          syncedCount++;
        }
        setLiveQuotes(nextMap);
        if (announce) {
          onNotify(
            'success',
            `已同步 ${syncedCount} 只正股实时市价与波动率`,
            '组合总浮盈与持仓健康度诊断已重算'
          );
        }
      } catch {
        if (announce) {
          onNotify('error', '持仓市价同步失败', '请稍后重试');
        }
      } finally {
        setQuotesLoading(false);
      }
    },
    [equityTargets, onNotify]
  );

  useEffect(() => {
    syncLivePrices(false, false);
  }, [syncLivePrices]);

  const summary = useMemo(() => {
    let totalCostCny = 0;
    let totalMarketCny = 0;
    let totalUnrealizedPnlCny = 0;
    let pricedCostCny = 0;
    let pricedCount = 0;
    let optionCostCny = 0;

    const marketBuckets: Record<
      LedgerEntry['market'],
      { valueCny: number; costCny: number; pnlCny: number; pricedCount: number; count: number }
    > = {
      美股: { valueCny: 0, costCny: 0, pnlCny: 0, pricedCount: 0, count: 0 },
      港股: { valueCny: 0, costCny: 0, pnlCny: 0, pricedCount: 0, count: 0 },
      A股: { valueCny: 0, costCny: 0, pnlCny: 0, pricedCount: 0, count: 0 },
      美股期权: { valueCny: 0, costCny: 0, pnlCny: 0, pricedCount: 0, count: 0 },
      港股期权: { valueCny: 0, costCny: 0, pnlCny: 0, pricedCount: 0, count: 0 },
    };

    const warnings: Array<{ symbol: string; daysLeft: number; expiry: string }> = [];

    const enriched = entries.map((item) => {
      const mult = item.market.includes('期权') ? 100 : 1;
      const fx = fxOf(item.currency);
      const cnyCost = item.quantity * item.costPrice * mult * fx;
      totalCostCny += cnyCost;

      const lookup = toRadarLookup(item.market, item.symbol);
      const quote = lookup ? liveQuotes[`${lookup.market}:${lookup.symbol}`] : undefined;
      const marketValueCny = quote ? item.quantity * quote.price * mult * fx : cnyCost;
      const pnlCny = quote ? marketValueCny - cnyCost : null;
      const pnlPct =
        quote && item.costPrice > 0
          ? ((quote.price - item.costPrice) / item.costPrice) * 100
          : null;

      totalMarketCny += marketValueCny;
      if (pnlCny !== null) {
        totalUnrealizedPnlCny += pnlCny;
        pricedCostCny += cnyCost;
        pricedCount++;
      } else if (item.market.includes('期权')) {
        optionCostCny += cnyCost;
      }

      const bucket = marketBuckets[item.market];
      bucket.valueCny += marketValueCny;
      bucket.costCny += cnyCost;
      bucket.count += 1;
      if (pnlCny !== null) {
        bucket.pnlCny += pnlCny;
        bucket.pricedCount += 1;
      }

      const daysLeft = item.expiryDate ? calcDaysLeft(item.expiryDate) : null;
      if (daysLeft !== null && daysLeft <= 14) {
        warnings.push({
          symbol: item.symbol,
          daysLeft,
          expiry: item.expiryDate,
        });
      }

      return {
        ...item,
        cnyVal: cnyCost,
        marketValueCny,
        livePrice: quote?.price ?? null,
        liveChangePct: quote?.changePct ?? null,
        hv20: quote?.hv20 ?? null,
        hvRank: quote?.hvRank ?? null,
        trend: quote?.trend ?? null,
        atrPct: quote?.atrPct ?? null,
        pnlCny,
        pnlPct,
        lookup,
        daysLeft,
      };
    });

    const totalUnrealizedPct =
      totalCostCny > 0 ? (totalUnrealizedPnlCny / totalCostCny) * 100 : 0;
    const pricedEquityPct =
      pricedCostCny > 0 ? (totalUnrealizedPnlCny / pricedCostCny) * 100 : 0;

    const marketMeta: Array<{
      id: LedgerEntry['market'];
      label: string;
      color: string;
      textClass: string;
    }> = [
      { id: '美股', label: '美股正股', color: '#38BDF8', textClass: 'text-sky-300' },
      { id: '港股', label: '港股正股', color: '#10B981', textClass: 'text-emerald-300' },
      { id: 'A股', label: 'A股正股', color: '#A855F7', textClass: 'text-purple-300' },
      { id: '美股期权', label: '美股期权', color: '#F59E0B', textClass: 'text-amber-300' },
      { id: '港股期权', label: '港股期权', color: '#FB7185', textClass: 'text-rose-300' },
    ];

    const denom = Math.max(1, totalMarketCny);
    const pieSlices: Array<
      PortfolioPieSlice & { pnlCny: number; pricedCount: number; textClass: string }
    > = marketMeta.map((m) => {
      const b = marketBuckets[m.id];
      return {
        id: m.id,
        label: m.label,
        valueCny: b.valueCny,
        pct: totalMarketCny > 0 ? (b.valueCny / denom) * 100 : 0,
        color: m.color,
        textClass: m.textClass,
        count: b.count,
        pnlCny: b.pnlCny,
        pricedCount: b.pricedCount,
      };
    });

    const optionMarketCny =
      marketBuckets['美股期权'].valueCny + marketBuckets['港股期权'].valueCny;
    const utilizationPct =
      riskConfig.totalCapitalCny > 0
        ? (totalMarketCny / riskConfig.totalCapitalCny) * 100
        : 0;

    const healthDiagnosis = diagnosePortfolioHealth({
      holdings: enriched.map((e) => ({
        symbol: e.symbol,
        marketLabel: e.market,
        radarMarket: e.lookup?.market,
        radarSymbol: e.lookup?.symbol,
        marketValueCny: e.marketValueCny,
        pnlPct: e.pnlPct,
        isOption: e.market.includes('期权'),
        daysLeft: e.daysLeft,
        hv20: e.hv20,
        hvRank: e.hvRank,
        trend: e.trend,
        atrPct: e.atrPct,
      })),
      totalCapitalCny: riskConfig.totalCapitalCny,
      totalMarketCny,
      optionMarketCny,
      utilizationPct,
    });

    return {
      enriched,
      totalCostCny,
      totalMarketCny,
      totalUnrealizedPnlCny,
      totalUnrealizedPct,
      pricedEquityPct,
      pricedCount,
      hasLivePrices: pricedCostCny > 0,
      optionCostCny,
      pieSlices,
      utilizationPct,
      healthDiagnosis,
      warnings,
    };
  }, [entries, fxOf, liveQuotes, riskConfig.totalCapitalCny]);

  const handleRunHealthDiagnosis = async () => {
    await syncLivePrices(false, true);
    healthSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const d = summary.healthDiagnosis;
    onNotify(
      d.overallLevel === 'alert'
        ? 'warning'
        : d.overallLevel === 'caution'
          ? 'info'
          : 'success',
      `持仓健康度诊断完成：${d.overallLabel}`,
      d.weightedHv20 !== null
        ? `加权波动率 HV20 ${d.weightedHv20.toFixed(1)}% · 多头趋势占比 ${d.bullSharePct.toFixed(0)}%`
        : d.riskDisclosures[0]?.title
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim()) {
      onNotify('warning', '请填写标的代码或期权合约名称');
      return;
    }
    const cleanSym = symbol.trim().toUpperCase();
    onAddEntry({
      market,
      symbol: cleanSym,
      currency,
      quantity,
      costPrice,
      expiryDate: market.includes('期权') ? expiryDate.trim() : '',
      note: note.trim() || '手动录入',
    });
    onNotify(
      'success',
      `已保存持仓：${cleanSym}`,
      `${market} · ${quantity} ${market.includes('期权') ? '张' : '股'}`
    );
    setSymbol('');
    setExpiryDate('');
    setNote('');
  };

  const handleStartEdit = (item: LedgerEntry) => {
    setEditingId(item.id);
    setEditQty(item.quantity);
    setEditCost(item.costPrice);
    setEditNote(item.note);
  };

  const handleSaveEdit = (item: LedgerEntry) => {
    if (editQty <= 0) {
      onNotify('warning', '持仓数量需大于 0（若已清仓请点击右侧删除）');
      return;
    }
    onUpdateEntry(item.id, {
      quantity: editQty,
      costPrice: Math.max(0, editCost),
      note: editNote.trim() || item.note,
    });
    setEditingId(null);
    onNotify('success', `已更新 ${item.symbol} 持仓数量/成本`);
  };

  const handleExportCsv = () => {
    const header = [
      '市场',
      '代码/合约',
      '币种',
      '数量',
      '成本单价',
      '最新市价',
      '期权到期日',
      '折合人民币市值(CNY)',
      '浮动盈亏(CNY)',
      '备注',
    ];
    const rows = summary.enriched.map((r) => [
      r.market,
      r.symbol,
      r.currency,
      String(r.quantity),
      String(r.costPrice),
      r.livePrice !== null ? r.livePrice.toFixed(2) : '',
      r.expiryDate,
      String(Math.round(r.marketValueCny)),
      r.pnlCny !== null ? String(Math.round(r.pnlCny)) : '',
      r.note.replace(/,/g, ' '),
    ]);
    const csvContent =
      '\uFEFF' + [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `futu_crossmarket_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify('success', '已导出持仓台账 CSV', `共 ${summary.enriched.length} 条记录`);
  };

  const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '').replace(/^\uFEFF/, '');
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) {
          setImportStatus('CSV 文件为空或格式不正确');
          onNotify('warning', 'CSV 文件为空或格式不正确');
          return;
        }
        const imported: LedgerEntry[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map((c) => c.trim());
          if (cols.length < 5 || !cols[1]) continue;
          const mkt = (['A股', '港股', '美股', '美股期权', '港股期权'].includes(cols[0])
            ? cols[0]
            : '美股') as LedgerEntry['market'];
          const ccy = (['CNY', 'HKD', 'USD'].includes(cols[2])
            ? cols[2]
            : MARKET_DEFAULT_CCY[mkt]) as CurrencyType;
          imported.push({
            id: `${Date.now()}-${i}`,
            market: mkt,
            symbol: cols[1],
            currency: ccy,
            quantity: Number(cols[3]) || 1,
            costPrice: Number(cols[4]) || 0,
            expiryDate: cols[5] || '',
            note: cols[cols.length - 1] || 'CSV 导入',
            createdAt: new Date().toISOString().slice(0, 10),
          });
        }
        if (imported.length > 0) {
          onImportEntries(imported);
          setImportStatus(`成功导入 ${imported.length} 条持仓记录`);
          onNotify('success', `成功导入 ${imported.length} 条持仓记录`);
        } else {
          setImportStatus('未解析到有效持仓行');
          onNotify('warning', '未解析到有效持仓行');
        }
      } catch {
        setImportStatus('CSV 解析失败，请检查文件编码');
        onNotify('error', 'CSV 解析失败，请检查文件编码');
      }
      e.target.value = '';
    };
    reader.readAsText(file, 'utf-8');
  };

  return (
    <div className="space-y-6">
      {/* Expiry Alerts */}
      {summary.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-800/80 bg-amber-950/30 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>期权临近到期预警（剩余 ≤ 14 天，时间价值加速衰减）</span>
          </div>
          <div className="space-y-1 text-xs text-amber-200/90 font-mono tabular-nums">
            {summary.warnings.map((w, idx) => (
              <div key={idx}>
                {w.symbol} · 到期日 {w.expiry} ·{' '}
                {w.daysLeft <= 0
                  ? '已到期或今日到期，请立即处理！'
                  : `仅剩 ${w.daysLeft} 天，建议评估平仓或移仓 (Roll)`}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Portfolio Overview Card (组合概览) */}
      <section className="rounded-lg border border-slate-800 bg-[#0F172A] p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">组合概览</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
              <span>共 {summary.enriched.length} 笔持仓</span>
              <span aria-hidden="true">·</span>
              <span>USD/CNY {usdCny.toFixed(4)}</span>
              <span aria-hidden="true">·</span>
              <span>HKD/CNY {hkdCny.toFixed(4)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRunHealthDiagnosis}
              disabled={quotesLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Activity className="w-3.5 h-3.5" />
              持仓健康度诊断
            </button>

            <button
              type="button"
              onClick={() => syncLivePrices(true, true)}
              disabled={quotesLoading || equityTargets.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${quotesLoading ? 'animate-spin' : ''}`} />
              {quotesLoading ? '更新实时估值...' : '刷新估值与盈亏'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left 7 Cols: Total Market Value, Total P&L Estimation & Utilization */}
          <div className="lg:col-span-7 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-800">
              <div className="sm:pr-4 py-1">
                <div className="text-xs text-slate-400">当前账本总市值 (CNY)</div>
                <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-100">
                  {formatMoney(summary.totalMarketCny)}
                </div>
                <div className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
                  持仓成本 {formatMoney(summary.totalCostCny)}
                </div>
              </div>

              <div className="sm:px-4 py-1">
                <div className="text-xs text-slate-400">总盈亏预估 (CNY)</div>
                <div
                  className={`mt-1 text-2xl font-semibold font-mono tabular-nums ${
                    !summary.hasLivePrices
                      ? 'text-slate-400'
                      : summary.totalUnrealizedPnlCny >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                  }`}
                >
                  {summary.hasLivePrices ? (
                    <>
                      {summary.totalUnrealizedPnlCny >= 0 ? '+' : ''}
                      {formatMoney(summary.totalUnrealizedPnlCny)}
                    </>
                  ) : (
                    '等待同步'
                  )}
                </div>
                <div className="mt-1 text-xs font-mono tabular-nums text-slate-400">
                  {summary.hasLivePrices ? (
                    <span
                      className={
                        summary.totalUnrealizedPnlCny >= 0
                          ? 'text-emerald-400/90'
                          : 'text-rose-400/90'
                      }
                    >
                      占总成本 {summary.totalUnrealizedPct >= 0 ? '+' : ''}
                      {summary.totalUnrealizedPct.toFixed(2)}%
                    </span>
                  ) : (
                    '点击右上角拉取最新市价'
                  )}
                </div>
              </div>

              <div className="sm:pl-4 py-1">
                <div className="text-xs text-slate-400">总本金仓位占比</div>
                <div
                  className={`mt-1 text-2xl font-semibold font-mono tabular-nums ${
                    summary.utilizationPct > 85 ? 'text-rose-400' : 'text-sky-300'
                  }`}
                >
                  {summary.utilizationPct.toFixed(1)}%
                </div>
                <div className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
                  基准本金 {formatMoney(riskConfig.totalCapitalCny)}
                </div>
              </div>
            </div>

            {/* Per-Market Distribution Breakdown Table */}
            <div className="border-t border-slate-800 pt-4">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="font-medium text-slate-300">各市场资产与盈亏明细</span>
                <span>期权合约按开仓权利金计入市值</span>
              </div>
              <div className="divide-y divide-slate-800/80">
                {summary.pieSlices
                  .filter((s) => s.count > 0)
                  .map((s) => (
                    <div
                      key={s.id}
                      onMouseEnter={() => setHoverMarketId(s.id)}
                      onMouseLeave={() => setHoverMarketId(null)}
                      className={`py-2 flex items-center justify-between gap-4 text-xs transition-colors ${
                        hoverMarketId === s.id ? 'bg-slate-800/40 px-2 -mx-2 rounded' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="font-medium text-slate-200 whitespace-nowrap">
                          {s.label}
                        </span>
                        <span className="text-slate-500 font-mono tabular-nums">
                          {s.count} 笔
                        </span>
                      </div>

                      <div className="flex items-center gap-5 font-mono tabular-nums shrink-0">
                        <span className="text-slate-200 font-medium">
                          {formatMoney(s.valueCny)}
                        </span>
                        <span className={`w-14 text-right font-semibold ${s.textClass}`}>
                          {s.pct.toFixed(1)}%
                        </span>
                        <span
                          className={`w-24 text-right ${
                            s.pricedCount === 0
                              ? 'text-slate-500'
                              : s.pnlCny >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                          }`}
                        >
                          {s.pricedCount === 0
                            ? '按成本计'
                            : `${s.pnlCny >= 0 ? '+' : ''}${formatMoney(s.pnlCny)}`}
                        </span>
                      </div>
                    </div>
                  ))}
                {summary.enriched.length === 0 && (
                  <div className="py-4 text-xs text-slate-500 text-center">
                    暂无持仓记录，添加持仓后将自动生成各市场分布统计。
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right 5 Cols: Market Distribution Pie Chart */}
          <div className="lg:col-span-5 flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center justify-center gap-5 border-t lg:border-t-0 lg:border-l border-slate-800 pt-4 lg:pt-0 lg:pl-6">
            <PortfolioPieChart
              slices={summary.pieSlices}
              totalMarketCny={summary.totalMarketCny}
              activeId={hoverMarketId}
              onHoverId={setHoverMarketId}
            />

            <div className="space-y-2 text-xs min-w-[140px]">
              <div className="text-slate-400 font-medium mb-1">各市场占比分布</div>
              {summary.pieSlices
                .filter((s) => s.valueCny > 0)
                .map((s) => (
                  <div
                    key={s.id}
                    onMouseEnter={() => setHoverMarketId(s.id)}
                    onMouseLeave={() => setHoverMarketId(null)}
                    className={`flex items-center justify-between gap-3 cursor-pointer py-0.5 transition-opacity ${
                      hoverMarketId && hoverMarketId !== s.id ? 'opacity-50' : 'opacity-100'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2 text-slate-300 whitespace-nowrap">
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.label}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-slate-100">
                      {s.pct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              {summary.totalMarketCny === 0 && (
                <div className="text-slate-500">暂无分布数据</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Portfolio Health Diagnosis (持仓健康度诊断) */}
      <section
        ref={healthSectionRef}
        className="rounded-lg border border-slate-800 bg-[#0F172A] p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              持仓健康度诊断
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              基于实时波动率 (HV20)、均线多空趋势与仓位集中度自动评估组合抗风险能力
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium">
            {summary.healthDiagnosis.overallLevel === 'healthy' ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {summary.healthDiagnosis.overallLabel}
              </span>
            ) : summary.healthDiagnosis.overallLevel === 'caution' ? (
              <span className="inline-flex items-center gap-1.5 text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {summary.healthDiagnosis.overallLabel}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-rose-400">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                {summary.healthDiagnosis.overallLabel}
              </span>
            )}
          </div>
        </div>

        {/* 4-Column Quantitative Risk Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-800 border-b border-slate-800 pb-4">
          <div className="pr-4 py-1">
            <div className="text-xs text-slate-400">正股加权年化波动 (HV20)</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-100">
              {summary.healthDiagnosis.weightedHv20 !== null
                ? `${summary.healthDiagnosis.weightedHv20.toFixed(1)}%`
                : '等待行情'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400 font-mono tabular-nums">
              {summary.healthDiagnosis.dailyVar95Cny !== null
                ? `单日95% VaR 约 ${formatMoney(summary.healthDiagnosis.dailyVar95Cny)}`
                : '同期权不计入 HV 均权'}
            </div>
          </div>

          <div className="lg:px-4 py-1">
            <div className="text-xs text-slate-400">当前市场趋势顺逆结构</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">
              <span className="text-emerald-400">
                {summary.healthDiagnosis.bullSharePct.toFixed(0)}% 多头
              </span>
              <span className="text-slate-500 mx-1.5">/</span>
              <span
                className={
                  summary.healthDiagnosis.bearSharePct > 0
                    ? 'text-rose-400'
                    : 'text-slate-400'
                }
              >
                {summary.healthDiagnosis.bearSharePct.toFixed(0)}% 空头
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400 font-mono tabular-nums">
              震荡整理占比 {summary.healthDiagnosis.rangeSharePct.toFixed(0)}%
            </div>
          </div>

          <div className="lg:px-4 py-1">
            <div className="text-xs text-slate-400">单一最大持仓集中度</div>
            <div
              className={`mt-1 text-lg font-semibold font-mono tabular-nums ${
                summary.healthDiagnosis.maxPositionPct > 40
                  ? 'text-amber-300'
                  : 'text-slate-100'
              }`}
            >
              {summary.healthDiagnosis.maxPositionSymbol ?? '—'}
              {summary.healthDiagnosis.maxPositionSymbol && (
                <span className="ml-2">
                  {summary.healthDiagnosis.maxPositionPct.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              建议单票上限 ≤ 35%
            </div>
          </div>

          <div className="lg:pl-4 py-1">
            <div className="text-xs text-slate-400">期权权利金总占比</div>
            <div
              className={`mt-1 text-lg font-semibold font-mono tabular-nums ${
                summary.healthDiagnosis.optionSharePct > 15
                  ? 'text-amber-300'
                  : 'text-slate-100'
              }`}
            >
              {summary.healthDiagnosis.optionSharePct.toFixed(1)}%
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              临期预警 {summary.warnings.length} 笔
            </div>
          </div>
        </div>

        {/* 2-Column Risk Disclosures & Portfolio Adjustments */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Risk Disclosures */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-300">
              风险披露与隐患排查
            </h3>
            <div className="divide-y divide-slate-800/80">
              {summary.healthDiagnosis.riskDisclosures.map((item, idx) => (
                <div key={idx} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                  <div
                    className={`text-xs font-semibold flex items-center gap-1.5 ${
                      item.severity === 'high'
                        ? 'text-rose-400'
                        : item.severity === 'medium'
                          ? 'text-amber-300'
                          : 'text-emerald-400'
                    }`}
                  >
                    <span>
                      {item.severity === 'high'
                        ? '[高危]'
                        : item.severity === 'medium'
                          ? '[提示]'
                          : '[稳健]'}
                    </span>
                    <span>{item.title}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Adjustment Suggestions */}
          <div className="space-y-3 lg:border-l lg:border-slate-800 lg:pl-6">
            <h3 className="text-xs font-semibold text-slate-300">
              持仓结构调整建议
            </h3>
            <div className="divide-y divide-slate-800/80">
              {summary.healthDiagnosis.adjustments.map((adj, idx) => (
                <div key={idx} className="py-2.5 first:pt-0 last:pb-0 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-sky-300">
                      {idx + 1}. {adj.action}
                    </span>
                    {adj.market && adj.symbol && (
                      <button
                        type="button"
                        onClick={() => {
                          onInspectSymbol(adj.market!, adj.symbol!);
                          onNotify(
                            'info',
                            `已跳转至 ${adj.symbol} 正股雷达`,
                            '可查看最新支撑/阻力位并调整止损'
                          );
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-300 hover:text-sky-300 underline underline-offset-2 whitespace-nowrap shrink-0"
                      >
                        去雷达诊断 {adj.symbol}
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {adj.rationale}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Add Holding Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-slate-800 bg-[#0F172A] p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-100">
            我的账本 · 新增持仓记录
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {importStatus && (
              <span className="text-xs text-sky-300 mr-2">{importStatus}</span>
            )}
            <button
              type="button"
              onClick={() => syncLivePrices(true, true)}
              disabled={quotesLoading || equityTargets.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${quotesLoading ? 'animate-spin' : ''}`} />
              {quotesLoading ? '同步市价中...' : '同步实时市价'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImportCsv}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              导入 CSV
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              导出 CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">市场类别</label>
            <select
              value={market}
              onChange={(e) => {
                const m = e.target.value as LedgerEntry['market'];
                setMarket(m);
                setCurrency(MARKET_DEFAULT_CCY[m]);
              }}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="美股期权">美股期权</option>
              <option value="美股">美股</option>
              <option value="港股">港股</option>
              <option value="港股期权">港股期权</option>
              <option value="A股">A股</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">代码 / 合约名称</label>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="如 NVDA 140C 或 0700.HK"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">计价币种</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyType)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="USD">USD</option>
              <option value="HKD">HKD</option>
              <option value="CNY">CNY</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {market.includes('期权') ? '张数 (1张=100股)' : '股数'}
            </label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">成本单价</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={costPrice}
              onChange={(e) => setCostPrice(Math.max(0, Number(e.target.value) || 0))}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">期权到期日</label>
            <input
              type="date"
              disabled={!market.includes('期权')}
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono text-slate-100 disabled:opacity-40 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            保存持仓
          </button>
        </div>
      </form>

      {/* Ledger Data Grid */}
      <div className="rounded-lg border border-slate-800 bg-[#0F172A] overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-100">
            统一跨币种持仓台账（自动按汇率 USD/CNY={usdCny.toFixed(2)} · HKD/CNY={hkdCny.toFixed(2)} 核算，点击正股代码可跳转雷达诊断）
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            共 {summary.enriched.length} 笔
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
              <tr>
                <th className="py-2.5 px-4 font-medium">市场</th>
                <th className="py-2.5 px-4 font-medium">代码 / 合约</th>
                <th className="py-2.5 px-3 font-medium text-right">数量</th>
                <th className="py-2.5 px-3 font-medium text-right">成本单价</th>
                <th className="py-2.5 px-3 font-medium text-right">实时现价</th>
                <th className="py-2.5 px-3 font-medium text-right">浮动盈亏 (CNY)</th>
                <th className="py-2.5 px-3 font-medium text-right">折合市值 (CNY)</th>
                <th className="py-2.5 px-3 font-medium">到期日</th>
                <th className="py-2.5 px-3 font-medium">备注</th>
                <th className="py-2.5 px-4 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {summary.enriched.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400">
                    当前账本暂无记录，可在上方新增持仓，或从“首页快速诊断 / 策略模型”页一键记入账本。
                  </td>
                </tr>
              ) : (
                summary.enriched.map((item) => {
                  const ccySign =
                    item.currency === 'CNY' ? '¥' : item.currency === 'HKD' ? 'HK$' : '$';
                  const isEditing = editingId === item.id;
                  return (
                    <tr key={item.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 text-slate-300">{item.market}</td>
                      <td className="py-2.5 px-4 font-mono font-semibold">
                        {item.lookup ? (
                          <button
                            type="button"
                            onClick={() => {
                              onInspectSymbol(item.lookup!.market, item.lookup!.symbol);
                              onNotify('info', `已从账本跳转至 ${item.symbol} 正股雷达`);
                            }}
                            className="text-sky-300 hover:text-sky-200 underline underline-offset-2 text-left"
                          >
                            {item.symbol}
                          </button>
                        ) : (
                          <span className="text-slate-100">{item.symbol}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200">
                        {isEditing ? (
                          <input
                            type="number"
                            min={1}
                            value={editQty}
                            onChange={(e) => setEditQty(Math.max(1, Number(e.target.value) || 1))}
                            className="w-20 rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-right text-xs text-slate-100"
                          />
                        ) : (
                          `${item.quantity.toLocaleString()} ${item.market.includes('期权') ? '张' : '股'}`
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            value={editCost}
                            onChange={(e) => setEditCost(Math.max(0, Number(e.target.value) || 0))}
                            className="w-20 rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-right text-xs text-slate-100"
                          />
                        ) : (
                          `${ccySign}${item.costPrice.toFixed(2)}`
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {item.livePrice !== null ? (
                          <div>
                            <div className="text-slate-100">
                              {ccySign}
                              {item.livePrice.toFixed(2)}
                            </div>
                            {item.liveChangePct !== null && (
                              <div
                                className={`text-[10px] ${
                                  item.liveChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {item.liveChangePct >= 0 ? '+' : ''}
                                {item.liveChangePct.toFixed(2)}%
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500">按成本</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {item.pnlCny !== null && item.pnlPct !== null ? (
                          <span
                            className={`font-semibold ${
                              item.pnlCny >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {item.pnlCny >= 0 ? '+' : ''}
                            {formatMoney(item.pnlCny)} ({item.pnlPct >= 0 ? '+' : ''}
                            {item.pnlPct.toFixed(1)}%)
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-100 font-semibold">
                        {formatMoney(item.marketValueCny)}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums">
                        {item.expiryDate ? (
                          <span
                            className={
                              item.daysLeft !== null && item.daysLeft <= 14
                                ? 'text-amber-400 font-semibold'
                                : 'text-slate-300'
                            }
                          >
                            {item.expiryDate} ({item.daysLeft}天)
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 max-w-[180px] truncate">
                        {isEditing ? (
                          <input
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            className="w-36 rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs text-slate-100"
                          />
                        ) : (
                          item.note
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(item)}
                              title="保存修改"
                              className="p-1 text-emerald-400 hover:text-emerald-300"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              title="取消编辑"
                              className="p-1 text-slate-400 hover:text-slate-200"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleStartEdit(item)}
                              title="调仓 / 修改成本"
                              className="p-1 text-slate-500 hover:text-sky-400 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteEntry(item.id);
                                onNotify('info', `已删除持仓记录：${item.symbol}`);
                              }}
                              title="删除记录"
                              className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
