export type MarketType = 'US' | 'HK' | 'CN';
export type OptionRight = 'call' | 'put';
export type CurrencyType = 'CNY' | 'HKD' | 'USD';

export interface MacroQuoteItem {
  id: string;
  label: string;
  symbol: string;
  price: number | null;
  changePct: number | null;
  unit: string;
  category: 'commodity' | 'crypto' | 'fx';
}

export interface MacroResponse {
  items: MacroQuoteItem[];
  usdCny: number;
  hkdCny: number;
  updatedAt: string;
}

export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorBar extends OhlcvBar {
  ma20: number | null;
  ma60: number | null;
  atr14: number | null;
  hv20: number | null;
  hv60: number | null;
  hvRank: number | null;
}

export type MarketSessionType = 'pre' | 'regular' | 'post';

export interface ExtendedQuoteInfo {
  marketState: string;
  hasPrePostMarketData: boolean;
  exchangeDataDelayedBy?: number | null;
  regularPrice: number | null;
  regularChange: number | null;
  regularChangePct: number | null;
  regularTime: string | null;
  preMarketPrice: number | null;
  preMarketChange: number | null;
  preMarketChangePct: number | null;
  preMarketTime: string | null;
  postMarketPrice: number | null;
  postMarketChange: number | null;
  postMarketChangePct: number | null;
  postMarketTime: string | null;
}

export interface IntradayExtendedBar {
  timestamp: string;
  etDate: string;
  etTimeLabel: string;
  session: MarketSessionType;
  price: number;
  volume: number;
}

export interface StockHistoryResponse {
  market: MarketType;
  symbol: string;
  resolvedSymbol: string;
  name: string;
  currency: CurrencyType;
  bars: OhlcvBar[];
  source: string;
  extendedQuote?: ExtendedQuoteInfo | null;
  extendedBars?: IntradayExtendedBar[];
  prevClose?: number | null;
  quoteDelayMinutes?: number | null;
  quoteUpdatedAt?: string | null;
}

export interface WatchlistScanItem {
  market: MarketType;
  symbol: string;
  name: string;
  currency: CurrencyType;
  price: number;
  changePct: number;
  extendedQuote?: ExtendedQuoteInfo | null;
  quoteDelayMinutes?: number | null;
  atr14: number;
  hv20: number;
  hvRank: number | null;
  trend: 'bull' | 'bear' | 'range';
  buyVerdict: BuyVerdictType;
  buyVerdictLabel: string;
  suggestedShares: number;
  stopPrice: number;
  weightPct: number;
  error?: string;
}

export interface AtrPositionResult {
  shares: number;
  stopPrice: number;
  costCny: number;
  weightPct: number;
  riskCny: number;
  stopDistanceLocal: number;
}

export interface BacktestPoint {
  date: string;
  strategy: number;
  benchmark: number;
  drawdownPct: number;
}

export interface BacktestTrade {
  date: string;
  action: '买入' | '卖出';
  price: number;
  pnlPct?: number;
  reason: string;
}

export interface BacktestMetrics {
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  calmarRatio: number;
  closedTrades: number;
  winRatePct: number;
  profitFactor: number;
  benchmarkReturnPct: number;
}

export interface BacktestResult {
  equityCurve: BacktestPoint[];
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
}

export interface BacktestGridRow {
  fastMa: number;
  slowMa: number;
  atrMult: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  winRatePct: number;
  closedTrades: number;
}

export interface RawOptionContract {
  contractSymbol: string;
  strike: number;
  lastPrice: number;
  bid: number;
  ask: number;
  impliedVolatility: number;
  volume: number;
  openInterest: number;
  inTheMoney: boolean;
}

export interface EnrichedOptionContract extends RawOptionContract {
  midPrice: number;
  ivPct: number;
  delta: number;
  gamma: number;
  thetaPerDay: number;
  vegaPerPct: number;
  dte: number;
  spreadPct: number;
}

export interface OptionsChainResponse {
  symbol: string;
  shortName: string;
  spotPrice: number;
  expirationDates: string[];
  selectedExpiry: string;
  calls: RawOptionContract[];
  puts: RawOptionContract[];
  extendedQuote?: ExtendedQuoteInfo | null;
}

export interface PayoffGridPoint {
  spot: number;
  todayPnl: number;
  midPnl: number;
  expiryPnl: number;
}

export interface LedgerEntry {
  id: string;
  market: 'A股' | '港股' | '美股' | '美股期权' | '港股期权';
  symbol: string;
  currency: CurrencyType;
  quantity: number;
  costPrice: number;
  expiryDate: string;
  optionRight?: OptionRight;
  strike?: number;
  deltaEstimate?: number;
  note: string;
  createdAt: string;
}

export interface GlobalRiskConfig {
  totalCapitalCny: number;
  stockRiskPct: number;
  optionRiskPct: number;
  atrMultiplier: number;
}

export type ForecastModelMode = 'momentum' | 'neutral' | 'mean_revert';

