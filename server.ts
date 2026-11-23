import 'dotenv/config';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import YahooFinance from 'yahoo-finance2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
});

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { expiresAt: Date.now() + ttlMs, data });
}

interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function normalizeHkSymbol(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/\.HK$/i, '');
  if (/^\d+$/.test(cleaned)) {
    const num = parseInt(cleaned, 10);
    return `${String(num).padStart(4, '0')}.HK`;
  }
  return `${cleaned}.HK`;
}

function normalizeCnCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\.(SH|SZ|SS|BJ)$/i, '');
}

function cnToYahooSymbol(code: string): string {
  if (code.startsWith('6') || code.startsWith('5') || code.startsWith('9')) {
    return `${code}.SS`;
  }
  return `${code}.SZ`;
}

function normalizeHk5Digits(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/\.HK$/i, '');
  if (/^\d+$/.test(cleaned)) {
    return String(parseInt(cleaned, 10)).padStart(5, '0');
  }
  return cleaned;
}

function normalizeUsSymbol(raw: string): string {
  let cleaned = raw.trim().toUpperCase();
  cleaned = cleaned.replace(/^(?:US|NASDAQ|NYSE|AMEX|BATS|ARCA)[:.\s]+/i, '');
  cleaned = cleaned.replace(/\.US$/i, '');
  const leadingToken = cleaned.match(/^([A-Z]{1,6}(?:[.-][A-Z]{1,2})?)(?:\s+.*)?$/);
  if (leadingToken) {
    cleaned = leadingToken[1];
  }
  // Yahoo Finance uses hyphen for share classes like BRK-B
  cleaned = cleaned.replace(/\.([A-Z]{1,2})$/, '-$1');
  return cleaned;
}

const US_SECID_PRESETS: Record<string, string> = {
  NVDA: '105.NVDA',
  QQQ: '105.QQQ',
  AAPL: '105.AAPL',
  TSLA: '105.TSLA',
  MSFT: '105.MSFT',
  META: '105.META',
  AMZN: '105.AMZN',
  GOOG: '105.GOOG',
  GOOGL: '105.GOOGL',
  AMD: '105.AMD',
  AVGO: '105.AVGO',
  MU: '105.MU',
  SNDK: '105.SNDK',
  INTC: '105.INTC',
  NFLX: '105.NFLX',
  PLTR: '105.PLTR',
  TQQQ: '105.TQQQ',
  SQQQ: '105.SQQQ',
  NVDL: '105.NVDL',
  COIN: '105.COIN',
  MSTR: '105.MSTR',
  SPY: '106.SPY',
  TSM: '106.TSM',
  BABA: '106.BABA',
  ORCL: '106.ORCL',
  SNXX: '107.SNXX',
  SOXL: '107.SOXL',
  SOXS: '107.SOXS',
  GLD: '107.GLD',
  SLV: '107.SLV',
  UVXY: '107.UVXY',
};

export interface EastmoneySuggestItem {
  market: 'US' | 'HK' | 'CN';
  symbol: string;
  name: string;
  secid: string;
  exchangeLabel: string;
}

async function searchEastmoneySuggest(
  query: string,
  marketFilter?: string
): Promise<EastmoneySuggestItem[]> {
  const q = query.trim();
  if (!q) return [];
  const cacheKey = `em_suggest:${q.toUpperCase()}:${(marketFilter || 'ALL').toUpperCase()}`;
  const cached = getCached<EastmoneySuggestItem[]>(cacheKey);
  if (cached) return cached;

  try {
    const url =
      `https://searchapi.eastmoney.com/api/suggest/get` +
      `?input=${encodeURIComponent(q)}&type=14&token=D43BF722C8E33BDC906FB84D85E7EE6E`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://quote.eastmoney.com/',
      },
    });
    clearTimeout(timer);
    if (!resp.ok) return [];

    const json = (await resp.json()) as {
      QuotationCodeTable?: {
        Data?: Array<{
          Code?: string;
          Name?: string;
          Classify?: string;
          SecurityTypeName?: string;
          JYS?: string;
          QuoteID?: string;
        }>;
      };
    };

    const rawList = json?.QuotationCodeTable?.Data || [];
    const results: EastmoneySuggestItem[] = [];
    const filterUpper = marketFilter?.toUpperCase();

    for (const item of rawList) {
      const code = String(item.Code || '').trim().toUpperCase();
      const name = String(item.Name || code).trim();
      const quoteId = String(item.QuoteID || '').trim();
      const classify = String(item.Classify || '').trim();
      if (!code || !quoteId) continue;

      let mkt: 'US' | 'HK' | 'CN' | null = null;
      if (classify === 'UsStock') mkt = 'US';
      else if (classify === 'HK') mkt = 'HK';
      else if (classify === 'AStock' || classify === 'Fund') mkt = 'CN';
      if (!mkt) continue;
      if (filterUpper && filterUpper !== 'ALL' && mkt !== filterUpper) continue;

      results.push({
        market: mkt,
        symbol: mkt === 'HK' ? code.replace(/^0(?=\d{4}$)/, '') : code,
        name,
        secid: quoteId,
        exchangeLabel: item.SecurityTypeName || item.JYS || mkt,
      });
    }

    setCached(cacheKey, results, 10 * 60_000);
    return results;
  } catch {
    return [];
  }
}

async function resolveUsTickerViaSearch(query: string): Promise<string | null> {
  const emHits = await searchEastmoneySuggest(query, 'US');
  if (emHits.length > 0) {
    setCached(`us_secid:${emHits[0].symbol}`, emHits[0].secid, 24 * 3600_000);
    return emHits[0].symbol;
  }
  try {
    const res = await yahooFinance.search(query.trim(), {
      quotesCount: 8,
      newsCount: 0,
    });
    const quotes = Array.isArray(res?.quotes) ? res.quotes : [];
    const candidate = quotes.find((q) => {
      const rec = q as Record<string, unknown>;
      const qt = String(rec.quoteType || '').toUpperCase();
      const sym = String(rec.symbol || '').trim();
      return Boolean(sym) && (qt === 'ETF' || qt === 'EQUITY' || qt === 'INDEX');
    }) as Record<string, unknown> | undefined;
    return candidate?.symbol ? String(candidate.symbol).toUpperCase() : null;
  } catch {
    return null;
  }
}

async function fetchEastmoneyKlinesBySecid(
  secid: string,
  days: number
): Promise<{ code: string; name: string; bars: OhlcvBar[] } | null> {
  try {
    const endDt = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    const startDt = new Date(Date.now() - days * 24 * 3600 * 1000);
    const beg = toIsoDate(startDt).replace(/-/g, '');
    const end = toIsoDate(endDt).replace(/-/g, '');

    const url =
      `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
      `?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6` +
      `&fields2=f51,f52,f53,f54,f55,f56,f57,f58` +
      `&klt=101&fqt=1&beg=${beg}&end=${end}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://quote.eastmoney.com/',
      },
    });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      data?: { code?: string; name?: string; klines?: string[] };
    };
    const klines = json?.data?.klines;
    if (!Array.isArray(klines) || klines.length === 0) return null;

    const bars: OhlcvBar[] = [];
    for (const row of klines) {
      const parts = row.split(',');
      if (parts.length < 6) continue;
      const open = parseFloat(parts[1]);
      const close = parseFloat(parts[2]);
      const high = parseFloat(parts[3]);
      const low = parseFloat(parts[4]);
      const volume = parseFloat(parts[5]);
      if (
        Number.isFinite(open) &&
        Number.isFinite(close) &&
        Number.isFinite(high) &&
        Number.isFinite(low) &&
        close > 0
      ) {
        bars.push({ date: parts[0], open, high, low, close, volume: volume || 0 });
      }
    }

    if (bars.length === 0) return null;
    return {
      code: json.data?.code || secid.split('.')[1] || secid,
      name: json.data?.name || secid,
      bars,
    };
  } catch {
    return null;
  }
}

async function resolveAndFetchUsEastmoneyKlines(
  rawInput: string,
  days: number
): Promise<{ symbol: string; name: string; bars: OhlcvBar[] } | null> {
  const usSym = normalizeUsSymbol(rawInput);

  const cachedSecid = getCached<string>(`us_secid:${usSym}`) || US_SECID_PRESETS[usSym];
  if (cachedSecid) {
    const res = await fetchEastmoneyKlinesBySecid(cachedSecid, days);
    if (res) {
      setCached(`us_secid:${usSym}`, cachedSecid, 24 * 3600_000);
      return { symbol: usSym, name: res.name, bars: res.bars };
    }
  }

  // Try Eastmoney Suggest API (supports English ticker AND Chinese names like "二倍做多SNDK", "英伟达")
  const hits = await searchEastmoneySuggest(rawInput, 'US');
  const exactOrFirst =
    hits.find((h) => h.symbol === usSym) ||
    (hits.length > 0 ? hits[0] : null);
  if (exactOrFirst) {
    const res = await fetchEastmoneyKlinesBySecid(exactOrFirst.secid, days);
    if (res) {
      setCached(`us_secid:${exactOrFirst.symbol}`, exactOrFirst.secid, 24 * 3600_000);
      return {
        symbol: exactOrFirst.symbol,
        name: res.name || exactOrFirst.name,
        bars: res.bars,
      };
    }
  }

  // Fallback parallel secid market probe (105=NASDAQ, 106=NYSE, 107=AMEX/BATS)
  if (/^[A-Z]{1,6}(?:-[A-Z]{1,2})?$/.test(usSym)) {
    const candidates = [`105.${usSym}`, `106.${usSym}`, `107.${usSym}`];
    const results = await Promise.all(
      candidates.map(async (secid) => ({
        secid,
        res: await fetchEastmoneyKlinesBySecid(secid, days),
      }))
    );
    const hit = results.find((r) => r.res !== null);
    if (hit && hit.res) {
      setCached(`us_secid:${usSym}`, hit.secid, 24 * 3600_000);
      return { symbol: usSym, name: hit.res.name, bars: hit.res.bars };
    }
  }

  return null;
}

interface EastmoneyFundFlowBar {
  date: string;
  mainNet: number;
  superLargeNet: number;
  largeNet: number;
  mediumNet: number;
  smallNet: number;
  mainPct: number;
  superLargePct: number;
  largePct: number;
  mediumPct: number;
  smallPct: number;
  close: number;
  changePct: number;
}

