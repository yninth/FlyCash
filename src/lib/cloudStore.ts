import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  CurrencyType,
  GlobalRiskConfig,
  LedgerEntry,
  MarketType,
  PriceAlertRule,
  WatchlistItemSpec,
} from '../types/trading';
import { db, handleFirestoreError, OperationType } from './firebase';

function safeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `id_${Date.now()}`;
}

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

function sanitizeRiskConfig(cfg: GlobalRiskConfig) {
  return {
    totalCapitalCny: clamp(Number(cfg.totalCapitalCny), 10000, 1000000000),
    stockRiskPct: clamp(Number(cfg.stockRiskPct), 0.1, 10),
    optionRiskPct: clamp(Number(cfg.optionRiskPct), 0.1, 20),
    atrMultiplier: clamp(Number(cfg.atrMultiplier), 0.5, 10),
  };
}

export async function ensureUserWorkspace(
  uid: string,
  displayName: string,
  fallbackRisk: GlobalRiskConfig,
  defaultWatchlist: WatchlistItemSpec[]
): Promise<{ createdNew: boolean }> {
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return { createdNew: false };
    }

    const safeRisk = sanitizeRiskConfig(fallbackRisk);
    await setDoc(userRef, {
      uid,
      displayName: (displayName || 'Trader').slice(0, 100),
      ...safeRisk,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Seed initial watchlist items on first-time workspace creation
    for (const item of defaultWatchlist) {
      await addCloudWatchlistItem(uid, item);
    }

    return { createdNew: true };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

export function subscribeUserSettings(
  uid: string,
  onChange: (cfg: GlobalRiskConfig) => void
): Unsubscribe {
  const userPath = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      onChange({
        totalCapitalCny: Number(d.totalCapitalCny ?? 500000),
        stockRiskPct: Number(d.stockRiskPct ?? 1.0),
        optionRiskPct: Number(d.optionRiskPct ?? 1.5),
        atrMultiplier: Number(d.atrMultiplier ?? 2.0),
      });
    },
    (err) => handleFirestoreError(err, OperationType.GET, userPath)
  );
}

export async function updateCloudRiskConfig(
  uid: string,
  cfg: GlobalRiskConfig
): Promise<void> {
  const userPath = `users/${uid}`;
  try {
    const safeRisk = sanitizeRiskConfig(cfg);
    await updateDoc(doc(db, 'users', uid), {
      ...safeRisk,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, userPath);
  }
}

export function subscribeCloudWatchlist(
  uid: string,
  onChange: (items: WatchlistItemSpec[]) => void
): Unsubscribe {
  const colPath = `users/${uid}/watchlist`;
  const q = query(collection(db, 'users', uid, 'watchlist'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: WatchlistItemSpec[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          market: (['US', 'HK', 'CN'].includes(String(data.market))
            ? data.market
            : 'US') as MarketType,
          symbol: String(data.symbol || ''),
          lotSize: Number(data.lotSize || 1),
        };
      });
      onChange(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, colPath)
  );
}