export interface ForecastPoint {
  dayOffset: number;
  label: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface TechnicalSignals {
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  bollUpper: number;
  bollLower: number;
  bollPctB: number;
  volumeRatio: number;
  support20: number;
  resistance20: number;
  atrTargetUp: number;
  atrTargetDown: number;
}

export type BuyVerdictType = 'buy' | 'pullback' | 'wait' | 'avoid';

export interface BuyFactorCheck {
  name: string;
  status: 'pass' | 'neutral' | 'fail';
  reading: string;
  detail: string;
}

export interface BuyDecision {
  verdict: BuyVerdictType;
  verdictLabel: string;
  actionHeadline: string;
  reasonSummary: string;
  optionAction: string;
  idealEntryLow: number;
  idealEntryHigh: number;
  targetPrice: number;
  riskRewardRatio: number;
  factors: BuyFactorCheck[];
}

export interface StockForecastResult {
  horizonDays: number;
  mode: ForecastModelMode;
  currentPrice: number;
  points: ForecastPoint[];
  signals: TechnicalSignals;
  outlook: 'bullish' | 'cautious_bull' | 'neutral' | 'cautious_bear' | 'bearish';
  outlookLabel: string;
  summaryText: string;
  optionHint: string;
  probAboveCurrentPct: number;
  buyDecision: BuyDecision;
}

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  detail?: string;
}

export interface WatchlistItemSpec {
  id?: string;
  market: MarketType;
  symbol: string;
  lotSize: number;
}

export interface PriceAlertRule {
  id: string;
  market: MarketType;
  symbol: string;
  name: string;
  currency: CurrencyType;
  supportPrice: number | null;
  resistancePrice: number | null;
  enabled: boolean;
  triggeredSupportAt: string | null;
  triggeredResistanceAt: string | null;
  createdAt: string;
}

export interface PortfolioHealthRiskItem {
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
}

export interface PortfolioHealthAdjustment {
  action: string;
  market?: MarketType;
  symbol?: string;
  rationale: string;
}

export interface PortfolioHealthDiagnosis {
  overallLevel: 'healthy' | 'caution' | 'alert';
  overallLabel: string;
  weightedHv20: number | null;
  dailyVar95Cny: number | null;
  bullSharePct: number;
  bearSharePct: number;
  rangeSharePct: number;
  maxPositionSymbol: string | null;
  maxPositionPct: number;
  optionSharePct: number;
  riskDisclosures: PortfolioHealthRiskItem[];
  adjustments: PortfolioHealthAdjustment[];
}

export interface StockNewsItem {
  title: string;
  publisher: string;
  publishedAt: string | null;
  url: string;
  sourceType: 'news_api' | 'web_grounding';
}

export interface StockNewsDigest {
  market: MarketType;
  symbol: string;
  resolvedName: string;
  marketSummary: string;
  earningsPeriod: string;
  earningsSummary: string[];
  bullishCatalysts: string[];
  bearishRisks: string[];
  newsItems: StockNewsItem[];
  aiAvailable: boolean;
  aiError?: string;
  updatedAt: string;
  cached: boolean;
}

export type SentimentPolarity = 'bullish' | 'neutral' | 'bearish';

export interface SentimentChannelScore {
  channel: string;
  bullPct: number;
  neutralPct: number;
  bearPct: number;
  heatScore: number;
  summary: string;
}

export interface SentimentSignalItem {
  sourceType: 'social' | 'news';
  platform: string;
  headline: string;
  polarity: SentimentPolarity;
  score: number;
  reason: string;
  url?: string;
}

export interface StockSentimentResponse {
  market: MarketType;
  symbol: string;
  resolvedName: string;
  heatScore: number;
  sentimentScore: number;
  bullishPct: number;
  neutralPct: number;
  bearishPct: number;
  regimeLabel: string;
  overview: string;
  channels: SentimentChannelScore[];
  items: SentimentSignalItem[];
  aiAvailable: boolean;
  aiError?: string;
  updatedAt: string;
  cached: boolean;
}

export type AtrAnomalyLevel = 'extreme' | 'elevated' | 'normal' | 'compressed';

export interface AtrAnomalyPoint {
  date: string;
  close: number;
  atr14: number;
  atrPct: number;
  tr: number;
  trPct: number;
}

export interface AtrAnomalyReport {
  windowDays: number;
  sampleCount: number;
  level: AtrAnomalyLevel;
  levelLabel: string;
  headline: string;
  guidance: string;
  currentAtr: number;
  currentAtrPct: number;
  histMeanAtr: number;
  histMeanAtrPct: number;
  histStdAtrPct: number;
  ratioToMean: number;
  deviationPct: number;
  zScore: number;
  percentileRank: number;
  latestTr: number;
  latestTrPct: number;
  latestTrToAtrRatio: number;
  maxAtrPct: number;
  maxAtrDate: string;
  minAtrPct: number;
  warningThresholdPct: number;
  extremeThresholdPct: number;
  series: AtrAnomalyPoint[];
}