async function fetchEastmoneyFundFlowBySecid(
  secid: string,
  days = 60
): Promise<{ name: string; bars: EastmoneyFundFlowBar[] } | null> {
  try {
    const lmt = Math.min(120, Math.max(20, days));
    const url =
      `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get` +
      `?lmt=${lmt}&klt=101&fields1=f1,f2,f3,f7` +
      `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65` +
      `&secid=${encodeURIComponent(secid)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://data.eastmoney.com/',
      },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;

    const json = (await resp.json()) as {
      data?: { name?: string; klines?: string[] };
    };
    const klines = json?.data?.klines;
    if (!Array.isArray(klines) || klines.length === 0) return null;

    const bars: EastmoneyFundFlowBar[] = [];
    for (const row of klines) {
      const p = row.split(',');
      if (p.length < 13) continue;
      const mainNet = parseFloat(p[1]);
      const smallNet = parseFloat(p[2]);
      const mediumNet = parseFloat(p[3]);
      const largeNet = parseFloat(p[4]);
      const superLargeNet = parseFloat(p[5]);
      const mainPct = parseFloat(p[6]);
      const smallPct = parseFloat(p[7]);
      const mediumPct = parseFloat(p[8]);
      const largePct = parseFloat(p[9]);
      const superLargePct = parseFloat(p[10]);
      const close = parseFloat(p[11]);
      const changePct = parseFloat(p[12]);

      if (!Number.isFinite(mainNet) || !Number.isFinite(close)) continue;
      bars.push({
        date: p[0],
        mainNet,
        superLargeNet: Number.isFinite(superLargeNet) ? superLargeNet : 0,
        largeNet: Number.isFinite(largeNet) ? largeNet : 0,
        mediumNet: Number.isFinite(mediumNet) ? mediumNet : 0,
        smallNet: Number.isFinite(smallNet) ? smallNet : 0,
        mainPct: Number.isFinite(mainPct) ? mainPct : 0,
        superLargePct: Number.isFinite(superLargePct) ? superLargePct : 0,
        largePct: Number.isFinite(largePct) ? largePct : 0,
        mediumPct: Number.isFinite(mediumPct) ? mediumPct : 0,
        smallPct: Number.isFinite(smallPct) ? smallPct : 0,
        close,
        changePct: Number.isFinite(changePct) ? changePct : 0,
      });
    }

    if (bars.length === 0) return null;
    return {
      name: (json.data?.name || secid).trim(),
      bars,
    };
  } catch {
    return null;
  }
}

interface SinaMoneyFlowRow {
  opendate?: string;
  trade?: string;
  changeratio?: string;
  r0?: string;
  r1?: string;
  r2?: string;
  r3?: string;
  r0_net?: string;
  r1_net?: string;
  r2_net?: string;
  r3_net?: string;
}

async function fetchSinaCnFundFlow(
  code6: string,
  days = 60
): Promise<EastmoneyFundFlowBar[] | null> {
  try {
    const sinaSym = cnToTencentSymbol(code6);
    const num = Math.min(120, Math.max(20, days));
    const url =
      `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_qsfx_lscjfb` +
      `?page=1&num=${num}&sort=opendate&asc=0&daima=${encodeURIComponent(sinaSym)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://vip.stock.finance.sina.com.cn/',
      },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;

    const rows = (await resp.json()) as SinaMoneyFlowRow[];
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const parsed: EastmoneyFundFlowBar[] = [];
    for (const r of rows) {
      const date = String(r.opendate || '').trim();
      const close = parseFloat(String(r.trade ?? ''));
      const changeRatio = parseFloat(String(r.changeratio ?? '0'));
      const r0Net = parseFloat(String(r.r0_net ?? '0')) || 0;
      const r1Net = parseFloat(String(r.r1_net ?? '0')) || 0;
      const r2Net = parseFloat(String(r.r2_net ?? '0')) || 0;
      const r3Net = parseFloat(String(r.r3_net ?? '0')) || 0;
      const r0 = parseFloat(String(r.r0 ?? '0')) || 0;
      const r1 = parseFloat(String(r.r1 ?? '0')) || 0;
      const r2 = parseFloat(String(r.r2 ?? '0')) || 0;
      const r3 = parseFloat(String(r.r3 ?? '0')) || 0;

      if (!date || !Number.isFinite(close) || close <= 0) continue;

      const superLargeNet = r0Net;
      const largeNet = r1Net;
      const mediumNet = r2Net;
      const smallNet = r3Net;
      const mainNet = superLargeNet + largeNet;
      const totalTurnover = Math.max(
        1,
        r0 + r1 + r2 + r3,
        Math.abs(superLargeNet) + Math.abs(largeNet) + Math.abs(mediumNet) + Math.abs(smallNet)
      );

      parsed.push({
        date,
        mainNet,
        superLargeNet,
        largeNet,
        mediumNet,
        smallNet,
        mainPct: (mainNet / totalTurnover) * 100,
        superLargePct: (superLargeNet / totalTurnover) * 100,
        largePct: (largeNet / totalTurnover) * 100,
        mediumPct: (mediumNet / totalTurnover) * 100,
        smallPct: (smallNet / totalTurnover) * 100,
        close,
        changePct: Number.isFinite(changeRatio) ? changeRatio * 100 : 0,
      });
    }

    if (parsed.length === 0) return null;
    parsed.sort((a, b) => a.date.localeCompare(b.date));
    return parsed;
  } catch {
    return null;
  }
}

async function computeOhlcvFundFlowFallback(
  market: 'US' | 'HK' | 'CN',
  symbol: string,
  days: number
): Promise<{
  symbol: string;
  name: string;
  bars: EastmoneyFundFlowBar[];
  source: string;
} | null> {
  try {
    const stock = (await fetchStockData(market, symbol, Math.max(120, days + 45), {
      includeExtendedIntraday: false,
    })) as {
      symbol: string;
      name: string;
      bars: OhlcvBar[];
    };

    const dailyBars = Array.isArray(stock?.bars) ? stock.bars : [];
    if (dailyBars.length < 15) return null;

    // Fetch real 15m intraday bars for recent ~10 sessions to separate institutional block bars from small bars
    const ySym =
      market === 'HK'
        ? normalizeHkSymbol(stock.symbol)
        : market === 'CN'
          ? cnToYahooSymbol(normalizeCnCode(stock.symbol))
          : normalizeUsSymbol(stock.symbol);

    const intradayByDate = new Map<
      string,
      Array<{ open: number; high: number; low: number; close: number; volume: number }>
    >();
    let usedIntraday = false;

    try {
      const p1 = new Date(Date.now() - 14 * 24 * 3600 * 1000);
      const chart15m = await withTimeout(
        yahooFinance.chart(ySym, { period1: p1, interval: '15m' }).catch(() => null),
        2800,
        null
      );
      for (const q of chart15m?.quotes || []) {
        if (!q.date || q.close == null || q.high == null || q.low == null || q.volume == null) {
          continue;
        }
        const dt = new Date(q.date);
        const dateKey = market === 'US' ? formatEtDateAndTime(dt).etDate : toIsoDate(dt);
        const list = intradayByDate.get(dateKey) || [];
        list.push({
          open: Number(q.open ?? q.close),
          high: Number(q.high),
          low: Number(q.low),
          close: Number(q.close),
          volume: Number(q.volume ?? 0),
        });
        intradayByDate.set(dateKey, list);
      }
    } catch {
      // non-fatal, daily Chaikin turnover calculation handles all days
    }

    const flowBars: EastmoneyFundFlowBar[] = [];
    for (let i = 0; i < dailyBars.length; i++) {
      const b = dailyBars[i];
      const prevClose = i > 0 ? dailyBars[i - 1].close : b.open || b.close;
      const winStart = Math.max(0, i - 19);
      const volSlice = dailyBars.slice(winStart, i + 1);
      const avgVol20 =
        volSlice.reduce((s, x) => s + Math.max(0, x.volume), 0) / Math.max(1, volSlice.length);
      const volRatio = avgVol20 > 0 ? b.volume / avgVol20 : 1;

      const typicalPrice = (b.high + b.low + b.close) / 3;
      const dailyTurnover = Math.max(1, typicalPrice * Math.max(0, b.volume));
      const changePct = prevClose > 0 ? ((b.close - prevClose) / prevClose) * 100 : 0;

      const intra = intradayByDate.get(b.date);
      if (intra && intra.length >= 6) {
        usedIntraday = true;
        const barTurnovers = intra
          .map((x) => x.close * Math.max(0, x.volume))
          .filter((v) => v > 0)
          .sort((x, y) => x - y);
        const medianBarTurn =
          barTurnovers.length > 0
            ? barTurnovers[Math.floor(barTurnovers.length / 2)]
            : dailyTurnover / intra.length;

        let superLargeNet = 0;
        let largeNet = 0;
        let mediumNet = 0;
        let smallNet = 0;

        for (let k = 0; k < intra.length; k++) {
          const m = intra[k];
          const prevMClose = k > 0 ? intra[k - 1].close : prevClose;
          const mTurn = m.close * Math.max(0, m.volume);
          if (mTurn <= 0) continue;

          const rangeM = m.high - m.low;
          const mfm =
            rangeM > 1e-6
              ? ((m.close - m.low) - (m.high - m.close)) / rangeM
              : m.close >= prevMClose
                ? 0.4
                : -0.4;
          const retSign =
            prevMClose > 0 ? Math.tanh(((m.close - prevMClose) / prevMClose) * 160) : 0;
          const signedFlow = mTurn * (0.65 * mfm + 0.35 * retSign);

          if (mTurn >= medianBarTurn * 2.2) {
            superLargeNet += signedFlow;
          } else if (mTurn >= medianBarTurn * 1.15) {
            largeNet += signedFlow;
          } else if (mTurn >= medianBarTurn * 0.55) {
            mediumNet += signedFlow;
          } else {
            smallNet += signedFlow;
          }
        }

        const mainNet = superLargeNet + largeNet;
        const denom = Math.max(
          dailyTurnover,
          intra.reduce((s, m) => s + m.close * Math.max(0, m.volume), 0)
        );
        flowBars.push({
          date: b.date,
          mainNet,
          superLargeNet,
          largeNet,
          mediumNet,
          smallNet,
          mainPct: (mainNet / denom) * 100,
          superLargePct: (superLargeNet / denom) * 100,
          largePct: (largeNet / denom) * 100,
          mediumPct: (mediumNet / denom) * 100,
          smallPct: (smallNet / denom) * 100,
          close: b.close,
          changePct,
        });
      } else {
        const range = b.high - b.low;
        const mfm =
          range > 1e-6
            ? ((b.close - b.low) - (b.high - b.close)) / range
            : b.close >= prevClose
              ? 0.35
              : -0.35;
        const gapThrust =
          prevClose > 0 ? Math.tanh(((b.close - prevClose) / prevClose) * 18) : 0;
        const intensity = 0.72 * mfm + 0.28 * gapThrust;
        const totalSigned = dailyTurnover * intensity;

        const instShare = Math.min(0.82, Math.max(0.46, 0.58 + 0.16 * Math.tanh(volRatio - 1)));
        const mainNet = totalSigned * instShare;
        const superLargeNet = mainNet * 0.62;
        const largeNet = mainNet * 0.38;
        const mediumNet = totalSigned * (1 - instShare) * 0.6;
        const smallNet = totalSigned * (1 - instShare) * 0.4;

        flowBars.push({
          date: b.date,
          mainNet,
          superLargeNet,
          largeNet,
          mediumNet,
          smallNet,
          mainPct: (mainNet / dailyTurnover) * 100,
          superLargePct: (superLargeNet / dailyTurnover) * 100,
          largePct: (largeNet / dailyTurnover) * 100,
          mediumPct: (mediumNet / dailyTurnover) * 100,
          smallPct: (smallNet / dailyTurnover) * 100,
          close: b.close,
          changePct,
        });
      }
    }

    return {
      symbol: stock.symbol,
      name: stock.name,
      bars: flowBars.slice(-days),
      source: usedIntraday
        ? '量化量价资金流 · 15m大单与Chaikin实盘成交额模型'
        : '量化量价资金流 · Chaikin实盘成交额模型',
    };
  } catch {
    return null;
  }
}

