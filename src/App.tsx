import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { BacktestView } from './components/BacktestView';
import { EquityRadarView } from './components/EquityRadarView';
import { HomeOverviewView } from './components/HomeOverviewView';
import { LedgerView } from './components/LedgerView';
import { MacroStrip } from './components/MacroStrip';
import { OptionsLabView } from './components/OptionsLabView';
import { RiskCloudDrawer } from './components/RiskCloudDrawer';
import { ToastContainer } from './components/ToastContainer';
import {
  addCloudLedgerItem,
  addCloudWatchlistItem,
  deleteCloudAlert,
  deleteCloudLedgerItem,
  ensureUserWorkspace,
  removeCloudWatchlistItem,
  subscribeCloudAlerts,
  subscribeCloudLedger,
  subscribeCloudWatchlist,
  subscribeUserSettings,
  updateCloudLedgerItem,
  updateCloudRiskConfig,
  upsertCloudAlert,
} from './lib/cloudStore';
import { auth, googleProvider } from './lib/firebase';
import { calcDaysLeft } from './lib/quant';
import { usePriceAlertMonitor } from './lib/usePriceAlertMonitor';
import type {
  GlobalRiskConfig,
  LedgerEntry,
  MacroResponse,
  MarketType,
  PriceAlertRule,
  ToastMessage,
  ToastType,
  WatchlistItemSpec,
} from './types/trading';

type ActiveTab = 'home' | 'strategy' | 'ledger';
type StrategySubTab = 'radar' | 'backtest' | 'options';

const INITIAL_RISK: GlobalRiskConfig = {
  totalCapitalCny: 500000,
  stockRiskPct: 1.0,
  optionRiskPct: 1.5,
  atrMultiplier: 2.0,
};

const DEFAULT_WATCHLIST: WatchlistItemSpec[] = [
  { market: 'US', symbol: 'NVDA', lotSize: 1 },
  { market: 'US', symbol: 'QQQ', lotSize: 1 },
  { market: 'US', symbol: 'AAPL', lotSize: 1 },
  { market: 'HK', symbol: '0700', lotSize: 100 },
  { market: 'HK', symbol: '9988', lotSize: 100 },
  { market: 'CN', symbol: '510300', lotSize: 100 },
  { market: 'CN', symbol: '600519', lotSize: 100 },
];

