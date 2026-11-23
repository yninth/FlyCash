import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, Search } from 'lucide-react';
import {
  computeIndicators,
  enrichOptionChain,
  formatMoney,
  simulatePayoffCurves,
} from '../lib/quant';
import type {
  EnrichedOptionContract,
  GlobalRiskConfig,
  IndicatorBar,
  LedgerEntry,
  OptionRight,
  OptionsChainResponse,
  StockHistoryResponse,
  ToastType,
} from '../types/trading';
import { OptionPayoffChart } from './Charts';
import { OptionGreeksCurvesPanel } from './OptionGreeksCurvesPanel';
import { VolatilityCalendarHeatmap } from './VolatilityCalendarHeatmap';

interface OptionsLabViewProps {
  riskConfig: GlobalRiskConfig;
  usdCny: number;
  initialSymbol: string;
  onAddToLedger: (entry: Omit<LedgerEntry, 'id' | 'createdAt'>) => void;
  onNotify: (type: ToastType, title: string, detail?: string) => void;
}

const US_OPTION_PRESETS = ['NVDA', 'QQQ', 'SPY', 'AAPL', 'TSLA', 'MSFT', 'META'];

export const OptionsLabView: React.FC<OptionsLabViewProps> = ({
  riskConfig,
  usdCny,
  initialSymbol,
  onAddToLedger,
  onNotify,
}) => {
  const [symbolInput, setSymbolInput] = useState(initialSymbol || 'NVDA');
  const [right, setRight] = useState<OptionRight>('call');
  const [deltaFilter, setDeltaFilter] = useState<'all' | 'sweet' | 'itm'>('sweet');

  const [chainData, setChainData] = useState<OptionsChainResponse | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [indicatorBars, setIndicatorBars] = useState<IndicatorBar[]>([]);
  const [hv20, setHv20] = useState<number | null>(null);
  const [hvRank, setHvRank] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Simulator controls
  const [selectedStrike, setSelectedStrike] = useState<number>(0);
  const [entryPremium, setEntryPremium] = useState<number>(1.0);
  const [contracts, setContracts] = useState<number>(1);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (initialSymbol) {
      setSymbolInput(initialSymbol);
    }
  }, [initialSymbol]);

  const loadOptions = useCallback(
    async (sym: string, date?: string, announce = false) => {
      const clean = sym.trim().toUpperCase();
      if (!clean) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ symbol: clean });
        if (date) params.set('date', date);
        if (announce) params.set('refresh', '1');
        const optUrl = `/api/options?${params.toString()}`;

        const [optRes, histRes] = await Promise.all([
          fetch(optUrl),
          fetch(
            `/api/stock?market=US&symbol=${encodeURIComponent(clean)}&days=400${
              announce ? '&refresh=1' : ''
            }`
          ),
        ]);

        const optJson = (await optRes.json()) as OptionsChainResponse & { error?: string };
        if (!optRes.ok) throw new Error(optJson.error || '期权链请求失败');

        // If user didn't pass a specific date and there's a 25-65 DTE sweet spot expiry, fetch it automatically
        let finalChain = optJson;
        if (!date && optJson.expirationDates.length > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const sweetExp = optJson.expirationDates.find((exp) => {
            const dte = Math.round(
              (new Date(`${exp}T00:00:00`).getTime() - today.getTime()) / (24 * 3600 * 1000)
            );
            return dte >= 25 && dte <= 65;
          });
          if (sweetExp && sweetExp !== optJson.selectedExpiry) {
            const sweetRes = await fetch(
              `/api/options?symbol=${encodeURIComponent(clean)}&date=${encodeURIComponent(sweetExp)}`
            );
            if (sweetRes.ok) {
              finalChain = (await sweetRes.json()) as OptionsChainResponse;
            }
          }
        }

        setChainData(finalChain);
        setSelectedExpiry(finalChain.selectedExpiry);

        if (histRes.ok) {
          const histJson = (await histRes.json()) as StockHistoryResponse;
          const ind = computeIndicators(histJson.bars);
          setIndicatorBars(ind);
          const last = ind[ind.length - 1];
          setHv20(last?.hv20 ?? null);
          setHvRank(last?.hvRank ?? null);
        } else {
          setIndicatorBars([]);
          setHv20(null);
          setHvRank(null);
        }

        if (announce) {
          onNotify(
            'success',
            `已加载 ${finalChain.symbol} 期权链`,
            `到期日 ${finalChain.selectedExpiry} · 现价 $${finalChain.spotPrice.toFixed(2)}`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '期权数据加载失败';
        setError(msg);
        if (announce) {
          onNotify('error', `加载 ${clean} 期权链失败`, msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [onNotify]
  );

  useEffect(() => {
    loadOptions(symbolInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enrichedContracts = useMemo(() => {
    if (!chainData) return [];
    const raw = right === 'call' ? chainData.calls : chainData.puts;
    const all = enrichOptionChain(raw, chainData.spotPrice, chainData.selectedExpiry, right);
    // Keep reasonable strike window +/- 30% around spot
    return all.filter(
      (c) =>
        c.strike >= chainData.spotPrice * 0.7 &&
        c.strike <= chainData.spotPrice * 1.3
    );
  }, [chainData, right]);

  const filteredContracts = useMemo(() => {
    return enrichedContracts.filter((c) => {
      const absDelta = Math.abs(c.delta);
      if (deltaFilter === 'sweet') return absDelta >= 0.22 && absDelta <= 0.68;
      if (deltaFilter === 'itm') return absDelta > 0.65;
      return true;
    });
  }, [enrichedContracts, deltaFilter]);

  const maxOptBudgetCny = riskConfig.totalCapitalCny * (riskConfig.optionRiskPct / 100);
  const maxOptBudgetUsd = maxOptBudgetCny / Math.max(0.1, usdCny);

  // Sync default selected strike to closest ATM when chain or right changes
  useEffect(() => {
    if (!chainData || enrichedContracts.length === 0) return;
    let best = enrichedContracts[0];
    let minDiff = Infinity;
    for (const c of enrichedContracts) {
      const diff = Math.abs(c.strike - chainData.spotPrice);
      if (diff < minDiff) {
        minDiff = diff;
        best = c;
      }
    }
    setSelectedStrike(best.strike);
    const prem = best.midPrice > 0 ? Number(best.midPrice.toFixed(2)) : 1.0;
    setEntryPremium(prem);
    const suggestedQty = Math.max(1, Math.floor(maxOptBudgetUsd / (prem * 100)));
    setContracts(suggestedQty);
  }, [chainData, right, enrichedContracts, maxOptBudgetUsd]);

  const selectedContract: EnrichedOptionContract | null = useMemo(() => {
    return (
      enrichedContracts.find((c) => c.strike === selectedStrike) ||
      enrichedContracts[0] ||
      null
    );
  }, [enrichedContracts, selectedStrike]);

  // Calculate ATM IV for IV vs HV check
  const atmIvPct = useMemo(() => {
    if (!chainData || enrichedContracts.length === 0) return null;
    let best = enrichedContracts[0];
    let minDiff = Infinity;
    for (const c of enrichedContracts) {
      const diff = Math.abs(c.strike - chainData.spotPrice);
      if (diff < minDiff) {
        minDiff = diff;
        best = c;
      }
    }
    return best.ivPct;
  }, [chainData, enrichedContracts]);

  const payoff = useMemo(() => {
    if (!chainData || !selectedContract) return null;
    return simulatePayoffCurves({
      spot: chainData.spotPrice,
      strike: selectedStrike || selectedContract.strike,
      entryPremium: Math.max(0.01, entryPremium),
      contracts: Math.max(1, contracts),
      dte: selectedContract.dte,
      iv: Math.max(0.05, selectedContract.ivPct / 100),
      right,
    });
  }, [chainData, selectedContract, selectedStrike, entryPremium, contracts, right]);

  const handleSelectRow = (c: EnrichedOptionContract) => {
    setSelectedStrike(c.strike);
    const prem = c.midPrice > 0 ? Number(c.midPrice.toFixed(2)) : 1.0;
    setEntryPremium(prem);
    const suggested = Math.max(1, Math.floor(maxOptBudgetUsd / (prem * 100)));
    setContracts(suggested);
    onNotify(
      'info',
      `已载入 $${c.strike.toFixed(2)} ${right === 'call' ? 'Call' : 'Put'} 到盈亏模拟器`,
      `Delta ${c.delta.toFixed(2)} · 建议 ${suggested} 张`
    );
  };

  const handleLogToLedger = () => {
    if (!chainData || !selectedContract) return;
    const contractLabel = `${chainData.symbol} ${selectedContract.strike}${right === 'call' ? 'C' : 'P'}`;
    onAddToLedger({
      market: '美股期权',
      symbol: contractLabel,
      currency: 'USD',
      quantity: contracts,
      costPrice: entryPremium,
      expiryDate: chainData.selectedExpiry,
      optionRight: right,
      strike: selectedContract.strike,
      deltaEstimate: Number(selectedContract.delta.toFixed(2)),
      note: `IV ${selectedContract.ivPct.toFixed(1)}% · 我的账本录入`,
    });
    setSavedNotice(`已将 ${contractLabel} 记入我的账本`);
    onNotify(
      'success',
      `已记入我的账本：${contractLabel}`,
      `${contracts} 张 · 单价 $${entryPremium.toFixed(2)} · 到期 ${chainData.selectedExpiry}`
    );
    setTimeout(() => setSavedNotice(null), 3500);
  };

  const ivSpread = atmIvPct !== null && hv20 !== null ? atmIvPct - hv20 : null;
  const totalCostUsd = entryPremium * 100 * contracts;
  const totalCostCny = totalCostUsd * usdCny;
  const totalDailyThetaUsd = (selectedContract?.thetaPerDay ?? 0) * 100 * contracts;

  return (
    <div className="space-y-6">
      {/* Search & Controls */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadOptions(symbolInput, undefined, true);
        }}
        className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-[#0F172A] p-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="opt-symbol" className="block text-xs text-slate-400 mb-1.5">
              美股正股代码
            </label>
            <input
              id="opt-symbol"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              placeholder="NVDA / QQQ"
              className="w-36 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">期权方向</label>
            <div className="flex items-center rounded-md bg-slate-900 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => setRight('call')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  right === 'call'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                看涨 Call
              </button>
              <button
                type="button"
                onClick={() => setRight('put')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  right === 'put'
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                看跌 Put
              </button>
            </div>
          </div>

          {chainData && chainData.expirationDates.length > 0 && (
            <div>
              <label htmlFor="opt-exp" className="block text-xs text-slate-400 mb-1.5">
                到期日 (Expiry)
              </label>
              <select
                id="opt-exp"
                value={selectedExpiry}
                onChange={(e) => {
                  setSelectedExpiry(e.target.value);
                  loadOptions(chainData.symbol, e.target.value, true);
                }}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                {chainData.expirationDates.map((exp) => (
                  <option key={exp} value={exp}>
                    {exp}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Search className="w-4 h-4" />
            {loading ? '加载期权链...' : '查询期权链'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">热门期权:</span>
          {US_OPTION_PRESETS.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                setSymbolInput(code);
                loadOptions(code, undefined, true);
              }}
              className="px-2 py-1 rounded border border-slate-800 bg-slate-900/70 font-mono text-slate-300 hover:border-sky-500/50 hover:text-sky-300 transition-colors whitespace-nowrap shrink-0"
            >
              {code}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-rose-900/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {chainData && (
        <>
          {/* IV vs HV20 Crush Guardrail & Budget Strip */}
          <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-4 grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-800 gap-4 md:gap-0">
            <div className="md:pr-4">
              <div className="text-xs text-slate-400">
                {chainData.symbol} 正股现价 / 剩余天数
              </div>
              <div className="mt-1 font-mono tabular-nums text-lg font-semibold text-slate-100">
                ${chainData.spotPrice.toFixed(2)}
                <span className="text-sm text-sky-400 ml-2">
                  DTE {selectedContract?.dte ?? '—'} 天
                </span>
              </div>
              {chainData.extendedQuote?.preMarketPrice != null && (
                <div className="mt-1 text-[11px] font-mono tabular-nums text-sky-300">
                  盘前 ${chainData.extendedQuote.preMarketPrice.toFixed(2)}
                  {chainData.extendedQuote.preMarketChangePct != null && (
                    <span
                      className={`ml-1.5 ${
                        chainData.extendedQuote.preMarketChangePct >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      ({chainData.extendedQuote.preMarketChangePct >= 0 ? '+' : ''}
                      {chainData.extendedQuote.preMarketChangePct.toFixed(2)}%)
                    </span>
                  )}
                </div>
              )}
              {chainData.extendedQuote?.preMarketPrice == null &&
                chainData.extendedQuote?.postMarketPrice != null && (
                  <div className="mt-1 text-[11px] font-mono tabular-nums text-amber-300">
                    盘后 ${chainData.extendedQuote.postMarketPrice.toFixed(2)}
                    {chainData.extendedQuote.postMarketChangePct != null && (
                      <span
                        className={`ml-1.5 ${
                          chainData.extendedQuote.postMarketChangePct >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }`}
                      >
                        ({chainData.extendedQuote.postMarketChangePct >= 0 ? '+' : ''}
                        {chainData.extendedQuote.postMarketChangePct.toFixed(2)}%)
                      </span>
                    )}
                  </div>
                )}
            </div>

            <div className="md:px-4">
              <div className="text-xs text-slate-400">正股实际波动 HV20 (年内分位)</div>
              <div className="mt-1 font-mono tabular-nums text-lg font-semibold text-slate-100">
                {hv20 !== null ? `${hv20.toFixed(1)}%` : 'N/A'}
                <span className="text-xs text-slate-400 ml-2">
                  分位 {hvRank !== null ? `${hvRank.toFixed(0)}%` : '—'}
                </span>
              </div>
            </div>

            <div className="md:px-4">
              <div className="text-xs text-slate-400">平值期权隐含波动率 IV vs HV</div>
              <div className="mt-1 font-mono tabular-nums text-lg font-semibold">
                <span className="text-slate-100">
                  {atmIvPct !== null ? `${atmIvPct.toFixed(1)}%` : 'N/A'}
                </span>
                {ivSpread !== null && (
                  <span
                    className={`text-xs ml-2 ${
                      ivSpread > 12
                        ? 'text-rose-400'
                        : ivSpread < 0
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                    }`}
                  >
                    {ivSpread > 12
                      ? `溢价偏贵 (+${ivSpread.toFixed(1)}%，警惕财报后IV暴跌)`
                      : ivSpread < 0
                        ? `期权折价 (${ivSpread.toFixed(1)}%)`
                        : `溢价温和 (+${ivSpread.toFixed(1)}%)`}
                  </span>
                )}
              </div>
            </div>

            <div className="md:pl-4">
              <div className="text-xs text-slate-400">
                单笔权利金风控上限 ({riskConfig.optionRiskPct}%)
              </div>
              <div className="mt-1 font-mono tabular-nums text-lg font-semibold text-amber-400">
                ${maxOptBudgetUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                <span className="text-xs text-slate-400 ml-2">
                  约 {formatMoney(maxOptBudgetCny)}
                </span>
              </div>
            </div>
          </div>

          {/* 6-Month Volatility Calendar Heatmap */}
          <VolatilityCalendarHeatmap
            symbol={chainData.symbol}
            indicatorBars={indicatorBars}
            liveAtmIv={atmIvPct}
          />

          {/* Option Chain Grid */}
          <div className="rounded-lg border border-slate-800 bg-[#0F172A] overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  {chainData.symbol} {right === 'call' ? 'Call 看涨' : 'Put 看跌'}期权链（点击任意行载入盈亏模拟器）
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  已基于 Black-Scholes 自动反推 Delta、每日 Theta 损耗与 Vega（注：非交易时段 Bid/Ask 可能为 0，已自动回退最新成交价）
                </p>
              </div>
              <div className="flex items-center rounded-md bg-slate-900 p-1 border border-slate-800 text-xs">
                {[
                  { id: 'sweet', label: '买方甜点区 (|Δ| 0.22–0.68)' },
                  { id: 'itm', label: '实值替代正股 (|Δ| > 0.65)' },
                  { id: 'all', label: '全部行权价 (±30%)' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setDeltaFilter(f.id as 'all' | 'sweet' | 'itm')}
                    className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                      deltaFilter === f.id
                        ? 'bg-sky-500/20 text-sky-300 font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-72 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">合约代码</th>
                    <th className="py-2.5 px-3 font-medium text-right">行权价</th>
                    <th className="py-2.5 px-3 font-medium text-right">中间价</th>
                    <th className="py-2.5 px-3 font-medium text-right">买一 / 卖一</th>
                    <th className="py-2.5 px-3 font-medium text-right">IV%</th>
                    <th className="py-2.5 px-3 font-medium text-right">Delta</th>
                    <th className="py-2.5 px-3 font-medium text-right">Theta/天</th>
                    <th className="py-2.5 px-3 font-medium text-right">Vega</th>
                    <th className="py-2.5 px-3 font-medium text-right">成交量</th>
                    <th className="py-2.5 px-4 font-medium text-right">未平仓 OI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredContracts.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-slate-400">
                        当前筛选条件下无合约，请切换上方“全部行权价”查看。
                      </td>
                    </tr>
                  ) : (
                    filteredContracts.map((c) => {
                      const isSelected = c.strike === selectedStrike;
                      return (
                        <tr
                          key={c.contractSymbol}
                          onClick={() => handleSelectRow(c)}
                          className={`cursor-pointer transition-colors font-mono tabular-nums ${
                            isSelected
                              ? 'bg-sky-500/15 text-slate-100'
                              : 'hover:bg-slate-800/40 text-slate-300'
                          }`}
                        >
                          <td className="py-2 px-4 text-slate-200">{c.contractSymbol}</td>
                          <td className="py-2 px-3 text-right font-semibold text-slate-100">
                            ${c.strike.toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right text-sky-300 font-semibold">
                            ${c.midPrice.toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-400">
                            {c.bid.toFixed(2)} / {c.ask.toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right">{c.ivPct.toFixed(1)}%</td>
                          <td className="py-2 px-3 text-right">
                            <span
                              className={
                                Math.abs(c.delta) >= 0.3 && Math.abs(c.delta) <= 0.65
                                  ? 'text-emerald-400'
                                  : 'text-slate-300'
                              }
                            >
                              {c.delta.toFixed(3)}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-amber-400">
                            {c.thetaPerDay.toFixed(3)}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-400">
                            {c.vegaPerPct.toFixed(3)}
                          </td>
                          <td className="py-2 px-3 text-right">{c.volume.toLocaleString()}</td>
                          <td className="py-2 px-4 text-right">{c.openInterest.toLocaleString()}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payoff & Time Decay Simulator */}
          {selectedContract && payoff && (
            <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    到期与时间衰减盈亏模拟器 · {chainData.symbol} {selectedContract.strike}
                    {right === 'call' ? 'C' : 'P'} ({chainData.selectedExpiry})
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    直观观察持有到中期与到期日的时间价值损耗（Theta）及盈亏平衡价格
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {savedNotice && (
                    <span className="text-xs text-emerald-400">{savedNotice}</span>
                  )}
                  <button
                    type="button"
                    onClick={handleLogToLedger}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition-colors whitespace-nowrap shrink-0"
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    记入我的账本
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-4 items-end">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">模拟行权价 ($)</label>
                  <select
                    value={selectedStrike}
                    onChange={(e) => {
                      const s = Number(e.target.value);
                      const row = enrichedContracts.find((c) => c.strike === s);
                      if (row) handleSelectRow(row);
                    }}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    {enrichedContracts.map((c) => (
                      <option key={c.strike} value={c.strike}>
                        ${c.strike.toFixed(2)} (Δ {c.delta.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">买入单价 ($/股)</label>
                  <input
                    type="number"
                    step={0.05}
                    min={0.01}
                    value={entryPremium}
                    onChange={(e) =>
                      setEntryPremium(Math.max(0.01, Number(e.target.value) || 0.01))
                    }
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">买入张数 (1张=100股)</label>
                  <input
                    type="number"
                    min={1}
                    value={contracts}
                    onChange={(e) => setContracts(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="text-xs text-slate-400">合计权利金投入</div>
                  <div
                    className={`mt-1 font-mono tabular-nums text-base font-semibold ${
                      totalCostUsd > maxOptBudgetUsd ? 'text-rose-400' : 'text-slate-100'
                    }`}
                  >
                    ${totalCostUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    {formatMoney(totalCostCny)} ({((totalCostCny / riskConfig.totalCapitalCny) * 100).toFixed(2)}%)
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-400">组合每日时间损耗</div>
                  <div className="mt-1 font-mono tabular-nums text-base font-semibold text-amber-400">
                    ${totalDailyThetaUsd.toFixed(1)}/天
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    等效正股 {(selectedContract.delta * 100 * contracts).toFixed(0)} 股
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-400">到期盈亏平衡点</div>
                  <div className="mt-1 font-mono tabular-nums text-base font-semibold text-purple-300">
                    ${payoff.breakeven.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    需波动 {(((payoff.breakeven - chainData.spotPrice) / chainData.spotPrice) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              <OptionPayoffChart
                grid={payoff.grid}
                spotPrice={chainData.spotPrice}
                breakeven={payoff.breakeven}
                dte={selectedContract.dte}
              />

              {/* Option Buyer Targets & Covered Call Reference */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 border-t border-slate-800 pt-4">
                <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3.5 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-200">
                    买方权利金止盈 / 止损参考档位
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-slate-800 font-mono tabular-nums text-xs">
                    <div className="pr-2">
                      <div className="text-[11px] text-slate-400">防守止损 (-40%)</div>
                      <div className="mt-0.5 font-semibold text-rose-400">
                        ${(entryPremium * 0.6).toFixed(2)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        约 {formatMoney(-totalCostCny * 0.4)}
                      </div>
                    </div>
                    <div className="px-2">
                      <div className="text-[11px] text-slate-400">减半止盈 (+50%)</div>
                      <div className="mt-0.5 font-semibold text-sky-300">
                        ${(entryPremium * 1.5).toFixed(2)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        约 +{formatMoney(totalCostCny * 0.5)}
                      </div>
                    </div>
                    <div className="pl-2">
                      <div className="text-[11px] text-slate-400">翻倍目标 (+100%)</div>
                      <div className="mt-0.5 font-semibold text-emerald-400">
                        ${(entryPremium * 2.0).toFixed(2)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        约 +{formatMoney(totalCostCny)}
                      </div>
                    </div>
                  </div>
                </div>

                {right === 'call' ? (
                  <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">
                        备兑开仓 (Covered Call) 卖方增强参考
                      </span>
                      <span className="text-[11px] text-slate-400">
                        每100股正股 + 卖出1张 ${selectedContract.strike}C
                      </span>
                    </div>
                    <div className="grid grid-cols-3 divide-x divide-slate-800 font-mono tabular-nums text-xs">
                      <div className="pr-2">
                        <div className="text-[11px] text-slate-400">单张权利金收入</div>
                        <div className="mt-0.5 font-semibold text-emerald-400">
                          +${(entryPremium * 100).toFixed(0)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          约 {formatMoney(entryPremium * 100 * usdCny)}
                        </div>
                      </div>
                      <div className="px-2">
                        <div className="text-[11px] text-slate-400">静态 / 年化增强</div>
                        <div className="mt-0.5 font-semibold text-sky-300">
                          {((entryPremium / chainData.spotPrice) * 100).toFixed(2)}%
                        </div>
                        <div className="text-[11px] text-slate-500">
                          年化{' '}
                          {(
                            (entryPremium / chainData.spotPrice) *
                            (365 / Math.max(1, selectedContract.dte)) *
                            100
                          ).toFixed(1)}
                          %
                        </div>
                      </div>
                      <div className="pl-2">
                        <div className="text-[11px] text-slate-400">下跌安全垫 / 限价</div>
                        <div className="mt-0.5 font-semibold text-amber-300">
                          -{((entryPremium / chainData.spotPrice) * 100).toFixed(1)}%
                        </div>
                        <div className="text-[11px] text-slate-500">
                          被行权价 ${selectedContract.strike.toFixed(0)}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3.5 space-y-2">
                    <div className="text-xs font-semibold text-slate-200">
                      Put 保护 / 卖方收租 (Cash-Secured Put) 提示
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed font-mono tabular-nums">
                      若持有 100 股 {chainData.symbol}，当前 {Math.abs(selectedContract.delta * 100).toFixed(0)} 股等效对冲需买 1 张 Put（成本 ${(entryPremium * 100).toFixed(0)}）；若计划以 ${selectedContract.strike.toFixed(2)} 接盘正股，卖出 1 张 Put 需备资金 ${(selectedContract.strike * 100).toLocaleString()} 美元。
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Recharts Delta / Gamma / Theta Nonlinear Risk Curves */}
          {selectedContract && (
            <OptionGreeksCurvesPanel
              symbol={chainData.symbol}
              spotPrice={chainData.spotPrice}
              strike={selectedStrike || selectedContract.strike}
              dte={selectedContract.dte}
              ivPct={selectedContract.ivPct}
              right={right}
              contracts={contracts}
              expiryDate={chainData.selectedExpiry}
            />
          )}
        </>
      )}
    </div>
  );
};