async function resolveFundFlowData(
  market: string,
  symbol: string,
  days = 60,
  forceRefresh = false
) {
  const normMarket = market.toUpperCase() as 'US' | 'HK' | 'CN';
  const cleanSym = symbol.trim().toUpperCase();
  const cacheKey = `fflow:${normMarket}:${cleanSym}:${days}`;
  if (!forceRefresh) {
    const cached = getCached<unknown>(cacheKey);
    if (cached) return cached;
  }

  let secid: string | null = null;
  let resolvedSymbol = cleanSym;
  let cnCode6 = '';

  if (normMarket === 'CN') {
    let code = normalizeCnCode(cleanSym);
    if (!/^\d{6}$/.test(code)) {
      const hits = await searchEastmoneySuggest(symbol, 'CN');
      if (hits.length > 0) {
        code = normalizeCnCode(hits[0].symbol);
        secid = hits[0].secid;
      }
    } else {
      const marketId =
        code.startsWith('6') || code.startsWith('5') || code.startsWith('9') ? '1' : '0';
      secid = `${marketId}.${code}`;
    }
    cnCode6 = code;
    resolvedSymbol = code;
  } else if (normMarket === 'HK') {
    let raw = cleanSym;
    if (!/^\d+$/.test(cleanSym.replace(/\.HK$/i, ''))) {
      const hits = await searchEastmoneySuggest(symbol, 'HK');
      if (hits.length > 0) raw = hits[0].symbol;
    }
    const code5 = normalizeHk5Digits(raw);
    secid = `116.${code5}`;
    resolvedSymbol = code5.replace(/^0(?=\d{4}$)/, '');
  } else {
    const usSym = normalizeUsSymbol(symbol);
    resolvedSymbol = usSym;
    secid = getCached<string>(`us_secid:${usSym}`) || US_SECID_PRESETS[usSym] || null;
    if (!secid) {
      const hits = await searchEastmoneySuggest(symbol, 'US');
      const hit = hits.find((h) => h.symbol === usSym) || hits[0];
      if (hit) {
        secid = hit.secid;
        resolvedSymbol = hit.symbol;
        setCached(`us_secid:${hit.symbol}`, hit.secid, 24 * 3600_000);
      }
    }
  }

  let flowRes: { name: string; bars: EastmoneyFundFlowBar[] } | null = null;
  let source = 'AKShare · 东方财富日线主力资金流向';

  if (secid) {
    flowRes = await fetchEastmoneyFundFlowBySecid(secid, days);
  } else if (normMarket === 'US' && /^[A-Z]{1,6}(?:-[A-Z]{1,2})?$/.test(resolvedSymbol)) {
    const candidates = [`105.${resolvedSymbol}`, `106.${resolvedSymbol}`, `107.${resolvedSymbol}`];
    const probeResults = await Promise.all(
      candidates.map(async (c) => ({ secid: c, res: await fetchEastmoneyFundFlowBySecid(c, days) }))
    );
    const hit = probeResults.find((r) => r.res !== null);
    if (hit && hit.res) {
      setCached(`us_secid:${resolvedSymbol}`, hit.secid, 24 * 3600_000);
      flowRes = hit.res;
    }
  }

  // Fallback 1 (CN real L2 order-size money flow from Sina Finance)
  if (!flowRes && normMarket === 'CN' && /^\d{6}$/.test(cnCode6)) {
    const [sinaBars, liveMap] = await Promise.all([
      fetchSinaCnFundFlow(cnCode6, days),
      fetchTencentBatchQuotes([{ market: 'CN', symbol: cnCode6 }]),
    ]);
    if (sinaBars && sinaBars.length > 0) {
      const liveName = liveMap.get(`CN:${cnCode6}`)?.name || cnCode6;
      flowRes = { name: liveName, bars: sinaBars };
      source = 'AKShare · 新浪财经实盘分档资金流向';
    }
  }

  // Fallback 2 (Real OHLCV + 15m intraday dollar flow decomposition for US / HK / CN)
  if (!flowRes) {
    const ohlcvFlow = await computeOhlcvFundFlowFallback(normMarket, resolvedSymbol, days);
    if (ohlcvFlow && ohlcvFlow.bars.length > 0) {
      resolvedSymbol = ohlcvFlow.symbol;
      flowRes = { name: ohlcvFlow.name, bars: ohlcvFlow.bars };
      source = ohlcvFlow.source;
    }
  }

  if (!flowRes) {
    throw new Error(`暂未获取到 ${resolvedSymbol} 的主力资金流向历史序列`);
  }

  const currency = normMarket === 'CN' ? 'CNY' : normMarket === 'HK' ? 'HKD' : 'USD';
  const payload = {
    market: normMarket,
    symbol: resolvedSymbol,
    name: flowRes.name,
    currency,
    source,
    bars: flowRes.bars,
    updatedAt: new Date().toISOString(),
  };

  setCached(cacheKey, payload, 60_000);
  return payload;
}

interface TencentLiveQuote {
  key: string; // e.g. "US:NVDA", "HK:00700", "CN:510300"
  code: string;
  name: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  date: string;
  updatedAt: string;
}

function cnToTencentSymbol(code: string): string {
  if (code.startsWith('6') || code.startsWith('5') || code.startsWith('9')) {
    return `sh${code}`;
  }
  return `sz${code}`;
}

function toTencentParam(market: 'US' | 'HK' | 'CN', symbol: string): {
  param: string;
  mapKey: string;
} {
  if (market === 'CN') {
    const code = normalizeCnCode(symbol);
    return { param: cnToTencentSymbol(code), mapKey: `CN:${code}` };
  }
  if (market === 'HK') {
    const code5 = normalizeHk5Digits(symbol);
    return { param: `hk${code5}`, mapKey: `HK:${code5}` };
  }
  const usSym = normalizeUsSymbol(symbol);
  return { param: `us${usSym}`, mapKey: `US:${usSym}` };
}

function parseTencentTime(
  marketPrefix: 'v_us' | 'v_hk' | 'v_cn',
  rawTime: string
): { dateStr: string; isoUpdated: string } {
  const trimmed = rawTime.trim();
  if (marketPrefix === 'v_cn') {
    const m = trimmed.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (m) {
      const d = `${m[1]}-${m[2]}-${m[3]}`;
      return { dateStr: d, isoUpdated: `${d}T${m[4]}:${m[5]}:${m[6]}+08:00` };
    }
  } else if (marketPrefix === 'v_hk') {
    const m = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})/);
    if (m) {
      const d = `${m[1]}-${m[2]}-${m[3]}`;
      return { dateStr: d, isoUpdated: `${d}T${m[4]}+08:00` };
    }
  } else {
    const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
    if (m) {
      return { dateStr: m[1], isoUpdated: `${m[1]}T${m[2]}-05:00` };
    }
  }
  return { dateStr: toIsoDate(new Date()), isoUpdated: new Date().toISOString() };
}

