import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Flame,
  RefreshCw,
} from 'lucide-react';
import type {
  MarketType,
  SentimentPolarity,
  StockSentimentResponse,
  ToastType,
} from '../types/trading';
import { BullBearSentimentChart } from './Charts';

interface PreMarketSentimentPanelProps {
  market: MarketType;
  symbol: string;
  stockName: string;
  onNotify: (type: ToastType, title: string, detail?: string) => void;
}

type SentimentFilter = 'all' | 'social' | 'news' | 'polarized';

function formatSentimentTime(iso: string | null): string {
  if (!iso) return '近期';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '近期';
  return dt.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function polarityLabel(p: SentimentPolarity): string {
  if (p === 'bullish') return '偏多';
  if (p === 'bearish') return '偏空';
  return '中性';
}

function polarityColor(p: SentimentPolarity): string {
  if (p === 'bullish') return 'text-emerald-400';
  if (p === 'bearish') return 'text-rose-400';
  return 'text-slate-400';
}

export const PreMarketSentimentPanel: React.FC<PreMarketSentimentPanelProps> = ({
  market,
  symbol,
  stockName,
  onNotify,
}) => {
  const targetKey = `${market}:${symbol}`;
  const cacheRef = useRef<Map<string, StockSentimentResponse>>(new Map());
  const activeKeyRef = useRef<string>(targetKey);

  const [data, setData] = useState<StockSentimentResponse | null>(
    () => cacheRef.current.get(targetKey) ?? null
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SentimentFilter>('all');

  const fetchSentiment = useCallback(
    async (
      mkt: MarketType,
      sym: string,
      name: string,
      forceRefresh = false,
      announce = false
    ) => {
      const key = `${mkt}:${sym}`;
      if (!forceRefresh) {
        const localCached = cacheRef.current.get(key);
        if (localCached) {
          setData({ ...localCached, cached: true });
          setError(null);
          return;
        }
      }

      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          market: mkt,
          symbol: sym,
          name,
        });
        if (forceRefresh) params.set('refresh', '1');

        const res = await fetch(`/api/stock-sentiment?${params.toString()}`);
        const json = (await res.json()) as StockSentimentResponse & { error?: string };
        if (!res.ok) {
          throw new Error(json.error || '盘前情绪热度分析加载失败');
        }

        if (json.aiAvailable) {
          cacheRef.current.set(key, json);
        }

        if (activeKeyRef.current === key) {
          setData(json);
        }

        if (announce) {
          onNotify(
            json.aiAvailable ? 'success' : 'warning',
            json.aiAvailable
              ? `已完成 ${sym} 盘前情绪极性分析`
              : `${sym} 已拉取新闻标题（AI 极性打分受限）`,
            json.aiAvailable
              ? `热度 ${json.heatScore}/100 · 多头 ${json.bullishPct}% vs 空头 ${json.bearishPct}%`
              : json.aiError
          );
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : '无法完成盘前社交媒体与新闻情绪分析';
        if (activeKeyRef.current === key) {
          setError(msg);
        }
        if (announce) {
          onNotify('error', `${sym} 盘前情绪分析失败`, msg);
        }
      } finally {
        if (activeKeyRef.current === key) {
          setLoading(false);
        }
      }
    },
    [onNotify]
  );

  useEffect(() => {
    activeKeyRef.current = targetKey;
    setFilter('all');
    const localCached = cacheRef.current.get(targetKey);
    if (localCached) {
      setData({ ...localCached, cached: true });
      setError(null);
      setLoading(false);
      return;
    }
    setData(null);
    setLoading(true);
    // Stagger by 650ms so stock-news and stock-sentiment do not burst-collide on Gemini RPM limits
    const timer = window.setTimeout(() => {
      fetchSentiment(market, symbol, stockName, false, false);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [targetKey, market, symbol, stockName, fetchSentiment]);

  const filteredItems = useMemo(() => {
    const list = data?.items ?? [];
    if (filter === 'social') return list.filter((i) => i.sourceType === 'social');
    if (filter === 'news') return list.filter((i) => i.sourceType === 'news');
    if (filter === 'polarized') return list.filter((i) => i.polarity !== 'neutral');
    return list;
  }, [data, filter]);

  return (
    <section className="rounded-lg border border-slate-800 bg-[#0F172A] p-5 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-amber-400 shrink-0" />
            <h3 className="text-base font-semibold text-slate-100">
              盘前情绪热度 · AI 多空极性分析
            </h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="text-slate-200 font-medium">{stockName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{symbol}</span>
            {data && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={`font-medium ${
                    data.sentimentScore > 10
                      ? 'text-emerald-400'
                      : data.sentimentScore < -10
                        ? 'text-rose-400'
                        : 'text-amber-300'
                  }`}
                >
                  {data.regimeLabel}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {formatSentimentTime(data.updatedAt)}
                </span>
                <span aria-hidden="true">·</span>
                <span className={data.cached ? 'text-slate-400' : 'text-emerald-400'}>
                  {data.cached ? '缓存命中' : 'AI 实时极性评估'}
                </span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => fetchSentiment(market, symbol, stockName, true, true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-sky-500/50 hover:text-sky-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? '极性分析中...' : '刷新情绪热度'}
        </button>
      </div>

      {/* Loading Skeleton */}
      {loading && !data && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-6 space-y-3">
            <div className="h-14 rounded bg-slate-800/50 animate-pulse" />
            <div className="h-44 rounded bg-slate-800/50 animate-pulse" />
          </div>
          <div className="xl:col-span-6 space-y-2.5">
            <div className="h-8 rounded bg-slate-800/60 animate-pulse" />
            <div className="h-48 rounded bg-slate-800/50 animate-pulse" />
          </div>
        </div>
      )}

      {/* Full Error State */}
      {error && !data && !loading && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-rose-900/60 bg-rose-950/25 rounded-md px-4 py-3 text-xs text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchSentiment(market, symbol, stockName, true, true)}
            className="rounded border border-rose-800/80 px-2.5 py-1 text-rose-200 hover:bg-rose-900/40 transition-colors whitespace-nowrap shrink-0"
          >
            重试分析
          </button>
        </div>
      )}

      {/* Partial AI Error Notice */}
      {data && !data.aiAvailable && data.aiError && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-800/60 bg-amber-950/25 rounded-md px-4 py-2.5 text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>AI 情绪极性打分暂未完成：{data.aiError}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchSentiment(market, symbol, stockName, true, true)}
            className="underline underline-offset-2 font-medium whitespace-nowrap shrink-0"
          >
            重新极性分析
          </button>
        </div>
      )}

      {/* Populated 2-Column Content */}
      {data && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left 6 Cols: Metrics + AI Overview + Bull vs Bear Chart */}
          <div className="xl:col-span-6 space-y-4">
            {data.aiAvailable ? (
              <>
                <div className="grid grid-cols-3 divide-x divide-slate-800 border-b border-slate-800 pb-3.5 font-mono tabular-nums">
                  <div className="pr-3">
                    <div className="text-[11px] text-slate-400">盘前舆情热度</div>
                    <div className="mt-1 text-xl font-semibold text-sky-400">
                      {data.heatScore}
                      <span className="text-xs text-slate-500 font-normal"> / 100</span>
                    </div>
                  </div>
                  <div className="px-3">
                    <div className="text-[11px] text-slate-400">多空净极性分</div>
                    <div
                      className={`mt-1 text-xl font-semibold ${
                        data.sentimentScore > 10
                          ? 'text-emerald-400'
                          : data.sentimentScore < -10
                            ? 'text-rose-400'
                            : 'text-amber-300'
                      }`}
                    >
                      {data.sentimentScore >= 0
                        ? `+${data.sentimentScore}`
                        : data.sentimentScore}
                    </div>
                  </div>
                  <div className="pl-3">
                    <div className="text-[11px] text-slate-400">多空声量比</div>
                    <div className="mt-1 text-xl font-semibold text-slate-100">
                      <span className="text-emerald-400">{data.bullishPct}%</span>
                      <span className="text-slate-600 mx-1">:</span>
                      <span className="text-rose-400">{data.bearishPct}%</span>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{data.overview}</p>

                <BullBearSentimentChart
                  bullishPct={data.bullishPct}
                  neutralPct={data.neutralPct}
                  bearishPct={data.bearishPct}
                  sentimentScore={data.sentimentScore}
                  heatScore={data.heatScore}
                  regimeLabel={data.regimeLabel}
                  channels={data.channels}
                />
              </>
            ) : (
              <div className="py-6 text-xs text-slate-400 leading-relaxed">
                当前已同步最新财经新闻标题（见右侧列表），待 AI 服务配额恢复后点击右上角「刷新情绪热度」即可生成多空极性仪表盘、情绪雷达图与社媒得分。
              </div>
            )}
          </div>

          {/* Right 6 Cols: Social Media & News Polarity Breakdown List */}
          <div className="xl:col-span-6 xl:border-l xl:border-slate-800 xl:pl-6 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-300">
                社媒讨论与新闻标题情感极性明细
              </h4>

              <div className="flex items-center rounded-md bg-slate-900 p-0.5 border border-slate-800 text-[11px]">
                {[
                  { id: 'all', label: '全部' },
                  { id: 'social', label: '社交媒体' },
                  { id: 'news', label: '财经新闻' },
                  { id: 'polarized', label: '仅多空信号' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id as SentimentFilter)}
                    className={`px-2 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                      filter === tab.id
                        ? 'bg-sky-500/20 text-sky-300 font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredItems.length > 0 ? (
              <div className="divide-y divide-slate-800/80 max-h-[340px] overflow-y-auto pr-1">
                {filteredItems.map((item, idx) => (
                  <div key={`${item.headline}-${idx}`} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-1.5 text-slate-400 min-w-0 truncate">
                        <span className="text-slate-200 font-medium">{item.platform}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.sourceType === 'social' ? '社交媒体' : '财经新闻'}</span>
                      </div>

                      <div
                        className={`font-mono tabular-nums font-semibold shrink-0 ${polarityColor(
                          item.polarity
                        )}`}
                      >
                        {polarityLabel(item.polarity)}{' '}
                        {item.score > 0 ? `+${item.score}` : item.score}
                      </div>
                    </div>

                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start justify-between gap-2 text-xs text-slate-100 hover:text-sky-300 transition-colors leading-snug"
                      >
                        <span className="line-clamp-2">{item.headline}</span>
                        <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-sky-300 shrink-0 mt-0.5" />
                      </a>
                    ) : (
                      <div className="text-xs text-slate-100 leading-snug line-clamp-2">
                        {item.headline}
                      </div>
                    )}

                    <div className="text-[11px] text-slate-400">
                      AI 极性归因：{item.reason}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-500">
                当前筛选分类下暂无舆情记录，请切换“全部”查看。
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
