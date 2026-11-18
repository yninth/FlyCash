import { useCallback, useEffect, useRef } from 'react';
import type {
  CurrencyType,
  MarketType,
  PriceAlertRule,
  StockHistoryResponse,
  ToastType,
} from '../types/trading';

export interface AlertPriceQuote {
  market: MarketType;
  symbol: string;
  name: string;
  currency: CurrencyType;
  price: number;
}

function currencySymbolOf(c: CurrencyType): string {
  return c === 'CNY' ? '¥' : c === 'HKD' ? 'HK$' : '$';
}

export function sendBrowserNotification(title: string, body: string, tag: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Ignore environments restricting Notification constructor
  }
}

export function usePriceAlertMonitor({
  alerts,
  onUpsertAlert,
  onNotify,
}: {
  alerts: PriceAlertRule[];
  onUpsertAlert: (rule: PriceAlertRule) => void;
  onNotify: (type: ToastType, title: string, detail?: string) => void;
}) {
  const firedGuardRef = useRef<Set<string>>(new Set());

  const clearAlertGuard = useCallback((ruleId: string) => {
    firedGuardRef.current.delete(`${ruleId}:support`);
    firedGuardRef.current.delete(`${ruleId}:resistance`);
  }, []);

  const evaluateAlerts = useCallback(
    (quotes: AlertPriceQuote[]) => {
      if (alerts.length === 0 || quotes.length === 0) return;

      for (const rule of alerts) {
        if (!rule.enabled) continue;
        const matched = quotes.find(
          (q) => q.market === rule.market && q.symbol === rule.symbol
        );
        if (!matched || !Number.isFinite(matched.price) || matched.price <= 0) continue;

        const sym = currencySymbolOf(rule.currency || matched.currency);
        const nowIso = new Date().toISOString();
        let changed = false;
        let updatedRule: PriceAlertRule = { ...rule };

        const supGuardKey = `${rule.id}:support`;
        if (
          rule.supportPrice != null &&
          rule.supportPrice > 0 &&
          matched.price <= rule.supportPrice &&
          !rule.triggeredSupportAt &&
          !firedGuardRef.current.has(supGuardKey)
        ) {
          firedGuardRef.current.add(supGuardKey);
          changed = true;
          updatedRule = { ...updatedRule, triggeredSupportAt: nowIso };
          sendBrowserNotification(
            `触及支撑位 · ${rule.symbol}`,
            `${matched.name} 现价 ${sym}${matched.price.toFixed(2)} 已跌破/触及设定支撑位 ${sym}${rule.supportPrice.toFixed(2)}`,
            `alert-support-${rule.market}-${rule.symbol}`
          );
          onNotify(
            'warning',
            `${rule.symbol} 触及支撑位提醒`,
            `现价 ${sym}${matched.price.toFixed(2)} ≤ 支撑位 ${sym}${rule.supportPrice.toFixed(2)}`
          );
        }

        const resGuardKey = `${rule.id}:resistance`;
        if (
          rule.resistancePrice != null &&
          rule.resistancePrice > 0 &&
          matched.price >= rule.resistancePrice &&
          !rule.triggeredResistanceAt &&
          !firedGuardRef.current.has(resGuardKey)
        ) {
          firedGuardRef.current.add(resGuardKey);
          changed = true;
          updatedRule = { ...updatedRule, triggeredResistanceAt: nowIso };
          sendBrowserNotification(
            `突破阻力位 · ${rule.symbol}`,
            `${matched.name} 现价 ${sym}${matched.price.toFixed(2)} 已达到/突破设定阻力位 ${sym}${rule.resistancePrice.toFixed(2)}`,
            `alert-resistance-${rule.market}-${rule.symbol}`
          );
          onNotify(
            'success',
            `${rule.symbol} 突破阻力位提醒`,
            `现价 ${sym}${matched.price.toFixed(2)} ≥ 阻力位 ${sym}${rule.resistancePrice.toFixed(2)}`
          );
        }

        if (changed) {
          onUpsertAlert(updatedRule);
        }
      }
    },
    [alerts, onNotify, onUpsertAlert]
  );

  // Global background poll every 30s across all active alert rules regardless of active tab
  useEffect(() => {
    const activeRules = alerts.filter(
      (a) =>
        a.enabled &&
        ((a.supportPrice != null && !a.triggeredSupportAt) ||
          (a.resistancePrice != null && !a.triggeredResistanceAt))
    );
    if (activeRules.length === 0) return;

    const poll = async () => {
      try {
        const res = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: activeRules.map((a) => ({ market: a.market, symbol: a.symbol })),
          }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          results: Array<{ ok: boolean; data?: StockHistoryResponse }>;
        };
        const quotes: AlertPriceQuote[] = (json.results || [])
          .filter((r) => r.ok && r.data && r.data.bars.length > 0)
          .map((r) => {
            const d = r.data!;
            const ext = d.extendedQuote;
            const livePrice =
              d.market === 'US' && ext
                ? ext.preMarketPrice ??
                  ext.postMarketPrice ??
                  ext.regularPrice ??
                  d.bars[d.bars.length - 1].close
                : d.bars[d.bars.length - 1].close;
            return {
              market: d.market,
              symbol: d.symbol,
              name: d.name,
              currency: d.currency,
              price: livePrice,
            };
          });
        evaluateAlerts(quotes);
      } catch {
        // Ignore transient network errors in background poll
      }
    };

    const timer = window.setInterval(poll, 30_000);
    return () => window.clearInterval(timer);
  }, [alerts, evaluateAlerts]);

  return {
    evaluateAlerts,
    clearAlertGuard,
    sendBrowserNotification,
  };
}