async function fetchTencentBatchQuotes(
  targets: Array<{ market: 'US' | 'HK' | 'CN'; symbol: string }>
): Promise<Map<string, TencentLiveQuote>> {
  const map = new Map<string, TencentLiveQuote>();
  if (targets.length === 0) return map;

  try {
    const paramToKey = new Map<string, string>();
    const params: string[] = [];
    for (const t of targets) {
      const { param, mapKey } = toTencentParam(t.market, t.symbol);
      if (!paramToKey.has(param)) {
        paramToKey.set(param, mapKey);
        params.push(param);
      }
    }

    const url = `https://qt.gtimg.cn/q=${params.join(',')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timer);
    if (!resp.ok) return map;

    const buf = await resp.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);

    for (const line of text.split(';')) {
      const m = line.match(/v_([a-zA-Z0-9._-]+)="([^"]+)"/);
      if (!m) continue;
      const rawVar = m[1];
      const parts = m[2].split('~');
      if (parts.length < 35) continue;

      let mapKey = paramToKey.get(rawVar);
      let marketKind: 'v_us' | 'v_hk' | 'v_cn' = 'v_cn';
      if (rawVar.startsWith('us')) {
        marketKind = 'v_us';
        if (!mapKey) mapKey = `US:${rawVar.slice(2).toUpperCase()}`;
      } else if (rawVar.startsWith('hk')) {
        marketKind = 'v_hk';
        if (!mapKey) mapKey = `HK:${rawVar.slice(2)}`;
      } else {
        const codeMatch = rawVar.match(/^(?:sh|sz)(\d+)$/);
        if (codeMatch && !mapKey) mapKey = `CN:${codeMatch[1]}`;
      }
      if (!mapKey) continue;

      const price = parseFloat(parts[3]);
      if (!Number.isFinite(price) || price <= 0) continue;

      const prevCloseRaw = parseFloat(parts[4]);
      const prevClose = Number.isFinite(prevCloseRaw) && prevCloseRaw > 0 ? prevCloseRaw : price;
      const openRaw = parseFloat(parts[5]);
      const open = Number.isFinite(openRaw) && openRaw > 0 ? openRaw : price;
      const changeRaw = parseFloat(parts[31]);
      const changePctRaw = parseFloat(parts[32]);
      const highRaw = parseFloat(parts[33]);
      const lowRaw = parseFloat(parts[34]);

      const { dateStr, isoUpdated } = parseTencentTime(marketKind, parts[30] || '');

      map.set(mapKey, {
        key: mapKey,
        code: mapKey.split(':')[1] || parts[2],
        name: (parts[1] || '').trim() || mapKey.split(':')[1],
        price,
        prevClose,
        open,
        high: Number.isFinite(highRaw) && highRaw > 0 ? highRaw : price,
        low: Number.isFinite(lowRaw) && lowRaw > 0 ? lowRaw : price,
        change: Number.isFinite(changeRaw) ? changeRaw : price - prevClose,
        changePct: Number.isFinite(changePctRaw)
          ? changePctRaw
          : prevClose > 0
            ? ((price - prevClose) / prevClose) * 100
            : 0,
        date: dateStr,
        updatedAt: isoUpdated,
      });
    }
  } catch {
    // non-fatal
  }

  return map;
}

function mergeLiveQuoteIntoBars(bars: OhlcvBar[], live: TencentLiveQuote | undefined): OhlcvBar[] {
  if (!live || bars.length === 0) return bars;
  const copy = [...bars];
  const last = copy[copy.length - 1];
  if (last.date === live.date) {
    copy[copy.length - 1] = {
      ...last,
      open: live.open > 0 ? live.open : last.open,
      high: Math.max(last.high, live.high, live.price),
      low: Math.min(last.low, live.low, live.price),
      close: live.price,
    };
  } else if (live.date > last.date) {
    copy.push({
      date: live.date,
      open: live.open,
      high: live.high,
      low: live.low,
      close: live.price,
      volume: last.volume,
    });
  }
  return copy;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function fetchYahooChart(
  yahooSymbol: string,
  days: number
): Promise<{ name: string; currency: string; bars: OhlcvBar[] }> {
  const period1 = new Date(Date.now() - days * 24 * 3600 * 1000);
  const result = await yahooFinance.chart(yahooSymbol, {
    period1,
    interval: '1d',
  });

  const bars: OhlcvBar[] = [];
  for (const q of result.quotes || []) {
    if (
      q.date &&
      q.open != null &&
      q.high != null &&
      q.low != null &&
      q.close != null
    ) {
      bars.push({
        date: toIsoDate(new Date(q.date)),
        open: Number(q.open),
        high: Number(q.high),
        low: Number(q.low),
        close: Number(q.close),
        volume: Number(q.volume ?? 0),
      });
    }
  }

  // Deduplicate by date preserving latest
  const map = new Map<string, OhlcvBar>();
  for (const b of bars) {
    map.set(b.date, b);
  }
  const deduped = Array.from(map.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  if (deduped.length === 0) {
    throw new Error(`未获取到 ${yahooSymbol} 的有效K线数据`);
  }

  return {
    name: result.meta?.shortName || result.meta?.longName || yahooSymbol,
    currency: result.meta?.currency || 'USD',
    bars: deduped,
  };
}

function toFiniteNumber(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function toIsoString(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.toISOString();
  if (typeof val === 'number' && Number.isFinite(val)) {
    const ms = val > 1e12 ? val : val * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof val === 'string') {
    const dt = new Date(val);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  return null;
}

function extractExtendedQuote(q: Record<string, unknown> | null | undefined) {
  if (!q) return null;
  const regularPrice = toFiniteNumber(q.regularMarketPrice);
  const regularChange = toFiniteNumber(q.regularMarketChange);
  const regularChangePct = toFiniteNumber(q.regularMarketChangePercent);
  const preMarketPrice = toFiniteNumber(q.preMarketPrice);
  const preMarketChange =
    toFiniteNumber(q.preMarketChange) ??
    (preMarketPrice !== null && regularPrice !== null
      ? preMarketPrice - regularPrice
      : null);
  const preMarketChangePct =
    toFiniteNumber(q.preMarketChangePercent) ??
    (preMarketPrice !== null && regularPrice !== null && regularPrice > 0
      ? ((preMarketPrice - regularPrice) / regularPrice) * 100
      : null);

  const postMarketPrice = toFiniteNumber(q.postMarketPrice);
  const postMarketChange =
    toFiniteNumber(q.postMarketChange) ??
    (postMarketPrice !== null && regularPrice !== null
      ? postMarketPrice - regularPrice
      : null);
  const postMarketChangePct =
    toFiniteNumber(q.postMarketChangePercent) ??
    (postMarketPrice !== null && regularPrice !== null && regularPrice > 0
      ? ((postMarketPrice - regularPrice) / regularPrice) * 100
      : null);

  return {
    marketState: typeof q.marketState === 'string' ? q.marketState : 'CLOSED',
    hasPrePostMarketData: Boolean(q.hasPrePostMarketData),
    exchangeDataDelayedBy: toFiniteNumber(q.exchangeDataDelayedBy),
    regularPrice,
    regularChange,
    regularChangePct,
    regularTime: toIsoString(q.regularMarketTime),
    preMarketPrice,
    preMarketChange,
    preMarketChangePct,
    preMarketTime: toIsoString(q.preMarketTime),
    postMarketPrice,
    postMarketChange,
    postMarketChangePct,
    postMarketTime: toIsoString(q.postMarketTime),
  };
}

const etFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatEtDateAndTime(d: Date): { etDate: string; etTimeLabel: string } {
  const parts = etFormatter.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    etDate: `${get('year')}-${get('month')}-${get('day')}`,
    etTimeLabel: `${hour}:${get('minute')}`,
  };
}

async function fetchYahooUsExtendedBars(yahooSymbol: string) {
  const period1 = new Date(Date.now() - 4 * 24 * 3600 * 1000);
  const result = await yahooFinance.chart(yahooSymbol, {
    period1,
    interval: '5m',
    includePrePost: true,
  });

  const allBars: Array<{
    timestamp: string;
    etDate: string;
    etTimeLabel: string;
    session: 'pre' | 'regular' | 'post';
    price: number;
    volume: number;
  }> = [];

  for (const q of result.quotes || []) {
    if (!q.date || q.close == null) continue;
    const dt = new Date(q.date);
    const { etDate, etTimeLabel } = formatEtDateAndTime(dt);
    const session: 'pre' | 'regular' | 'post' =
      etTimeLabel < '09:30'
        ? 'pre'
        : etTimeLabel < '16:00'
          ? 'regular'
          : 'post';
    allBars.push({
      timestamp: dt.toISOString(),
      etDate,
      etTimeLabel,
      session,
      price: Number(q.close),
      volume: Number(q.volume ?? 0),
    });
  }

  if (allBars.length === 0) {
    return { bars: [], prevClose: toFiniteNumber(result.meta?.chartPreviousClose) };
  }

  const dates = Array.from(new Set(allBars.map((b) => b.etDate))).sort();
  const latestDate = dates[dates.length - 1];
  const latestBars = allBars.filter((b) => b.etDate === latestDate);
  const hasRegularToday = latestBars.some((b) => b.session === 'regular');

  let selectedBars = latestBars;
  let prevClose = toFiniteNumber(result.meta?.chartPreviousClose);

  if (!hasRegularToday && dates.length >= 2) {
    // Currently in US pre-market (or early pre-open): include previous session regular+post leading into today's pre-market
    const prevDate = dates[dates.length - 2];
    const prevSessionBars = allBars.filter(
      (b) => b.etDate === prevDate && (b.session === 'regular' || b.session === 'post')
    );
    const prevRegBars = prevSessionBars.filter((b) => b.session === 'regular');
    if (prevRegBars.length > 0) {
      prevClose = prevRegBars[prevRegBars.length - 1].price;
    }
    selectedBars = [...prevSessionBars, ...latestBars];
  } else if (dates.length >= 2) {
    const prevDate = dates[dates.length - 2];
    const prevRegBars = allBars.filter(
      (b) => b.etDate === prevDate && b.session === 'regular'
    );
    if (prevRegBars.length > 0) {
      prevClose = prevRegBars[prevRegBars.length - 1].price;
    }
  }

  return {
    bars: selectedBars,
    prevClose,
  };
}

async function fetchMacroSnapshot(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCached<unknown>('macro_snapshot');
    if (cached) return cached;
  }

  const specs = [
    { id: 'gold', label: '国际黄金', symbol: 'GC=F', unit: 'USD/oz', category: 'commodity' },
    { id: 'silver', label: '国际白银', symbol: 'SI=F', unit: 'USD/oz', category: 'commodity' },
    { id: 'btc', label: 'BTC', symbol: 'BTC-USD', unit: 'USD', category: 'crypto' },
    { id: 'eth', label: 'ETH', symbol: 'ETH-USD', unit: 'USD', category: 'crypto' },
    { id: 'usdcny', label: 'USD / CNY', symbol: 'CNY=X', unit: 'FX', category: 'fx' },
    { id: 'hkdcny', label: 'HKD / CNY', symbol: 'HKDCNY=X', unit: 'FX', category: 'fx' },
  ] as const;

  const quotes = await Promise.all(
    specs.map(async (spec) => {
      try {
        const q = await withTimeout(
          yahooFinance.quote(spec.symbol).catch(() => null),
          2500,
          null
        );
        const price =
          typeof q?.regularMarketPrice === 'number' ? q.regularMarketPrice : null;
        let changePct =
          typeof q?.regularMarketChangePercent === 'number'
            ? q.regularMarketChangePercent
            : null;
        if (
          price !== null &&
          changePct === null &&
          typeof q?.regularMarketPreviousClose === 'number' &&
          q.regularMarketPreviousClose > 0
        ) {
          changePct =
            ((price - q.regularMarketPreviousClose) / q.regularMarketPreviousClose) * 100;
        }
        return {
          ...spec,
          price,
          changePct,
        };
      } catch {
        return {
          ...spec,
          price: null,
          changePct: null,
        };
      }
    })
  );

  const goldPrice = quotes.find((q) => q.id === 'gold')?.price ?? null;
  const silverPrice = quotes.find((q) => q.id === 'silver')?.price ?? null;
  const ratio =
    goldPrice && silverPrice && silverPrice > 0 ? goldPrice / silverPrice : null;

  const items = [
    quotes[0],
    quotes[1],
    {
      id: 'au_ag',
      label: '金银比 Au/Ag',
      symbol: 'AU/AG',
      price: ratio,
      changePct: null,
      unit: 'Ratio',
      category: 'commodity' as const,
    },
    quotes[2],
    quotes[3],
    quotes[4],
    quotes[5],
  ];

  const usdCny = quotes.find((q) => q.id === 'usdcny')?.price ?? 7.24;
  const hkdCny = quotes.find((q) => q.id === 'hkdcny')?.price ?? 0.93;

  const payload = {
    items,
    usdCny,
    hkdCny,
    updatedAt: new Date().toISOString(),
  };

  setCached('macro_snapshot', payload, 15_000);
  return payload;
}

async function fetchHistBarsCached(
  key: string,
  loader: () => Promise<{
    name: string;
    currency: string;
    bars: OhlcvBar[];
    source: string;
    resolvedTicker?: string;
  }>
) {
  const cached = getCached<{
    name: string;
    currency: string;
    bars: OhlcvBar[];
    source: string;
    resolvedTicker?: string;
  }>(key);
  if (cached) return cached;
  const loaded = await loader();
  setCached(key, loaded, 300_000); // Daily historical bars cached 5 min for fast live quote overlays
  return loaded;
}

async function fetchStockData(
  market: string,
  symbol: string,
  days: number,
  options?: {
    forceRefresh?: boolean;
    includeExtendedIntraday?: boolean;
    prefetchedLive?: TencentLiveQuote;
  }
) {
  const normMarket = market.toUpperCase();
  const cleanSym = symbol.trim().toUpperCase();
  const includeIntraday = options?.includeExtendedIntraday !== false;
  const cacheKey = `stock:${normMarket}:${cleanSym}:${days}:${
    normMarket === 'US' && includeIntraday ? 'ext' : 'base'
  }`;

  if (!options?.forceRefresh && !options?.prefetchedLive) {
    const cached = getCached<unknown>(cacheKey);
    if (cached) return cached;
  }

  if (normMarket === 'US') {
    let usSym = normalizeUsSymbol(symbol);
    const isAsciiTicker = /^[A-Z]{1,6}(?:-[A-Z]{1,2})?$/.test(usSym);

    type ExtIntradayResult = {
      bars: Array<{
        timestamp: string;
        etDate: string;
        etTimeLabel: string;
        session: 'pre' | 'regular' | 'post';
        price: number;
        volume: number;
      }>;
      prevClose: number | null;
    };
    const emptyExt: ExtIntradayResult = { bars: [], prevClose: null };

    const getExtendedEnrichment = (sym: string): Promise<[Record<string, unknown> | null, ExtIntradayResult]> => {
      if (!includeIntraday) return Promise.resolve([null, emptyExt]);
      const yQuoteKey = `yquote:US:${sym}`;
      const yExtKey = `yext:US:${sym}`;
      const cachedYQ = !options?.forceRefresh ? getCached<Record<string, unknown>>(yQuoteKey) : null;
      const cachedYExt = !options?.forceRefresh ? getCached<ExtIntradayResult>(yExtKey) : null;

      const yQuotePromise = cachedYQ
        ? Promise.resolve(cachedYQ)
        : yahooFinance
            .quote(sym)
            .then((q) => {
              const rec = q as unknown as Record<string, unknown>;
              setCached(yQuoteKey, rec, 15_000);
              return rec;
            })
            .catch(() => null);

      const yExtPromise = cachedYExt
        ? Promise.resolve(cachedYExt)
        : fetchYahooUsExtendedBars(sym)
            .then((res) => {
              setCached(yExtKey, res, 45_000);
              return res;
            })
            .catch(() => emptyExt);

      return Promise.all([
        cachedYQ ? yQuotePromise : withTimeout(yQuotePromise, 1200, null),
        cachedYExt ? yExtPromise : withTimeout(yExtPromise, 1200, emptyExt),
      ]);
    };

    // 1. Run AKShare/Eastmoney K-lines + Tencent real-time quote + optional pre/post-market in parallel
    const [emResult, initialLiveMap, initialExtPair] = await Promise.all([
      fetchHistBarsCached(`hist:US:em:${usSym}:${days}`, async () => {
        const em = await resolveAndFetchUsEastmoneyKlines(symbol, days);
        if (em) {
          return {
            name: em.name,
            currency: 'USD',
            bars: em.bars,
            source: `AKShare · 东方财富 (${em.symbol})`,
            resolvedTicker: em.symbol,
          };
        }
        // Fallback to Yahoo chart if Eastmoney lacks this ticker
        let ySym = usSym;
        try {
          const y = await fetchYahooChart(ySym, days);
          return { ...y, source: 'Yahoo Finance', resolvedTicker: ySym };
        } catch (firstErr) {
          const fallbackSym = await resolveUsTickerViaSearch(symbol);
          if (!fallbackSym || fallbackSym === ySym) throw firstErr;
          ySym = fallbackSym;
          const y = await fetchYahooChart(ySym, days);
          return { ...y, source: 'Yahoo Finance', resolvedTicker: ySym };
        }
      }),
      options?.prefetchedLive
        ? Promise.resolve(new Map([[`US:${usSym}`, options.prefetchedLive]]))
        : isAsciiTicker
          ? fetchTencentBatchQuotes([{ market: 'US', symbol: usSym }])
          : Promise.resolve(new Map<string, TencentLiveQuote>()),
      isAsciiTicker ? getExtendedEnrichment(usSym) : Promise.resolve<[Record<string, unknown> | null, ExtIntradayResult]>([null, emptyExt]),
    ]);

    if (emResult.resolvedTicker) {
      usSym = emResult.resolvedTicker;
    }

    let live = initialLiveMap.get(`US:${usSym}`);
    let [rawYahooQuote, extIntraday] = initialExtPair;

    if (!live && /^[A-Z]{1,6}(?:-[A-Z]{1,2})?$/.test(usSym)) {
      const [retryMap, extPair] = await Promise.all([
        fetchTencentBatchQuotes([{ market: 'US', symbol: usSym }]),
        !isAsciiTicker && includeIntraday ? getExtendedEnrichment(usSym) : Promise.resolve(initialExtPair),
      ]);
      live = retryMap.get(`US:${usSym}`);
      [rawYahooQuote, extIntraday] = extPair;
    }
    const mergedBars = mergeLiveQuoteIntoBars(emResult.bars, live);

    const yahooExt = extractExtendedQuote(rawYahooQuote);
    const extendedQuote = yahooExt
      ? {
          ...yahooExt,
          regularPrice: live?.price ?? yahooExt.regularPrice,
          regularChange: live?.change ?? yahooExt.regularChange,
          regularChangePct: live?.changePct ?? yahooExt.regularChangePct,
          regularTime: live?.updatedAt ?? yahooExt.regularTime,
        }
      : live
        ? {
            marketState: 'REGULAR',
            hasPrePostMarketData: false,
            exchangeDataDelayedBy: 0,
            regularPrice: live.price,
            regularChange: live.change,
            regularChangePct: live.changePct,
            regularTime: live.updatedAt,
            preMarketPrice: null,
            preMarketChange: null,
            preMarketChangePct: null,
            preMarketTime: null,
            postMarketPrice: null,
            postMarketChange: null,
            postMarketChangePct: null,
            postMarketTime: null,
          }
        : null;

    const displayName =
      live?.name ||
      (emResult.name && emResult.name !== usSym ? emResult.name : '') ||
      (typeof rawYahooQuote?.shortName === 'string' ? String(rawYahooQuote.shortName) : usSym);

    const payload = {
      market: 'US',
      symbol: usSym,
      resolvedSymbol: usSym,
      name: displayName,
      currency: 'USD',
      bars: mergedBars,
      source: live ? 'AKShare (东方财富K线 + 腾讯实时)' : emResult.source,
      extendedQuote,
      extendedBars: extIntraday.bars,
      prevClose: extIntraday.prevClose ?? live?.prevClose ?? null,
      quoteDelayMinutes: live ? 0 : yahooExt?.exchangeDataDelayedBy ?? null,
      quoteUpdatedAt:
        live?.updatedAt ||
        yahooExt?.preMarketTime ||
        yahooExt?.postMarketTime ||
        yahooExt?.regularTime ||
        new Date().toISOString(),
    };
    setCached(cacheKey, payload, 10_000);
    return payload;
  }

  if (normMarket === 'HK') {
    let resolvedRaw = cleanSym;
    if (!/^\d+$/.test(cleanSym.replace(/\.HK$/i, ''))) {
      const hkHits = await searchEastmoneySuggest(symbol, 'HK');
      if (hkHits.length > 0) {
        resolvedRaw = hkHits[0].symbol;
      }
    }
    const code5 = normalizeHk5Digits(resolvedRaw);
    const secid = `116.${code5}`;
    const yahooHk = `${code5.replace(/^0(?=\d{4}$)/, '')}.HK`;

    const [hist, liveMap] = await Promise.all([
      fetchHistBarsCached(`hist:HK:em:${code5}:${days}`, async () => {
        const em = await fetchEastmoneyKlinesBySecid(secid, days);
        if (em) {
          return {
            name: em.name,
            currency: 'HKD',
            bars: em.bars,
            source: 'AKShare (东方财富前复权)',
          };
        }
        const y = await fetchYahooChart(yahooHk, days);
        return { ...y, source: 'Yahoo Finance' };
      }),
      options?.prefetchedLive
        ? Promise.resolve(new Map([[`HK:${code5}`, options.prefetchedLive]]))
        : fetchTencentBatchQuotes([{ market: 'HK', symbol: code5 }]),
    ]);

    const live = liveMap.get(`HK:${code5}`);
    const mergedBars = mergeLiveQuoteIntoBars(hist.bars, live);
    const shortHk = code5.replace(/^0(?=\d{4}$)/, '');

    const payload = {
      market: 'HK',
      symbol: shortHk,
      resolvedSymbol: yahooHk,
      name: live?.name || hist.name,
      currency: 'HKD',
      bars: mergedBars,
      source: live ? 'AKShare (东方财富前复权 + 腾讯实时)' : hist.source,
      extendedQuote: live
        ? {
            marketState: 'REGULAR',
            hasPrePostMarketData: false,
            exchangeDataDelayedBy: 0,
            regularPrice: live.price,
            regularChange: live.change,
            regularChangePct: live.changePct,
            regularTime: live.updatedAt,
            preMarketPrice: null,
            preMarketChange: null,
            preMarketChangePct: null,
            preMarketTime: null,
            postMarketPrice: null,
            postMarketChange: null,
            postMarketChangePct: null,
            postMarketTime: null,
          }
        : null,
      quoteDelayMinutes: live ? 0 : 15,
      quoteUpdatedAt: live?.updatedAt || new Date().toISOString(),
    };
    setCached(cacheKey, payload, 10_000);
    return payload;
  }

  if (normMarket === 'CN') {
    let code = normalizeCnCode(cleanSym);
    let cnSecid: string | null = null;
    if (!/^\d{6}$/.test(code)) {
      const cnHits = await searchEastmoneySuggest(symbol, 'CN');
      if (cnHits.length > 0) {
        code = normalizeCnCode(cnHits[0].symbol);
        cnSecid = cnHits[0].secid;
      }
    }
    const marketId =
      code.startsWith('6') || code.startsWith('5') || code.startsWith('9') ? '1' : '0';
    const secid = cnSecid || `${marketId}.${code}`;

    const [hist, liveMap] = await Promise.all([
      fetchHistBarsCached(`hist:CN:em:${code}:${days}`, async () => {
        const em = await fetchEastmoneyKlinesBySecid(secid, days);
        if (em) {
          return {
            name: em.name,
            currency: 'CNY',
            bars: em.bars,
            source: 'AKShare (东方财富前复权)',
          };
        }
        const yahooSym = cnToYahooSymbol(code);
        const res = await fetchYahooChart(yahooSym, days);
        return { ...res, source: 'Yahoo Finance' };
      }),
      options?.prefetchedLive
        ? Promise.resolve(new Map([[`CN:${code}`, options.prefetchedLive]]))
        : fetchTencentBatchQuotes([{ market: 'CN', symbol: code }]),
    ]);

    const live = liveMap.get(`CN:${code}`);
    const mergedBars = mergeLiveQuoteIntoBars(hist.bars, live);

    const payload = {
      market: 'CN',
      symbol: code,
      resolvedSymbol: code,
      name: live?.name || hist.name,
      currency: 'CNY',
      bars: mergedBars,
      source: live ? 'AKShare (东方财富前复权 + 腾讯实时)' : hist.source,
      quoteDelayMinutes: live ? 0 : 15,
      quoteUpdatedAt: live?.updatedAt || new Date().toISOString(),
    };
    setCached(cacheKey, payload, 10_000);
    return payload;
  }

  throw new Error(`不支持的市场类型: ${market}`);
}

interface StockNewsItemServer {
  title: string;
  publisher: string;
  publishedAt: string | null;
  url: string;
  sourceType: 'news_api' | 'web_grounding';
}

interface StockNewsDigestServer {
  market: string;
  symbol: string;
  resolvedName: string;
  marketSummary: string;
  earningsPeriod: string;
  earningsSummary: string[];
  bullishCatalysts: string[];
  bearishRisks: string[];
  newsItems: StockNewsItemServer[];
  aiAvailable: boolean;
  aiError?: string;
  updatedAt: string;
  cached: boolean;
}

function resolveYahooSymbolForNews(market: string, symbol: string): string {
  const normMarket = market.toUpperCase();
  const cleanSym = symbol.trim().toUpperCase();
  if (normMarket === 'HK') return normalizeHkSymbol(cleanSym);
  if (normMarket === 'CN') return cnToYahooSymbol(normalizeCnCode(cleanSym));
  return cleanSym;
}

async function fetchYahooNewsItems(
  market: string,
  symbol: string,
  stockName: string
): Promise<StockNewsItemServer[]> {
  try {
    const yahooSym = resolveYahooSymbolForNews(market, symbol);
    const searchRes = await yahooFinance.search(yahooSym, {
      newsCount: 10,
      quotesCount: 0,
    });
    let list = Array.isArray(searchRes?.news) ? searchRes.news : [];
    if (list.length === 0 && stockName) {
      const nameRes = await yahooFinance.search(stockName, {
        newsCount: 8,
        quotesCount: 0,
      });
      list = Array.isArray(nameRes?.news) ? nameRes.news : [];
    }

    const scored: Array<{ score: number; item: StockNewsItemServer }> = [];
    for (const n of list) {
      const title = typeof n?.title === 'string' ? n.title.trim() : '';
      const url = typeof n?.link === 'string' ? n.link.trim() : '';
      if (!title || !url || !url.startsWith('http')) continue;
      const related = Array.isArray(n?.relatedTickers) ? n.relatedTickers : [];
      const matchesTicker = related.some(
        (t) => String(t).toUpperCase() === yahooSym.toUpperCase() || String(t).toUpperCase() === symbol.toUpperCase()
      );
      const matchesName =
        title.toUpperCase().includes(symbol.toUpperCase()) ||
        (stockName && title.toLowerCase().includes(stockName.toLowerCase()));
      const score = (matchesTicker ? 2 : 0) + (matchesName ? 1 : 0);
      scored.push({
        score,
        item: {
          title,
          publisher:
            typeof n?.publisher === 'string' && n.publisher.trim()
              ? n.publisher.trim()
              : 'Yahoo Finance',
          publishedAt: toIsoString(n?.providerPublishTime),
          url,
          sourceType: 'news_api',
        },
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 6).map((s) => s.item);
  } catch {
    return [];
  }
}

function parseJsonFromGeminiText(raw: string): {
  marketSummary?: string;
  earningsPeriod?: string;
  earningsSummary?: string[];
  bullishCatalysts?: string[];
  bearishRisks?: string[];
} | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function toCleanStringArray(val: unknown, maxItems = 4): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x.length > 0)
    .slice(0, maxItems);
}

async function fetchGeminiStockNews(
  market: string,
  symbol: string,
  stockName: string,
  yahooHeadlines: StockNewsItemServer[]
) {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      '未检测到 GEMINI_API_KEY，请在 Settings > Secrets 中配置后再启用 AI 联网搜索摘要'
    );
  }

  const normMarket = market.toUpperCase();
  const marketCn =
    normMarket === 'CN' ? '中国A股' : normMarket === 'HK' ? '中国香港港股' : '美国股市';
  const todayStr = new Date().toISOString().slice(0, 10);
  const headlineContext =
    yahooHeadlines.length > 0
      ? `\n补充参考的近期财经新闻标题：\n${yahooHeadlines
          .slice(0, 4)
          .map((h, i) => `${i + 1}. ${h.title} (${h.publisher})`)
          .join('\n')}`
      : '';

  const prompt = `今天是 ${todayStr}。请利用 Google Search 联网搜索以下股票截至今天的最新市场新闻动态、最近一期已发布的财报核心数据与业绩指引，以及当前市场关注的多空催化因素。

目标标的：${marketCn} · 代码 ${symbol}${stockName ? ` · 名称 ${stockName}` : ''}${headlineContext}

请严格只输出一个合法的 JSON 对象（不要输出额外说明文字），结构如下：
{
  "marketSummary": "用2-3句简明中文概括该股近期的核心市场动态、重要新闻或行业催化事件",
  "earningsPeriod": "最新已发布财报的报告期（如 2026 Q3、2026 半年报、2025 年报等；若为ETF指数基金请写 基金规模与重仓动向）",
  "earningsSummary": [
    "最新财报/业绩核心要点1（含营收或利润同比、预期差或指引变化，若为ETF则写资金流向与权重板块）",
    "最新财报/业绩核心要点2",
    "最新财报/业绩核心要点3"
  ],
  "bullishCatalysts": [
    "当前主要多头利好催化1",
    "当前主要多头利好催化2"
  ],
  "bearishRisks": [
    "当前主要空头风险或事件隐忧1",
    "当前主要空头风险或事件隐忧2"
  ]
}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('AI 联网搜索返回内容为空');
  }

  const parsed = parseJsonFromGeminiText(text);
  const groundingChunks =
    response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const groundingNews: StockNewsItemServer[] = [];
  for (const chunk of groundingChunks) {
    const uri = chunk?.web?.uri?.trim();
    const title = chunk?.web?.title?.trim();
    if (!uri || !title || !uri.startsWith('http')) continue;
    let host = '网络信源';
    try {
      host = new URL(uri).hostname.replace(/^www\./, '');
    } catch {
      // ignore URL parse issues
    }
    groundingNews.push({
      title,
      publisher: host,
      publishedAt: null,
      url: uri,
      sourceType: 'web_grounding',
    });
  }

  return {
    marketSummary:
      typeof parsed?.marketSummary === 'string' && parsed.marketSummary.trim()
        ? parsed.marketSummary.trim()
        : text.slice(0, 500),
    earningsPeriod:
      typeof parsed?.earningsPeriod === 'string' && parsed.earningsPeriod.trim()
        ? parsed.earningsPeriod.trim()
        : '最新公开财报与动态',
    earningsSummary: toCleanStringArray(parsed?.earningsSummary, 4),
    bullishCatalysts: toCleanStringArray(parsed?.bullishCatalysts, 3),
    bearishRisks: toCleanStringArray(parsed?.bearishRisks, 3),
    groundingNews,
  };
}

function formatGeminiErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('"code":429') || raw.includes('429')) {
    return 'Gemini API 额度或频率已达上限 (429)，可在 Settings > Secrets 检查或升级 API Key 配额后重试';
  }
  if (
    raw.includes('API_KEY_INVALID') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('"code":403') ||
    raw.includes('"code":400')
  ) {
    return 'Gemini API Key 无效或权限不足，请在 Settings > Secrets 中核对配置';
  }
  if (raw.includes('NOT_FOUND') || raw.includes('"code":404')) {
    return 'AI 检索模型暂不可用 (404)，请稍后重试';
  }
  return raw || 'AI 联网搜索摘要暂时不可用';
}

async function fetchStockNewsDigest(
  market: string,
  symbol: string,
  stockName: string,
  forceRefresh = false
): Promise<StockNewsDigestServer> {
  const normMarket = market.toUpperCase();
  const cleanSym = symbol.trim().toUpperCase();
  const cacheKey = `stock_news:${normMarket}:${cleanSym}`;

  if (!forceRefresh) {
    const cached = getCached<StockNewsDigestServer>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  const yahooNews = await fetchYahooNewsItems(normMarket, cleanSym, stockName);

  let aiAvailable = false;
  let aiError: string | undefined;
  let marketSummary = '';
  let earningsPeriod = '最新财报与基本面动态';
  let earningsSummary: string[] = [];
  let bullishCatalysts: string[] = [];
  let bearishRisks: string[] = [];
  let groundingNews: StockNewsItemServer[] = [];

  try {
    const aiRes = await fetchGeminiStockNews(
      normMarket,
      cleanSym,
      stockName,
      yahooNews
    );
    aiAvailable = true;
    marketSummary = aiRes.marketSummary;
    earningsPeriod = aiRes.earningsPeriod;
    earningsSummary = aiRes.earningsSummary;
    bullishCatalysts = aiRes.bullishCatalysts;
    bearishRisks = aiRes.bearishRisks;
    groundingNews = aiRes.groundingNews;
  } catch (err) {
    aiAvailable = false;
    aiError = formatGeminiErrorMessage(err);
  }

  // Merge and deduplicate news items (real Yahoo Finance headlines first, then grounding web chunks)
  const seenUrls = new Set<string>();
  const mergedNews: StockNewsItemServer[] = [];
  for (const item of [...yahooNews, ...groundingNews]) {
    const normUrl = item.url.split('#')[0];
    if (seenUrls.has(normUrl)) continue;
    seenUrls.add(normUrl);
    mergedNews.push(item);
    if (mergedNews.length >= 8) break;
  }

  if (!aiAvailable && mergedNews.length === 0) {
    throw new Error(aiError || '暂未检索到该标的的近期新闻与财报摘要');
  }

  const payload: StockNewsDigestServer = {
    market: normMarket,
    symbol: cleanSym,
    resolvedName: stockName || cleanSym,
    marketSummary,
    earningsPeriod,
    earningsSummary,
    bullishCatalysts,
    bearishRisks,
    newsItems: mergedNews,
    aiAvailable,
    aiError,
    updatedAt: new Date().toISOString(),
    cached: false,
  };

  if (aiAvailable) {
    setCached(cacheKey, payload, 15 * 60 * 1000); // 15 min server-side cache
  }

  return payload;
}

type SentimentPolarityServer = 'bullish' | 'neutral' | 'bearish';

interface SentimentChannelScoreServer {
  channel: string;
  bullPct: number;
  neutralPct: number;
  bearPct: number;
  heatScore: number;
  summary: string;
}

interface SentimentSignalItemServer {
  sourceType: 'social' | 'news';
  platform: string;
  headline: string;
  polarity: SentimentPolarityServer;
  score: number;
  reason: string;
  url?: string;
}

interface StockSentimentResponseServer {
  market: string;
  symbol: string;
  resolvedName: string;
  heatScore: number;
  sentimentScore: number;
  bullishPct: number;
  neutralPct: number;
  bearishPct: number;
  regimeLabel: string;
  overview: string;
  channels: SentimentChannelScoreServer[];
  items: SentimentSignalItemServer[];
  aiAvailable: boolean;
  aiError?: string;
  updatedAt: string;
  cached: boolean;
}

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function normalizeTriplet(
  rawBull: unknown,
  rawNeutral: unknown,
  rawBear: unknown
): { bullPct: number; neutralPct: number; bearPct: number } {
  const b = Math.max(0, Number(rawBull) || 0);
  const n = Math.max(0, Number(rawNeutral) || 0);
  const r = Math.max(0, Number(rawBear) || 0);
  const sum = b + n + r;
  if (sum <= 0) {
    return { bullPct: 34, neutralPct: 33, bearPct: 33 };
  }
  const bullPct = Math.round((b / sum) * 100);
  const bearPct = Math.round((r / sum) * 100);
  const neutralPct = Math.max(0, 100 - bullPct - bearPct);
  const adjustedBull = bullPct + bearPct + neutralPct === 100 ? bullPct : Math.max(0, 100 - bearPct - neutralPct);
  return { bullPct: adjustedBull, neutralPct, bearPct };
}

function parseSentimentJson(raw: string): Record<string, unknown> | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function fetchGeminiStockSentiment(
  market: string,
  symbol: string,
  stockName: string,
  yahooHeadlines: StockNewsItemServer[]
): Promise<{
  heatScore: number;
  sentimentScore: number;
  bullishPct: number;
  neutralPct: number;
  bearishPct: number;
  regimeLabel: string;
  overview: string;
  channels: SentimentChannelScoreServer[];
  items: SentimentSignalItemServer[];
}> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      '未检测到 GEMINI_API_KEY，请在 Settings > Secrets 中配置后再启用 AI 盘前情绪分析'
    );
  }

  const normMarket = market.toUpperCase();
  const marketCn =
    normMarket === 'CN' ? '中国A股' : normMarket === 'HK' ? '中国香港港股' : '美国股市';
  const socialFocus =
    normMarket === 'US'
      ? 'X (Twitter) 财智标签 ($' + symbol + ')、Reddit (WallStreetBets / stocks)、StockTwits 盘前热议与美股财经新闻'
      : '雪球、东方财富股吧、财联社、X 及财经媒体近期讨论与盘前资讯';
  const todayStr = new Date().toISOString().slice(0, 10);

  const headlineContext =
    yahooHeadlines.length > 0
      ? `\n已抓取的近期真实财经新闻标题（请务必将其纳入情感极性打分中）：\n${yahooHeadlines
          .slice(0, 6)
          .map((h, i) => `${i + 1}. [${h.publisher}] ${h.title}`)
          .join('\n')}`
      : '';

  const prompt = `今天是 ${todayStr}。请作为量化情绪分析师，利用 Google Search 联网检索目标股票截至目前的盘前市场讨论与舆情动向（覆盖 ${socialFocus}），并结合下方新闻标题进行多空情感极性量化分析。

目标标的：${marketCn} · 代码 ${symbol}${stockName ? ` · 名称 ${stockName}` : ''}${headlineContext}

请严格只输出一个合法的 JSON 对象（不要输出 Markdown 以外的解释文字），结构如下：
{
  "heatScore": 0到100之间的整数，表示盘前社交媒体与新闻总讨论热度（50为常态，>75为高热焦点）,
  "sentimentScore": -100到100之间的整数，负数为整体偏空、正数为整体偏多、0附近为多空均衡,
  "bullishPct": 0到100整数，看多声量占比,
  "neutralPct": 0到100整数，中性观望占比,
  "bearishPct": 0到100整数，看空谨慎占比（三者之和必须等于100）,
  "regimeLabel": "简短4-6字中文情绪状态标签，如：多头情绪占优、多空激烈分歧、空头情绪承压、盘前交投观望",
  "overview": "用2句简明中文总结盘前社交媒体情绪与新闻标题的共振方向、核心争论点及交易提示",
  "channels": [
    {
      "channel": "财经新闻媒体",
      "bullPct": 55,
      "neutralPct": 25,
      "bearPct": 20,
      "heatScore": 72,
      "summary": "一句中文概括该渠道多空分歧"
    },
    {
      "channel": "海外社媒 (X / Reddit)",
      "bullPct": 62,
      "neutralPct": 18,
      "bearPct": 20,
      "heatScore": 78,
      "summary": "一句中文概括散户与KOL讨论焦点"
    },
    {
      "channel": "中文社区 (雪球 / 股吧)",
      "bullPct": 50,
      "neutralPct": 28,
      "bearPct": 22,
      "heatScore": 65,
      "summary": "一句中文概括国内投资者情绪"
    },
    {
      "channel": "盘前异动与机构舆情",
      "bullPct": 58,
      "neutralPct": 22,
      "bearPct": 20,
      "heatScore": 70,
      "summary": "一句中文概括评级、期权或盘前订单情绪"
    }
  ],
  "items": [
    {
      "sourceType": "social 或 news",
      "platform": "来源平台名称（如 Reddit、X、雪球、Yahoo Finance、Seeking Alpha、财联社 等）",
      "headline": "新闻标题或社交媒体热门讨论主题（尽量简明准确，可用中文概括或保留核心原文标题）",
      "polarity": "bullish 或 neutral 或 bearish",
      "score": -100到100之间的整数情感分值,
      "reason": "不超过25字的极性判定依据"
    }
  ]
}
注意：items 请给出 6 到 8 条最具代表性的社交媒体讨论与新闻标题，兼顾多空视角。`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('AI 情绪极性分析返回内容为空');
  }

  const parsed = parseSentimentJson(text);
  if (!parsed) {
    throw new Error('AI 返回的情绪分析格式解析失败，请点击重试');
  }

  const overallTriplet = normalizeTriplet(
    parsed.bullishPct,
    parsed.neutralPct,
    parsed.bearishPct
  );

  const groundingChunks =
    response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const groundingUrls = groundingChunks
    .map((c) => ({
      uri: c?.web?.uri?.trim() || '',
      title: c?.web?.title?.trim() || '',
    }))
    .filter((g) => g.uri.startsWith('http'));

  const rawChannels = Array.isArray(parsed.channels) ? parsed.channels : [];
  const channels: SentimentChannelScoreServer[] = rawChannels
    .slice(0, 4)
    .map((c) => {
      const rec = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
      const t = normalizeTriplet(rec.bullPct, rec.neutralPct, rec.bearPct);
      return {
        channel:
          typeof rec.channel === 'string' && rec.channel.trim()
            ? rec.channel.trim()
            : '市场舆情渠道',
        ...t,
        heatScore: clampNum(rec.heatScore, 0, 100, 60),
        summary:
          typeof rec.summary === 'string' && rec.summary.trim()
            ? rec.summary.trim()
            : '盘前声量平稳',
      };
    });

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items: SentimentSignalItemServer[] = rawItems
    .slice(0, 8)
    .map((it) => {
      const rec = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
      const polRaw = String(rec.polarity || '').toLowerCase();
      const score = clampNum(rec.score, -100, 100, 0);
      const polarity: SentimentPolarityServer =
        polRaw === 'bullish' || polRaw === 'bearish' || polRaw === 'neutral'
          ? (polRaw as SentimentPolarityServer)
          : score >= 15
            ? 'bullish'
            : score <= -15
              ? 'bearish'
              : 'neutral';
      const headline =
        typeof rec.headline === 'string' ? rec.headline.trim() : '';
      const sourceType: 'social' | 'news' =
        String(rec.sourceType || '').toLowerCase() === 'social' ? 'social' : 'news';

      // Match real URL from Yahoo headlines or grounding chunks when applicable
      const lowerHead = headline.toLowerCase();
      const matchedYahoo = yahooHeadlines.find(
        (yh) =>
          yh.title.toLowerCase() === lowerHead ||
          (lowerHead.length >= 12 &&
            (yh.title.toLowerCase().includes(lowerHead.slice(0, 18)) ||
              lowerHead.includes(yh.title.toLowerCase().slice(0, 18))))
      );
      const matchedGrounding = !matchedYahoo
        ? groundingUrls.find(
            (g) =>
              g.title &&
              lowerHead.length >= 8 &&
              (g.title.toLowerCase().includes(lowerHead.slice(0, 14)) ||
                lowerHead.includes(g.title.toLowerCase().slice(0, 14)))
          )
        : undefined;

      return {
        sourceType,
        platform:
          typeof rec.platform === 'string' && rec.platform.trim()
            ? rec.platform.trim()
            : sourceType === 'social'
              ? '社交舆情'
              : '财经媒体',
        headline: headline || `${symbol} 盘前舆情动态`,
        polarity,
        score,
        reason:
          typeof rec.reason === 'string' && rec.reason.trim()
            ? rec.reason.trim()
            : polarity === 'bullish'
              ? '偏多催化表述'
              : polarity === 'bearish'
                ? '风险与谨慎表述'
                : '多空观点交织',
        url: matchedYahoo?.url || matchedGrounding?.uri,
      };
    })
    .filter((item) => item.headline.length > 0);

  return {
    heatScore: clampNum(parsed.heatScore, 0, 100, 58),
    sentimentScore: clampNum(
      parsed.sentimentScore,
      -100,
      100,
      overallTriplet.bullPct - overallTriplet.bearPct
    ),
    bullishPct: overallTriplet.bullPct,
    neutralPct: overallTriplet.neutralPct,
    bearishPct: overallTriplet.bearPct,
    regimeLabel:
      typeof parsed.regimeLabel === 'string' && parsed.regimeLabel.trim()
        ? parsed.regimeLabel.trim()
        : overallTriplet.bullPct > overallTriplet.bearPct + 12
          ? '多头情绪占优'
          : overallTriplet.bearPct > overallTriplet.bullPct + 12
            ? '空头情绪承压'
            : '多空分歧平衡',
    overview:
      typeof parsed.overview === 'string' && parsed.overview.trim()
        ? parsed.overview.trim()
        : '已综合检索盘前社交媒体与最新财经媒体标题的情感极性。',
    channels,
    items,
  };
}

