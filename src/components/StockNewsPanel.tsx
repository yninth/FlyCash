import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Newspaper,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import type { MarketType, StockNewsDigest, ToastType } from '../types/trading';

interface StockNewsPanelProps {
  market: MarketType;
  symbol: string;
  stockName: string;
  onNotify: (type: ToastType, title: string, detail?: string) => void;
}

function formatNewsDate(iso: string | null): string {
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

export const StockNewsPanel: React.FC<StockNewsPanelProps> = ({
  market,
  symbol,
  stockName,
  onNotify,
}) => {
  const targetKey = `${market}:${symbol}`;
  const cacheRef = useRef<Map<string, StockNewsDigest>>(new Map());
  const activeKeyRef = useRef<string>(targetKey);

  const [digest, setDigest] = useState<StockNewsDigest | null>(
    () => cacheRef.current.get(targetKey) ?? null
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(
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
          setDigest({ ...localCached, cached: true });
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

        const res = await fetch(`/api/stock-news?${params.toString()}`);
        const json = (await res.json()) as StockNewsDigest & { error?: string };
        if (!res.ok) {
          throw new Error(json.error || '近期新闻与财报摘要加载失败');
        }

        if (json.aiAvailable) {
          cacheRef.current.set(key, json);
        }

        if (activeKeyRef.current === key) {
          setDigest(json);
        }

        if (announce) {
          onNotify(
            json.aiAvailable ? 'success' : 'warning',
            json.aiAvailable
              ? `已更新 ${sym} 最新新闻与财报摘要`
              : `${sym} 已加载新闻列表（AI 摘要受限）`,
            json.aiAvailable
              ? `收录 ${json.newsItems.length} 条真实信源`
              : json.aiError
          );
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : '无法获取最新市场动态与财报摘要';
        if (activeKeyRef.current === key) {
          setError(msg);
        }
        if (announce) {
          onNotify('error', `${sym} 新闻摘要获取失败`, msg);
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
    const localCached = cacheRef.current.get(targetKey);
    if (localCached) {
      setDigest({ ...localCached, cached: true });
      setError(null);
      setLoading(false);
      return;
    }
    setDigest(null);
    fetchNews(market, symbol, stockName, false, false);
  }, [targetKey, market, symbol, stockName, fetchNews]);

  return (
    <section className="rounded-lg border border-slate-800 bg-[#0F172A] p-5 space-y-5">
      {/* Panel Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-sky-400 shrink-0" />
            <h3 className="text-base font-semibold text-slate-100">
              近期相关新闻与财报摘要
            </h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="text-slate-200 font-medium">{stockName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{symbol}</span>
            {digest?.earningsPeriod && (
              <>
                <span aria-hidden="true">·</span>
                <span>{digest.earningsPeriod}</span>
              </>
            )}
            {digest?.updatedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {formatNewsDate(digest.updatedAt)}
                </span>
              </>
            )}
            {digest && (
              <>
                <span aria-hidden="true">·</span>
                <span className={digest.cached ? 'text-slate-400' : 'text-emerald-400'}>
                  {digest.cached ? '缓存命中' : '实时联网检索'}
                </span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => fetchNews(market, symbol, stockName, true, true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-sky-500/50 hover:text-sky-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? '联网检索中...' : '刷新新闻与财报'}
        </button>
      </div>

      {/* Loading Skeleton (only when no digest rendered yet) */}
      {loading && !digest && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 space-y-3">
            <div className="h-4 w-32 rounded bg-slate-800/70 animate-pulse" />
            <div className="h-16 rounded bg-slate-800/50 animate-pulse" />
            <div className="h-28 rounded bg-slate-800/50 animate-pulse" />
          </div>
          <div className="lg:col-span-6 space-y-3">
            <div className="h-24 rounded bg-slate-800/50 animate-pulse" />
            <div className="h-28 rounded bg-slate-800/50 animate-pulse" />
          </div>
        </div>
      )}

      {/* Full Error State */}
      {error && !digest && !loading && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-rose-900/60 bg-rose-950/25 rounded-md px-4 py-3 text-xs text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchNews(market, symbol, stockName, true, true)}
            className="rounded border border-rose-800/80 px-2.5 py-1 text-rose-200 hover:bg-rose-900/40 transition-colors whitespace-nowrap shrink-0"
          >
            重试检索
          </button>
        </div>
      )}

      {/* Partial AI Error Notice (when Yahoo Finance links succeeded but AI summary failed) */}
      {digest && !digest.aiAvailable && digest.aiError && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-800/60 bg-amber-950/25 rounded-md px-4 py-2.5 text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>AI 联网摘要暂未生成：{digest.aiError}（已保留财经新闻原文链接）</span>
          </div>
          <button
            type="button"
            onClick={() => fetchNews(market, symbol, stockName, true, true)}
            className="underline underline-offset-2 font-medium whitespace-nowrap shrink-0"
          >
            重新生成摘要
          </button>
        </div>
      )}

      {/* Populated 2-Column Content */}
      {digest && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 6 Cols: Market Dynamics & Latest Earnings Summary */}
          <div className="lg:col-span-6 space-y-5">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-300">
                最新市场动态
              </h4>
              {digest.marketSummary ? (
                <p className="text-sm text-slate-200 leading-relaxed">
                  {digest.marketSummary}
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  暂未生成 AI 市场动态综述，可查看右侧原始财经报道或点击右上角刷新重试。
                </p>
              )}
            </div>

            <div className="border-t border-slate-800 pt-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <h4 className="font-semibold text-slate-300">最新财报核心摘要</h4>
                <span className="font-mono text-sky-300">{digest.earningsPeriod}</span>
              </div>

              {digest.earningsSummary.length > 0 ? (
                <ul className="divide-y divide-slate-800/80 text-xs text-slate-300">
                  {digest.earningsSummary.map((point, idx) => (
                    <li key={idx} className="py-2 first:pt-0 last:pb-0 leading-relaxed">
                      <span className="font-mono text-slate-500 mr-2">
                        0{idx + 1}.
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">
                  当前暂无可提取的财报要点，请点击右上角「刷新新闻与财报」重试。
                </p>
              )}
            </div>
          </div>

          {/* Right 6 Cols: Bull/Bear Catalysts + Real Grounded News Links */}
          <div className="lg:col-span-6 lg:border-l lg:border-slate-800 lg:pl-6 space-y-5">
            {/* Bull vs Bear Catalysts Comparison */}
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 border-b border-slate-800 pb-4 gap-4 sm:gap-0">
              <div className="sm:pr-4 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                  <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                  <span>多头利好催化</span>
                </div>
                {digest.bullishCatalysts.length > 0 ? (
                  <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
                    {digest.bullishCatalysts.map((item, idx) => (
                      <li key={idx}>· {item}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-slate-500">暂无提取结果</div>
                )}
              </div>

              <div className="pt-3 sm:pt-0 sm:pl-4 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-400">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>空头与事件风险</span>
                </div>
                {digest.bearishRisks.length > 0 ? (
                  <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
                    {digest.bearishRisks.map((item, idx) => (
                      <li key={idx}>· {item}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-slate-500">暂无提取结果</div>
                )}
              </div>
            </div>

            {/* Real News & Grounding Sources */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <h4 className="font-semibold text-slate-300">
                  相关报道与联网信源
                </h4>
                <span className="font-mono tabular-nums text-slate-500">
                  共 {digest.newsItems.length} 条可核验链接
                </span>
              </div>

              {digest.newsItems.length > 0 ? (
                <div className="divide-y divide-slate-800/80 max-h-[240px] overflow-y-auto pr-1">
                  {digest.newsItems.map((item, idx) => (
                    <a
                      key={`${item.url}-${idx}`}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2 first:pt-0 last:pb-0 flex items-start justify-between gap-3 group hover:bg-slate-800/25 px-1.5 -mx-1.5 rounded transition-colors"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-xs text-slate-200 group-hover:text-sky-300 transition-colors line-clamp-2 leading-snug">
                          {item.title}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          <span>{item.publisher}</span>
                          {item.publishedAt && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {formatNewsDate(item.publishedAt)}
                              </span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>
                            {item.sourceType === 'news_api' ? '财经资讯' : '搜索溯源'}
                          </span>
                        </div>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-300 shrink-0 mt-0.5 transition-colors" />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-2">
                  暂未附带外部原文链接，可点击右上角刷新重新检索。
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