export async function addCloudWatchlistItem(
  uid: string,
  item: WatchlistItemSpec
): Promise<void> {
  const symbol = item.symbol
    .trim()
    .toUpperCase()
    .replace(/[^A-Za-z0-9.-]/g, '')
    .slice(0, 24);
  if (!symbol) return;

  const watchId = safeId(`${item.market}_${symbol}`);
  const docPath = `users/${uid}/watchlist/${watchId}`;

  try {
    await setDoc(doc(db, 'users', uid, 'watchlist', watchId), {
      ownerId: uid,
      market: item.market,
      symbol,
      lotSize: clamp(Math.round(Number(item.lotSize) || 1), 1, 100000),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, docPath);
  }
}

export async function removeCloudWatchlistItem(
  uid: string,
  watchId: string
): Promise<void> {
  const safeWatchId = safeId(watchId);
  const docPath = `users/${uid}/watchlist/${safeWatchId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'watchlist', safeWatchId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, docPath);
  }
}

export function subscribeCloudLedger(
  uid: string,
  onChange: (items: LedgerEntry[]) => void
): Unsubscribe {
  const colPath = `users/${uid}/ledger`;
  const q = query(collection(db, 'users', uid, 'ledger'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: LedgerEntry[] = snapshot.docs.map((d) => {
        const data = d.data();
        const createdIso =
          data.createdAt && typeof data.createdAt.toDate === 'function'
            ? (data.createdAt.toDate() as Date).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);
        return {
          id: d.id,
          market: data.market as LedgerEntry['market'],
          symbol: String(data.symbol || ''),
          currency: (['CNY', 'HKD', 'USD'].includes(String(data.currency))
            ? data.currency
            : 'USD') as CurrencyType,
          quantity: Number(data.quantity || 1),
          costPrice: Number(data.costPrice || 0),
          expiryDate: String(data.expiryDate || ''),
          optionRight: data.optionRight ? (data.optionRight as 'call' | 'put') : undefined,
          strike: typeof data.strike === 'number' ? data.strike : undefined,
          deltaEstimate:
            typeof data.deltaEstimate === 'number' ? data.deltaEstimate : undefined,
          note: String(data.note || ''),
          createdAt: createdIso,
        };
      });
      items.sort((a, b) => b.id.localeCompare(a.id));
      onChange(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, colPath)
  );
}

export async function addCloudLedgerItem(
  uid: string,
  entry: Omit<LedgerEntry, 'id' | 'createdAt'>
): Promise<void> {
  const entryId = safeId(`entry_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const docPath = `users/${uid}/ledger/${entryId}`;

  const cleanExpiry = /^\d{4}-\d{2}-\d{2}$/.test(entry.expiryDate.trim())
    ? entry.expiryDate.trim()
    : '';

  const payload: Record<string, unknown> = {
    ownerId: uid,
    market: entry.market,
    symbol: entry.symbol.trim().slice(0, 40) || 'UNKNOWN',
    currency: entry.currency,
    quantity: clamp(Number(entry.quantity) || 1, 0.0001, 100000000),
    costPrice: clamp(Number(entry.costPrice) || 0, 0, 10000000),
    expiryDate: cleanExpiry,
    note: (entry.note || '').trim().slice(0, 200),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (entry.optionRight === 'call' || entry.optionRight === 'put') {
    payload.optionRight = entry.optionRight;
  }
  if (typeof entry.strike === 'number' && Number.isFinite(entry.strike)) {
    payload.strike = clamp(entry.strike, 0, 1000000);
  }
  if (typeof entry.deltaEstimate === 'number' && Number.isFinite(entry.deltaEstimate)) {
    payload.deltaEstimate = clamp(entry.deltaEstimate, -1, 1);
  }

  try {
    await setDoc(doc(db, 'users', uid, 'ledger', entryId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, docPath);
  }
}

export async function updateCloudLedgerItem(
  uid: string,
  entryId: string,
  patch: { quantity: number; costPrice: number; note: string }
): Promise<void> {
  const safeEntryId = safeId(entryId);
  const docPath = `users/${uid}/ledger/${safeEntryId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'ledger', safeEntryId), {
      quantity: clamp(Number(patch.quantity) || 1, 0.0001, 100000000),
      costPrice: clamp(Number(patch.costPrice) || 0, 0, 10000000),
      note: (patch.note || '').trim().slice(0, 200),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, docPath);
  }
}

export async function deleteCloudLedgerItem(uid: string, entryId: string): Promise<void> {
  const safeEntryId = safeId(entryId);
  const docPath = `users/${uid}/ledger/${safeEntryId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'ledger', safeEntryId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, docPath);
  }
}

export function subscribeCloudAlerts(
  uid: string,
  onChange: (alerts: PriceAlertRule[]) => void
): Unsubscribe {
  const colPath = `users/${uid}/alerts`;
  const q = query(collection(db, 'users', uid, 'alerts'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: PriceAlertRule[] = snapshot.docs.map((d) => {
        const data = d.data();
        const createdIso =
          data.createdAt && typeof data.createdAt.toDate === 'function'
            ? (data.createdAt.toDate() as Date).toISOString()
            : new Date().toISOString();
        return {
          id: d.id,
          market: (['US', 'HK', 'CN'].includes(String(data.market))
            ? data.market
            : 'US') as MarketType,
          symbol: String(data.symbol || ''),
          name: String(data.name || ''),
          currency: (['CNY', 'HKD', 'USD'].includes(String(data.currency))
            ? data.currency
            : 'USD') as CurrencyType,
          supportPrice: typeof data.supportPrice === 'number' ? data.supportPrice : null,
          resistancePrice:
            typeof data.resistancePrice === 'number' ? data.resistancePrice : null,
          enabled: Boolean(data.enabled),
          triggeredSupportAt:
            typeof data.triggeredSupportAt === 'string' ? data.triggeredSupportAt : null,
          triggeredResistanceAt:
            typeof data.triggeredResistanceAt === 'string'
              ? data.triggeredResistanceAt
              : null,
          createdAt: createdIso,
        };
      });
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onChange(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, colPath)
  );
}

export async function upsertCloudAlert(
  uid: string,
  rule: PriceAlertRule
): Promise<void> {
  const cleanSymbol = rule.symbol
    .trim()
    .toUpperCase()
    .replace(/[^A-Za-z0-9.-]/g, '')
    .slice(0, 24);
  if (!cleanSymbol) return;

  const alertId = safeId(rule.id || `${rule.market}_${cleanSymbol}`);
  const docPath = `users/${uid}/alerts/${alertId}`;
  const docRef = doc(db, 'users', uid, 'alerts', alertId);

  const supportPrice =
    typeof rule.supportPrice === 'number' &&
    Number.isFinite(rule.supportPrice) &&
    rule.supportPrice > 0
      ? clamp(rule.supportPrice, 0.0001, 10000000)
      : null;

  const resistancePrice =
    typeof rule.resistancePrice === 'number' &&
    Number.isFinite(rule.resistancePrice) &&
    rule.resistancePrice > 0
      ? clamp(rule.resistancePrice, 0.0001, 10000000)
      : null;

  const updateFields = {
    name: (rule.name || cleanSymbol).trim().slice(0, 80),
    currency: (['CNY', 'HKD', 'USD'].includes(rule.currency)
      ? rule.currency
      : 'USD') as CurrencyType,
    supportPrice,
    resistancePrice,
    enabled: Boolean(rule.enabled),
    triggeredSupportAt: rule.triggeredSupportAt
      ? String(rule.triggeredSupportAt).slice(0, 40)
      : null,
    triggeredResistanceAt: rule.triggeredResistanceAt
      ? String(rule.triggeredResistanceAt).slice(0, 40)
      : null,
    updatedAt: serverTimestamp(),
  };

  try {
    const existingSnap = await getDoc(docRef);
    if (existingSnap.exists()) {
      await updateDoc(docRef, updateFields);
    } else {
      await setDoc(docRef, {
        ownerId: uid,
        market: (['US', 'HK', 'CN'].includes(rule.market) ? rule.market : 'US') as MarketType,
        symbol: cleanSymbol,
        ...updateFields,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docPath);
  }
}

export async function deleteCloudAlert(uid: string, alertId: string): Promise<void> {
  const safeAlertId = safeId(alertId);
  const docPath = `users/${uid}/alerts/${safeAlertId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'alerts', safeAlertId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, docPath);
  }
}