async function fetchStockSentiment(
  market: string,
  symbol: string,
  stockName: string,
  forceRefresh = false
): Promise<StockSentimentResponseServer> {
  const normMarket = market.toUpperCase();
  const cleanSym = symbol.trim().toUpperCase();
  const cacheKey = `stock_sentiment:${normMarket}:${cleanSym}`;

  if (!forceRefresh) {
    const cached = getCached<StockSentimentResponseServer>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  const yahooNews = await fetchYahooNewsItems(normMarket, cleanSym, stockName);

  try {
    const aiRes = await fetchGeminiStockSentiment(
      normMarket,
      cleanSym,
      stockName,
      yahooNews
    );
    const payload: StockSentimentResponseServer = {
      market: normMarket,
      symbol: cleanSym,
      resolvedName: stockName || cleanSym,
      ...aiRes,
      aiAvailable: true,
      updatedAt: new Date().toISOString(),
      cached: false,
    };
    setCached(cacheKey, payload, 15 * 60 * 1000);
    return payload;
  } catch (err) {
    const aiError = formatGeminiErrorMessage(err);
    if (yahooNews.length === 0) {
      throw new Error(aiError);
    }
    return {
      market: normMarket,
      symbol: cleanSym,
      resolvedName: stockName || cleanSym,
      heatScore: 0,
      sentimentScore: 0,
      bullishPct: 0,
      neutralPct: 100,
      bearishPct: 0,
      regimeLabel: '待完成 AI 极性分析',
      overview: '',
      channels: [],
      items: yahooNews.map((n) => ({
        sourceType: 'news' as const,
        platform: n.publisher,
        headline: n.title,
        polarity: 'neutral' as const,
        score: 0,
        reason: '待 AI 情感极性打分',
        url: n.url,
      })),
      aiAvailable: false,
      aiError,
      updatedAt: new Date().toISOString(),
      cached: false,
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.get('/api/stock-news', async (req, res) => {
    try {
      const market = String(req.query.market || 'US').trim().toUpperCase();
      const symbol = String(req.query.symbol || 'NVDA').trim().toUpperCase();
      const name = String(req.query.name || '').trim();
      const forceRefresh = req.query.refresh === '1';

      if (!symbol) {
        res.status(400).json({ error: '请提供有效的标的代码' });
        return;
      }

      const data = await fetchStockNewsDigest(market, symbol, name, forceRefresh);
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '获取近期新闻与财报摘要失败';
      res.status(502).json({ error: message });
    }
  });

  app.get('/api/stock-sentiment', async (req, res) => {
    try {
      const market = String(req.query.market || 'US').trim().toUpperCase();
      const symbol = String(req.query.symbol || 'NVDA').trim().toUpperCase();
      const name = String(req.query.name || '').trim();
      const forceRefresh = req.query.refresh === '1';

      if (!symbol) {
        res.status(400).json({ error: '请提供有效的标的代码' });
        return;
      }

      const data = await fetchStockSentiment(market, symbol, name, forceRefresh);
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '获取盘前情绪热度分析失败';
      res.status(502).json({ error: message });
    }
  });

  app.get('/api/macro', async (req, res) => {
    try {
      const data = await fetchMacroSnapshot(req.query.refresh === '1');
      res.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Macro fetch failed';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/stock', async (req, res) => {
    try {
      const market = String(req.query.market || 'US');
      const symbol = String(req.query.symbol || 'NVDA');
      const days = Math.min(2500, Math.max(90, Number(req.query.days || 500)));
      const forceRefresh = req.query.refresh === '1';
      const data = await fetchStockData(market, symbol, days, {
        forceRefresh,
        includeExtendedIntraday: true,
      });
      res.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stock fetch failed';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/options', async (req, res) => {
    try {
      const symbol = normalizeUsSymbol(String(req.query.symbol || 'NVDA'));
      const dateStr = req.query.date ? String(req.query.date).trim() : '';
      const forceRefresh = req.query.refresh === '1';
      const cacheKey = `options:${symbol}:${dateStr || 'default'}`;
      if (!forceRefresh) {
        const cached = getCached<unknown>(cacheKey);
        if (cached) {
          res.json(cached);
          return;
        }
      }

      const opts = dateStr ? { date: new Date(`${dateStr}T00:00:00Z`) } : undefined;
      const chain = await yahooFinance.options(symbol, opts);

      const spotPrice = Number(chain.quote?.regularMarketPrice ?? 0);
      if (!spotPrice || !chain.expirationDates?.length) {
        res.status(404).json({ error: `未找到 ${symbol} 的美股期权链数据` });
        return;
      }

      const expirationDates = chain.expirationDates.map((d) =>
        toIsoDate(new Date(d))
      );
      const firstExp = chain.options?.[0];
      const selectedExpiry = firstExp?.expirationDate
        ? toIsoDate(new Date(firstExp.expirationDate))
        : expirationDates[0];

      const mapContracts = (list: typeof firstExp.calls = []) =>
        list.map((c) => ({
          contractSymbol: c.contractSymbol,
          strike: Number(c.strike ?? 0),
          lastPrice: Number(c.lastPrice ?? 0),
          bid: Number(c.bid ?? 0),
          ask: Number(c.ask ?? 0),
          impliedVolatility: Number(c.impliedVolatility ?? 0),
          volume: Number(c.volume ?? 0),
          openInterest: Number(c.openInterest ?? 0),
          inTheMoney: Boolean(c.inTheMoney),
        }));

      const payload = {
        symbol,
        shortName: chain.quote?.shortName || symbol,
        spotPrice,
        expirationDates,
        selectedExpiry,
        calls: mapContracts(firstExp?.calls),
        puts: mapContracts(firstExp?.puts),
        extendedQuote: extractExtendedQuote(
          chain.quote as unknown as Record<string, unknown> | undefined
        ),
      };

      setCached(cacheKey, payload, 15_000);
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Options fetch failed';
      res.status(400).json({ error: `期权链加载失败: ${message}` });
    }
  });

  app.get('/api/symbol-search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const market = req.query.market ? String(req.query.market).trim().toUpperCase() : undefined;
      if (!q) {
        res.json({ items: [] });
        return;
      }
      const items = await searchEastmoneySuggest(q, market);
      res.json({ items: items.slice(0, 8) });
    } catch {
      res.json({ items: [] });
    }
  });

  app.get('/api/fund-flow', async (req, res) => {
    try {
      const market = String(req.query.market || 'US').trim().toUpperCase();
      const symbol = String(req.query.symbol || 'NVDA').trim();
      const days = Math.min(120, Math.max(20, Number(req.query.days || 60)));
      const forceRefresh = req.query.refresh === '1';
      if (!symbol) {
        res.status(400).json({ error: '请提供标的代码' });
        return;
      }
      const data = await resolveFundFlowData(market, symbol, days, forceRefresh);
      res.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : '资金流向数据获取失败';
      res.status(404).json({ error: message });
    }
  });

  // Batch watchlist fetch for multi-market radar table (single Tencent batch call + Eastmoney K-lines)
  app.post('/api/watchlist', async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 16) : [];
      const forceRefresh = Boolean(req.body?.refresh);

      const batchTargets: Array<{ market: 'US' | 'HK' | 'CN'; symbol: string }> = [];
      for (const item of items as Array<{ market?: string; symbol?: string }>) {
        if (!item?.symbol) continue;
        const mkt = String(item.market).toUpperCase();
        if (mkt === 'US' || mkt === 'HK' || mkt === 'CN') {
          batchTargets.push({ market: mkt, symbol: item.symbol });
        }
      }

      const liveMap = await fetchTencentBatchQuotes(batchTargets);

      const results = await Promise.all(
        items.map(async (item: { market: string; symbol: string }) => {
          try {
            const mkt = String(item.market).toUpperCase() as 'US' | 'HK' | 'CN';
            const { mapKey } = toTencentParam(mkt, item.symbol);

            const data = await fetchStockData(item.market, item.symbol, 420, {
              forceRefresh,
              includeExtendedIntraday: false,
              prefetchedLive: liveMap.get(mapKey),
            });
            return {
              ok: true,
              market: item.market,
              symbol: item.symbol,
              data,
            };
          } catch (err) {
            return {
              ok: false,
              market: item.market,
              symbol: item.symbol,
              error: err instanceof Error ? err.message : 'Fetch error',
            };
          }
        })
      );
      res.json({ results });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Watchlist error';
      res.status(400).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`金钱飘飘 server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