function createDefaultLedger(): LedgerEntry[] {
  const tenDaysLater = new Date(Date.now() + 10 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return [
    {
      id: 'demo-opt-1',
      market: '美股期权',
      symbol: 'NVDA 140C',
      currency: 'USD',
      quantity: 2,
      costPrice: 5.5,
      expiryDate: tenDaysLater,
      optionRight: 'call',
      strike: 140,
      note: '样例持仓（触发14天到期预警）',
      createdAt: today,
    },
    {
      id: 'demo-hk-1',
      market: '港股',
      symbol: '0700.HK',
      currency: 'HKD',
      quantity: 200,
      costPrice: 410.0,
      expiryDate: '',
      note: '腾讯控股核心底仓样例',
      createdAt: today,
    },
    {
      id: 'demo-cn-1',
      market: 'A股',
      symbol: '510300',
      currency: 'CNY',
      quantity: 5000,
      costPrice: 3.95,
      expiryDate: '',
      note: '沪深300ETF样例',
      createdAt: today,
    },
  ];
}

function loadLocalRisk(): GlobalRiskConfig {
  try {
    const saved = localStorage.getItem('cm_risk_config_v1');
    if (saved) return JSON.parse(saved) as GlobalRiskConfig;
  } catch {
    // ignore storage errors
  }
  return INITIAL_RISK;
}

function loadLocalWatchlist(): WatchlistItemSpec[] {
  try {
    const saved = localStorage.getItem('cm_watchlist_v1');
    if (saved) return JSON.parse(saved) as WatchlistItemSpec[];
  } catch {
    // ignore
  }
  return DEFAULT_WATCHLIST;
}

function loadLocalLedger(): LedgerEntry[] {
  try {
    const saved = localStorage.getItem('cm_ledger_v1');
    if (saved) return JSON.parse(saved) as LedgerEntry[];
  } catch {
    // ignore
  }
  return createDefaultLedger();
}

function loadLocalAlerts(): PriceAlertRule[] {
  try {
    const saved = localStorage.getItem('cm_price_alerts_v1');
    if (saved) {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? (parsed as PriceAlertRule[]) : [];
    }
  } catch {
    // ignore
  }
  return [];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [strategySubTab, setStrategySubTab] = useState<StrategySubTab>('radar');
  const [selectedMarket, setSelectedMarket] = useState<MarketType>('US');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NVDA');
  const [optionsSymbol, setOptionsSymbol] = useState<string>('NVDA');

  // Auth & Cloud Sync State
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  const [riskConfig, setRiskConfig] = useState<GlobalRiskConfig>(loadLocalRisk);
  const [watchlist, setWatchlist] = useState<WatchlistItemSpec[]>(loadLocalWatchlist);
  const [ledger, setLedger] = useState<LedgerEntry[]>(loadLocalLedger);
  const [alerts, setAlerts] = useState<PriceAlertRule[]>(loadLocalAlerts);

  const [macro, setMacro] = useState<MacroResponse | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [macroError, setMacroError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const riskSyncTimerRef = useRef<number | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((type: ToastType, title: string, detail?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, title, detail }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  // Auth Listener & Cloud Subscriptions
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        setCloudReady(false);
        setRiskConfig(loadLocalRisk());
        setWatchlist(loadLocalWatchlist());
        setLedger(loadLocalLedger());
        setAlerts(loadLocalAlerts());
        return;
      }

      try {
        const localRisk = loadLocalRisk();
        const localWatch = loadLocalWatchlist();
        const { createdNew } = await ensureUserWorkspace(
          nextUser.uid,
          nextUser.displayName || 'Trader',
          localRisk,
          localWatch
        );
        if (createdNew) {
          const localLed = loadLocalLedger();
          for (const item of localLed) {
            await addCloudLedgerItem(nextUser.uid, {
              market: item.market,
              symbol: item.symbol,
              currency: item.currency,
              quantity: item.quantity,
              costPrice: item.costPrice,
              expiryDate: item.expiryDate,
              optionRight: item.optionRight,
              strike: item.strike,
              deltaEstimate: item.deltaEstimate,
              note: item.note,
            });
          }
          const localAl = loadLocalAlerts();
          for (const rule of localAl) {
            await upsertCloudAlert(nextUser.uid, rule);
          }
          notify('success', '已创建个人云端工作区', '本地账本、自选雷达与价格提醒已同步至云端');
        }
        setCloudReady(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '云端初始化失败';
        notify('error', '云端同步初始化失败', msg);
      }
    });

    return () => unsubAuth();
  }, [notify]);

  useEffect(() => {
    if (!authReady || !user || !cloudReady) return;

    const unsubRisk = subscribeUserSettings(user.uid, (cfg) => {
      setRiskConfig(cfg);
    });
    const unsubWatch = subscribeCloudWatchlist(user.uid, (items) => {
      setWatchlist(items);
    });
    const unsubLedger = subscribeCloudLedger(user.uid, (items) => {
      setLedger(items);
    });
    const unsubAlerts = subscribeCloudAlerts(user.uid, (items) => {
      setAlerts(items);
    });

    return () => {
      unsubRisk();
      unsubWatch();
      unsubLedger();
      unsubAlerts();
    };
  }, [authReady, user, cloudReady]);

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      notify(
        'success',
        '已登录云端账号',
        `${cred.user.displayName || cred.user.email || 'Google 用户'} · 多端实时同步已开启`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '登录被取消或失败';
      notify('error', 'Google 登录失败', msg);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      notify('info', '已退出云端账号', '当前已切换回本机浏览器存储模式');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '退出失败';
      notify('error', '退出登录失败', msg);
    }
  };

  const handleUploadLocalToCloud = async () => {
    if (!user) return;
    try {
      const localLed = loadLocalLedger();
      for (const item of localLed) {
        await addCloudLedgerItem(user.uid, {
          market: item.market,
          symbol: item.symbol,
          currency: item.currency,
          quantity: item.quantity,
          costPrice: item.costPrice,
          expiryDate: item.expiryDate,
          optionRight: item.optionRight,
          strike: item.strike,
          deltaEstimate: item.deltaEstimate,
          note: `${item.note} (本地合并)`,
        });
      }
      notify('success', `已将 ${localLed.length} 条本地账本记录合并至云端`);
    } catch (err) {
      notify('error', '同步本地记录失败', err instanceof Error ? err.message : '');
    }
  };

  const loadMacro = useCallback(
    async (announce = false, forceRefresh = false) => {
      setMacroLoading(true);
      setMacroError(null);
      try {
        const res = await fetch(`/api/macro${forceRefresh ? '?refresh=1' : ''}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '宏观行情拉取失败');
        const typed = data as MacroResponse;
        setMacro(typed);
        if (announce) {
          notify(
            'success',
            '已刷新全球宏观报价与汇率',
            `USD/CNY ${typed.usdCny.toFixed(4)} · HKD/CNY ${typed.hkdCny.toFixed(4)}`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '宏观接口不可用';
        setMacroError(msg);
        if (announce) {
          notify('error', '宏观行情刷新失败', msg);
        }
      } finally {
        setMacroLoading(false);
      }
    },
    [notify]
  );

  useEffect(() => {
    loadMacro(false, false);
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        loadMacro(false, false);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadMacro]);

  const updateRiskConfig = (patch: Partial<GlobalRiskConfig>) => {
    setRiskConfig((prev) => {
      const next = { ...prev, ...patch };
      if (!user) {
        try {
          localStorage.setItem('cm_risk_config_v1', JSON.stringify(next));
        } catch {
          // ignore
        }
      } else if (cloudReady) {
        if (riskSyncTimerRef.current) {
          window.clearTimeout(riskSyncTimerRef.current);
        }
        riskSyncTimerRef.current = window.setTimeout(() => {
          updateCloudRiskConfig(user.uid, next).catch((err) => {
            notify('error', '云端保存风控参数失败', err instanceof Error ? err.message : '');
          });
        }, 450);
      }
      return next;
    });
  };

  const handleAddWatchlist = async (item: WatchlistItemSpec) => {
    if (user && cloudReady) {
      try {
        await addCloudWatchlistItem(user.uid, item);
        notify('success', `已将 ${item.symbol} 同步到云端自选雷达`);
      } catch (err) {
        notify('error', '添加自选失败', err instanceof Error ? err.message : '');
      }
    } else {
      setWatchlist((prev) => {
        const next = [...prev, item];
        localStorage.setItem('cm_watchlist_v1', JSON.stringify(next));
        return next;
      });
      notify('success', `已将 ${item.symbol} 加入自选雷达`, '已自动刷新扫描队列');
    }
  };

  const handleRemoveWatchlist = async (mkt: MarketType, sym: string) => {
    if (user && cloudReady) {
      const target = watchlist.find((w) => w.market === mkt && w.symbol === sym);
      const watchId = target?.id || `${mkt}_${sym}`;
      try {
        await removeCloudWatchlistItem(user.uid, watchId);
        notify('info', `已从云端自选雷达移除 ${sym}`);
      } catch (err) {
        notify('error', '移除自选失败', err instanceof Error ? err.message : '');
      }
    } else {
      setWatchlist((prev) => {
        const next = prev.filter((w) => !(w.market === mkt && w.symbol === sym));
        localStorage.setItem('cm_watchlist_v1', JSON.stringify(next));
        return next;
      });
      notify('info', `已从自选雷达移除 ${sym}`);
    }
  };

  const handleAddLedger = async (entry: Omit<LedgerEntry, 'id' | 'createdAt'>) => {
    if (user && cloudReady) {
      try {
        await addCloudLedgerItem(user.uid, entry);
      } catch (err) {
        notify('error', '云端保存持仓失败', err instanceof Error ? err.message : '');
      }
    } else {
      const newItem: LedgerEntry = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      setLedger((prev) => {
        const next = [newItem, ...prev];
        localStorage.setItem('cm_ledger_v1', JSON.stringify(next));
        return next;
      });
    }
  };

  const handleUpdateLedger = async (
    id: string,
    patch: { quantity: number; costPrice: number; note: string }
  ) => {
    if (user && cloudReady) {
      try {
        await updateCloudLedgerItem(user.uid, id, patch);
      } catch (err) {
        notify('error', '云端更新持仓失败', err instanceof Error ? err.message : '');
      }
    } else {
      setLedger((prev) => {
        const next = prev.map((item) =>
          item.id === id ? { ...item, ...patch } : item
        );
        localStorage.setItem('cm_ledger_v1', JSON.stringify(next));
        return next;
      });
    }
  };

  const handleDeleteLedger = async (id: string) => {
    if (user && cloudReady) {
      try {
        await deleteCloudLedgerItem(user.uid, id);
      } catch (err) {
        notify('error', '云端删除持仓失败', err instanceof Error ? err.message : '');
      }
    } else {
      setLedger((prev) => {
        const next = prev.filter((item) => item.id !== id);
        localStorage.setItem('cm_ledger_v1', JSON.stringify(next));
        return next;
      });
    }
  };

  const handleImportLedger = async (items: LedgerEntry[]) => {
    if (user && cloudReady) {
      try {
        for (const item of items) {
          await addCloudLedgerItem(user.uid, {
            market: item.market,
            symbol: item.symbol,
            currency: item.currency,
            quantity: item.quantity,
            costPrice: item.costPrice,
            expiryDate: item.expiryDate,
            note: item.note,
          });
        }
      } catch (err) {
        notify('error', '云端导入持仓失败', err instanceof Error ? err.message : '');
      }
    } else {
      setLedger((prev) => {
        const next = [...items, ...prev];
        localStorage.setItem('cm_ledger_v1', JSON.stringify(next));
        return next;
      });
    }
  };

  const handleUpsertAlert = useCallback(
    async (rule: PriceAlertRule) => {
      if (user && cloudReady) {
        try {
          await upsertCloudAlert(user.uid, rule);
        } catch (err) {
          notify('error', '云端保存价格提醒失败', err instanceof Error ? err.message : '');
        }
      } else {
        setAlerts((prev) => {
          const filtered = prev.filter((a) => a.id !== rule.id);
          const next = [rule, ...filtered];
          try {
            localStorage.setItem('cm_price_alerts_v1', JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
      }
    },
    [user, cloudReady, notify]
  );

  const handleDeleteAlert = useCallback(
    async (id: string) => {
      if (user && cloudReady) {
        try {
          await deleteCloudAlert(user.uid, id);
        } catch (err) {
          notify('error', '云端删除提醒失败', err instanceof Error ? err.message : '');
        }
      } else {
        setAlerts((prev) => {
          const next = prev.filter((a) => a.id !== id);
          try {
            localStorage.setItem('cm_price_alerts_v1', JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
      }
    },
    [user, cloudReady, notify]
  );

  const usdCny = macro?.usdCny ?? 7.24;
  const hkdCny = macro?.hkdCny ?? 0.93;

  const expiringCount = useMemo(
    () =>
      ledger.filter((item) => {
        if (!item.expiryDate) return false;
        const d = calcDaysLeft(item.expiryDate);
        return d !== null && d <= 14;
      }).length,
    [ledger]
  );

  const { evaluateAlerts, clearAlertGuard } = usePriceAlertMonitor({
    alerts,
    onUpsertAlert: handleUpsertAlert,
    onNotify: notify,
  });

  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'home', label: '首页' },
    { id: 'strategy', label: '策略模型' },
    { id: 'ledger', label: expiringCount > 0 ? `我的账本 (${expiringCount})` : '我的账本' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#0B1120] text-slate-100">
      {/* Three-Zone Top Bar Contract */}
      <header className="border-b border-slate-800 bg-[#0B1120]">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-6 px-4 sm:px-6 py-3">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('home');
            }}
            className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            金钱飘飘
          </a>

          <nav className="flex items-center gap-6 overflow-x-auto text-sm font-medium">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === item.id
                    ? 'border-sky-400 text-slate-100'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-[#0F172A] px-3.5 py-2 text-xs font-medium text-slate-100 hover:border-sky-500/60 hover:text-sky-300 transition-colors whitespace-nowrap shrink-0 font-mono tabular-nums"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400" />
              <span>
                风控 ¥{Math.round(riskConfig.totalCapitalCny / 10000)}万 ·{' '}
                <span className={user ? 'text-emerald-400' : 'text-slate-400'}>
                  {user ? '云端已连' : '云同步'}
                </span>
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Viewport (Full-Width 1440px) */}
      <main className="flex-1 min-w-0 flex flex-col">
        <MacroStrip
          macro={macro}
          loading={macroLoading}
          error={macroError}
          onRefresh={() => loadMacro(true, true)}
        />

        <div className="p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'home' && (
            <HomeOverviewView
              riskConfig={riskConfig}
              usdCny={usdCny}
              hkdCny={hkdCny}
              selectedMarket={selectedMarket}
              selectedSymbol={selectedSymbol}
              watchlist={watchlist}
              ledgerEntries={ledger}
              onSelectSymbol={(mkt, sym) => {
                setSelectedMarket(mkt);
                setSelectedSymbol(sym);
              }}
              onAddWatchlist={handleAddWatchlist}
              onRemoveWatchlist={handleRemoveWatchlist}
              onAddToLedger={handleAddLedger}
              onOpenStrategyRadar={(mkt, sym) => {
                setSelectedMarket(mkt);
                setSelectedSymbol(sym);
                setStrategySubTab('radar');
                setActiveTab('strategy');
              }}
              onOpenStrategyOptions={(sym) => {
                setOptionsSymbol(sym);
                setStrategySubTab('options');
                setActiveTab('strategy');
              }}
              onOpenLedger={() => setActiveTab('ledger')}
              onEvaluateAlerts={evaluateAlerts}
              onNotify={notify}
            />
          )}

          {activeTab === 'strategy' && (
            <div className="space-y-5">
              {/* Strategy Models Sub-Navigation Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
                  <div>
                    <h1 className="text-lg font-semibold text-slate-100">
                      策略模型中心
                    </h1>
                    <p className="text-xs text-slate-400 mt-0.5">
                      正股 K 线与价格预测提醒 · 均线趋势回测与参数寻优 · 美股期权买方与备兑模型
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-900 p-1 border border-slate-800 text-xs">
                    <button
                      type="button"
                      onClick={() => setStrategySubTab('radar')}
                      className={`px-3.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                        strategySubTab === 'radar'
                          ? 'bg-sky-500/20 text-sky-300'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      正股预测与 K 线模型
                    </button>
                    <button
                      type="button"
                      onClick={() => setStrategySubTab('backtest')}
                      className={`px-3.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                        strategySubTab === 'backtest'
                          ? 'bg-sky-500/20 text-sky-300'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      趋势策略回测与寻优
                    </button>
                    <button
                      type="button"
                      onClick={() => setStrategySubTab('options')}
                      className={`px-3.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                        strategySubTab === 'options'
                          ? 'bg-sky-500/20 text-sky-300'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      美股期权模型
                    </button>
                  </div>
                </div>

                {strategySubTab === 'radar' && (
                  <EquityRadarView
                    riskConfig={riskConfig}
                    usdCny={usdCny}
                    hkdCny={hkdCny}
                    selectedMarket={selectedMarket}
                    selectedSymbol={selectedSymbol}
                    watchlist={watchlist}
                    alerts={alerts}
                    onAddWatchlist={handleAddWatchlist}
                    onRemoveWatchlist={handleRemoveWatchlist}
                    onSelectSymbol={(mkt, sym) => {
                      setSelectedMarket(mkt);
                      setSelectedSymbol(sym);
                    }}
                    onOpenOptionsForSymbol={(sym) => {
                      setOptionsSymbol(sym);
                      setStrategySubTab('options');
                    }}
                    onAddToLedger={handleAddLedger}
                    onUpsertAlert={handleUpsertAlert}
                    onDeleteAlert={handleDeleteAlert}
                    onEvaluateAlerts={evaluateAlerts}
                    onClearAlertGuard={clearAlertGuard}
                    onNotify={notify}
                  />
                )}

                {strategySubTab === 'backtest' && (
                  <BacktestView
                    riskConfig={riskConfig}
                    radarMarket={selectedMarket}
                    radarSymbol={selectedSymbol}
                    onNotify={notify}
                  />
                )}

                {strategySubTab === 'options' && (
                  <OptionsLabView
                    riskConfig={riskConfig}
                    usdCny={usdCny}
                    initialSymbol={optionsSymbol}
                    onAddToLedger={handleAddLedger}
                    onNotify={notify}
                  />
                )}
              </div>
            )}

            {activeTab === 'ledger' && (
              <LedgerView
                entries={ledger}
                onAddEntry={handleAddLedger}
                onUpdateEntry={handleUpdateLedger}
                onDeleteEntry={handleDeleteLedger}
                onImportEntries={handleImportLedger}
                onInspectSymbol={(mkt, sym) => {
                  setSelectedMarket(mkt);
                  setSelectedSymbol(sym);
                  setStrategySubTab('radar');
                  setActiveTab('strategy');
                }}
                usdCny={usdCny}
                hkdCny={hkdCny}
                riskConfig={riskConfig}
                onNotify={notify}
              />
            )}
        </div>
      </main>

      <RiskCloudDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        user={user}
        authReady={authReady}
        authBusy={authBusy}
        onGoogleSignIn={handleGoogleSignIn}
        onSignOut={handleSignOut}
        onUploadLocalToCloud={handleUploadLocalToCloud}
        riskConfig={riskConfig}
        onUpdateRiskConfig={updateRiskConfig}
        usdCny={usdCny}
        hkdCny={hkdCny}
        onNotify={notify}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
