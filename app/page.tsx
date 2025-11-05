'use client';

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
} from 'react';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type StrNumTuple = [string, string];

interface OrderBookLevel {
  price: number;
  amount: number;
  total: number;
}

interface ProcessedOrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  maxBidTotal: number;
  maxAskTotal: number;
  spread: number;
  spreadPercent: number;
  midPrice: number;
}

interface Trade {
  id: number;
  price: number;
  quantity: number;
  time: number;
  isBuyerMaker: boolean;
  isNew: boolean;
}

interface BinanceDepthUpdate {
  e: string; // "depthUpdate"
  E: number; // event time
  s: string; // symbol
  U: number; // first update ID in event
  u: number; // final update ID in event
  b: StrNumTuple[]; // bids
  a: StrNumTuple[]; // asks
}

interface BinanceTradeUpdate {
  e: string; // "aggTrade"
  E: number;
  s: string;
  a: number; // aggTradeId
  p: string; // price
  q: string; // quantity
  T: number; // trade time
  m: boolean; // isBuyerMaker
}

interface BookTickerUpdate {
  u: number;
  s: string;
  b: string; // best bid
  B: string; // best bid qty
  a: string; // best ask
  A: string; // best ask qty
}

// ============================================================================
// Utilities
// ============================================================================

function decimalsFromStep(step: string): number {
  if (!step.includes('.')) return 0;
  const trimmed = step.replace(/0+$/, '');
  const idx = trimmed.indexOf('.');
  return idx >= 0 ? (trimmed.length - idx - 1) : 0;
}

function toFixed(num: number, dp: number): string {
  if (!isFinite(num)) return '0';
  return num.toFixed(dp);
}

// ============================================================================
// Order row
// ============================================================================

const OrderRow = memo(function OrderRow({
  price,
  amount,
  total,
  maxTotal,
  isBid,
  isSpread = false,
  priceFmt,
  qtyFmt,
}: {
  price: number;
  amount: number;
  total: number;
  maxTotal: number;
  isBid: boolean;
  isSpread?: boolean;
  priceFmt: (n: number) => string;
  qtyFmt: (n: number) => string;
}) {
  const percentage = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  const bgColor = isBid ? 'bg-emerald-500/10' : 'bg-red-500/10';
  const textColor = isBid ? 'text-emerald-400' : 'text-red-400';

  if (isSpread) {
    return (
      <div className="flex items-center justify-center py-3 px-4 bg-gradient-to-r from-emerald-500/5 via-yellow-500/10 to-red-500/5 border-y border-yellow-500/20">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-yellow-400" />
          <span className="text-yellow-400 font-bold text-sm">SPREAD</span>
          <span className="text-white font-mono font-bold">
            ${priceFmt(price)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group hover:bg-white/5 transition-all duration-150 cursor-pointer">
      <div
        className={`absolute inset-y-0 ${
          isBid ? 'right-0' : 'left-0'
        } ${bgColor} transition-all duration-300`}
        style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
      />
      <div className="relative flex justify-between items-center px-4 py-2 font-mono text-sm">
        <span className={`${textColor} font-bold min-w-[120px]`}>
          ${priceFmt(price)}
        </span>
        <span className="text-gray-300 min-w-[100px] text-right">
          {qtyFmt(amount)}
        </span>
        <span className="text-gray-400 text-xs min-w-[100px] text-right">
          {qtyFmt(total)}
        </span>
      </div>
    </div>
  );
});

// Trade row
const TradeRow = memo(function TradeRow({ trade, priceFmt, qtyFmt }: { trade: Trade; priceFmt: (n: number) => string; qtyFmt: (n: number) => string; }) {
  const isBuy = !trade.isBuyerMaker;
  const bgColor = isBuy ? 'bg-emerald-500/20' : 'bg-red-500/20';
  const textColor = isBuy ? 'text-emerald-400' : 'text-red-400';
  const icon = isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />;

  return (
    <div className={`flex justify-between items-center px-3 py-2 font-mono text-xs border-l-2 ${isBuy ? 'border-emerald-500' : 'border-red-500'} ${trade.isNew ? `${bgColor} animate-flash` : 'bg-slate-800/30'} transition-all duration-300`}>
      <div className="flex items-center gap-2 min-w-[120px]">
        {icon}
        <span className={`${textColor} font-bold`}>${priceFmt(trade.price)}</span>
      </div>
      <span className="text-gray-300 min-w-[90px] text-right">{qtyFmt(trade.quantity)}</span>
      <span className="text-gray-500 text-[10px] min-w-[70px] text-right">{new Date(trade.time).toLocaleTimeString()}</span>
    </div>
  );
});

// ============================================================================
// Main component
// ============================================================================

export default function Page() {
  // symbol and view controls
  const [symbol, setSymbol] = useState<string>('btcusdt');
  const [displayRows, setDisplayRows] = useState<number>(20);

  // connection state
  const [connected, setConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [updateCount, setUpdateCount] = useState<number>(0);

  // precision
  const [priceDp, setPriceDp] = useState<number>(2);
  const [qtyDp, setQtyDp] = useState<number>(6);

  // processed view
  const [processed, setProcessed] = useState<ProcessedOrderBook>({
    bids: [],
    asks: [],
    maxBidTotal: 1,
    maxAskTotal: 1,
    spread: 0,
    spreadPercent: 0,
    midPrice: 0,
  });

  // trades list
  const [trades, setTrades] = useState<Trade[]>([]);

  // metrics
  const [mps, setMps] = useState<number>(0);
  const [reconnects, setReconnects] = useState<number>(0);
  const [buffered, setBuffered] = useState<number>(0);

  // refs for orderbook and mechanics
  const bidsRef = useRef<Map<string, number>>(new Map());
  const asksRef = useRef<Map<string, number>>(new Map());
  const lastUpdateIdRef = useRef<number>(0);
  const bufferRef = useRef<BinanceDepthUpdate[]>([]);
  const readyRef = useRef<boolean>(false);
  const sessionRef = useRef<number>(0);
  const wsDepthRef = useRef<WebSocket | null>(null);
  const wsTradesRef = useRef<WebSocket | null>(null);
  const wsTickerRef = useRef<WebSocket | null>(null);
  const bestTickerRef = useRef<{ bid: number; ask: number }>({ bid: 0, ask: 0 });
  const msgCounterRef = useRef<number>(0);
  const rafIdRef = useRef<number>(0);
  const reconnectTimers = useRef<{ depth: ReturnType<typeof setTimeout> | null; trades: ReturnType<typeof setTimeout> | null; ticker: ReturnType<typeof setTimeout> | null; }>({ depth: null, trades: null, ticker: null });

  // formatters
  const priceFmt = useCallback((n: number) => toFixed(n, priceDp), [priceDp]);
  const qtyFmt = useCallback((n: number) => toFixed(n, qtyDp), [qtyDp]);

  // compute and publish processed view once per frame
  const flushView = useCallback(() => {
    rafIdRef.current = 0;

    const bidEntries = Array.from(bidsRef.current.entries());
    const askEntries = Array.from(asksRef.current.entries());

    if (bidEntries.length === 0 || askEntries.length === 0) {
      setProcessed({
        bids: [],
        asks: [],
        maxBidTotal: 1,
        maxAskTotal: 1,
        spread: 0,
        spreadPercent: 0,
        midPrice: 0,
      });
      return;
    }

    // determine best levels from maps
    const bestBid = Math.max(...bidEntries.map(([p]) => parseFloat(p)));
    const bestAsk = Math.min(...askEntries.map(([p]) => parseFloat(p)));
    let spread = bestAsk - bestBid;

    // sanity fallback using bookTicker if needed
    if (!isFinite(spread) || spread <= 0) {
      const { bid, ask } = bestTickerRef.current;
      if (ask > bid && isFinite(ask - bid)) {
        spread = ask - bid;
        const mid = (ask + bid) / 2;
        const spreadPercent = mid > 0 ? (spread / mid) * 100 : 0;
        setProcessed({
          bids: [],
          asks: [],
          maxBidTotal: 1,
          maxAskTotal: 1,
          spread,
          spreadPercent,
          midPrice: mid,
        });
        return;
      } else {
        setProcessed({
          bids: [],
          asks: [],
          maxBidTotal: 1,
          maxAskTotal: 1,
          spread: 0,
          spreadPercent: 0,
          midPrice: 0,
        });
        return;
      }
    }

    const midPrice = (bestAsk + bestBid) / 2;
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    if (!isFinite(spreadPercent) || spreadPercent > 10) {
      setProcessed({
        bids: [],
        asks: [],
        maxBidTotal: 1,
        maxAskTotal: 1,
        spread: 0,
        spreadPercent: 0,
        midPrice: 0,
      });
      return;
    }

    // slice a window around best prices to avoid sorting entire map
    const bidsArr = bidEntries
      .filter(([p]) => parseFloat(p) >= bestBid - 1000000) // wide gate; cheap filter
      .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
      .slice(0, displayRows);

    const asksArr = askEntries
      .filter(([p]) => parseFloat(p) <= bestAsk + 1000000)
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
      .slice(0, displayRows);

    let bt = 0;
    const bids: OrderBookLevel[] = bidsArr.map(([p, q]) => {
      const price = parseFloat(p);
      const amount = q;
      bt += amount;
      return { price, amount, total: bt };
    });

    let at = 0;
    const asks: OrderBookLevel[] = asksArr.map(([p, q]) => {
      const price = parseFloat(p);
      const amount = q;
      at += amount;
      return { price, amount, total: at };
    });

    setProcessed({
      bids,
      asks,
      maxBidTotal: bids[bids.length - 1]?.total ?? 1,
      maxAskTotal: asks[asks.length - 1]?.total ?? 1,
      spread,
      spreadPercent,
      midPrice,
    });
  }, [displayRows]);

  const queueFlush = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(flushView);
  }, [flushView]);

  // messages/sec metric
  useEffect(() => {
    const id = setInterval(() => {
      setMps(msgCounterRef.current);
      msgCounterRef.current = 0;
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // precision fetch
  const loadPrecision = useCallback(async (sym: string) => {
    try {
      const r = await fetch('https://api.binance.com/api/v3/exchangeInfo?symbol=' + sym.toUpperCase());
      const j = await r.json();
      const filt = j.symbols?.[0]?.filters || [];
      const priceFilter = filt.find((f: any) => f.filterType === 'PRICE_FILTER');
      const lotFilter = filt.find((f: any) => f.filterType === 'LOT_SIZE');
      const pDp = priceFilter ? decimalsFromStep(priceFilter.tickSize) : 2;
      const qDp = lotFilter ? decimalsFromStep(lotFilter.stepSize) : 6;
      setPriceDp(Math.min(8, Math.max(0, pDp)));
      setQtyDp(Math.min(8, Math.max(0, qDp)));
    } catch {
      setPriceDp(2);
      setQtyDp(6);
    }
  }, []);

  // snapshot loader
  const loadSnapshot = useCallback(async (sym: string, session: number) => {
    try {
      const url = `https://api.binance.com/api/v3/depth?symbol=${sym.toUpperCase()}&limit=1000`;
      const r = await fetch(url);
      const s = await r.json() as { lastUpdateId: number; bids: StrNumTuple[]; asks: StrNumTuple[]; };

      if (session !== sessionRef.current) return; // stale

      bidsRef.current.clear();
      asksRef.current.clear();

      for (const [p, q] of s.bids) {
        const n = +q;
        if (n > 0) bidsRef.current.set(p, n);
      }
      for (const [p, q] of s.asks) {
        const n = +q;
        if (n > 0) asksRef.current.set(p, n);
      }

      lastUpdateIdRef.current = s.lastUpdateId;

      // apply buffered diffs
      // find first event E where U <= lastUpdateId + 1 <= u
      const buf = bufferRef.current.sort((x, y) => x.U - y.U);
      let idx = buf.findIndex(
        (ev) => ev.U <= lastUpdateIdRef.current + 1 && ev.u >= lastUpdateIdRef.current + 1
      );

      if (idx === -1) {
        // no bridging event; just drop older ones that end before snapshot
        idx = buf.findIndex((ev) => ev.u >= lastUpdateIdRef.current);
        if (idx === -1) {
          // nothing useful; will rely on future stream events
          bufferRef.current = [];
          readyRef.current = true;
          queueFlush();
          return;
        }
      }

      for (let i = idx; i < buf.length; i++) {
        const ev = buf[i];
        if (ev.U > lastUpdateIdRef.current + 1) {
          // gap; force resync
          bufferRef.current = [];
          readyRef.current = false;
          await loadSnapshot(sym, session);
          return;
        }
        // apply
        for (const [p, q] of ev.b) {
          const n = +q;
          if (n === 0) bidsRef.current.delete(p);
          else bidsRef.current.set(p, n);
        }
        for (const [p, q] of ev.a) {
          const n = +q;
          if (n === 0) asksRef.current.delete(p);
          else asksRef.current.set(p, n);
        }
        lastUpdateIdRef.current = ev.u;
      }

      bufferRef.current = [];
      readyRef.current = true;
      queueFlush();
    } catch {
      // retry snapshot quickly for this session
      setTimeout(() => {
        if (session === sessionRef.current) loadSnapshot(sym, session);
      }, 800);
    }
  }, [queueFlush]);

  // apply a single depth event with sequencing
  const applyDepth = useCallback((ev: BinanceDepthUpdate, sym: string) => {
    if (!readyRef.current) {
      bufferRef.current.push(ev);
      setBuffered(bufferRef.current.length);
      return;
    }

    // sequencing per Binance docs
    if (ev.u <= lastUpdateIdRef.current) return;
    if (ev.U > lastUpdateIdRef.current + 1) {
      // gap -> resync
      readyRef.current = false;
      bufferRef.current = [];
      setBuffered(0);
      loadSnapshot(sym, sessionRef.current);
      return;
    }

    // merge deltas
    for (const [p, q] of ev.b) {
      const n = +q;
      if (n === 0) bidsRef.current.delete(p);
      else bidsRef.current.set(p, n);
    }
    for (const [p, q] of ev.a) {
      const n = +q;
      if (n === 0) asksRef.current.delete(p);
      else asksRef.current.set(p, n);
    }

    lastUpdateIdRef.current = ev.u;
    queueFlush();
  }, [loadSnapshot, queueFlush]);

  // open sockets for a session
  const openSockets = useCallback((sym: string, session: number) => {
    // Depth stream
    try {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@depth@100ms`);
      wsDepthRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (e) => {
        if (session !== sessionRef.current) return;
        msgCounterRef.current++;
        setLastUpdate(Date.now());
        setUpdateCount((c) => c + 1);
        try {
          const ev = JSON.parse(e.data) as BinanceDepthUpdate;
          applyDepth(ev, sym);
        } catch {
          // ignore parse errors silently
        }
      };

      ws.onerror = () => {
        setError('depth connection error');
      };

      ws.onclose = () => {
        if (session !== sessionRef.current) return;
        setConnected(false);
        setReconnects((r) => r + 1);
        const delay = 800 + Math.floor(Math.random() * 800);
        reconnectTimers.current.depth = setTimeout(() => {
          openSockets(sym, sessionRef.current);
        }, delay);
      };
    } catch {
      setError('failed to open depth socket');
    }

    // Trades stream
    try {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@aggTrade`);
      wsTradesRef.current = ws;

      ws.onmessage = (e) => {
        if (session !== sessionRef.current) return;
        msgCounterRef.current++;
        setLastUpdate(Date.now());
        setUpdateCount((c) => c + 1);
        try {
          const t = JSON.parse(e.data) as BinanceTradeUpdate;
          const trade: Trade = {
            id: t.a,
            price: parseFloat(t.p),
            quantity: parseFloat(t.q),
            time: t.T,
            isBuyerMaker: t.m,
            isNew: true,
          };
          setTrades((prev) => {
            const nxt = [trade, ...prev.slice(0, 49)];
            setTimeout(() => {
              setTrades((cur) =>
                cur.map((x) => (x.id === trade.id ? { ...x, isNew: false } : x))
              );
            }, 300);
            return nxt;
          });
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (session !== sessionRef.current) return;
        const delay = 1000 + Math.floor(Math.random() * 1200);
        reconnectTimers.current.trades = setTimeout(() => {
          openSockets(sym, sessionRef.current);
        }, delay);
      };
    } catch {
      setError('failed to open trades socket');
    }

    // BookTicker stream for instant best bid/ask
    try {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@bookTicker`);
      wsTickerRef.current = ws;

      ws.onmessage = (e) => {
        if (session !== sessionRef.current) return;
        msgCounterRef.current++;
        try {
          const t = JSON.parse(e.data) as BookTickerUpdate;
          bestTickerRef.current.bid = parseFloat(t.b);
          bestTickerRef.current.ask = parseFloat(t.a);
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (session !== sessionRef.current) return;
        const delay = 1500 + Math.floor(Math.random() * 1200);
        reconnectTimers.current.ticker = setTimeout(() => {
          openSockets(sym, sessionRef.current);
        }, delay);
      };
    } catch {
      setError('failed to open bookTicker socket');
    }
  }, [applyDepth]);

  // teardown sockets
  const closeSockets = useCallback(() => {
    [wsDepthRef.current, wsTradesRef.current, wsTickerRef.current].forEach((ws) => {
      if (!ws) return;
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      } catch {}
    });
    wsDepthRef.current = null;
    wsTradesRef.current = null;
    wsTickerRef.current = null;

    Object.values(reconnectTimers.current).forEach((t) => t && clearTimeout(t));
    reconnectTimers.current = { depth: null, trades: null, ticker: null };
  }, []);

  // symbol switch
  useEffect(() => {
    // reset
    closeSockets();
    sessionRef.current += 1;
    const s = sessionRef.current;

    setConnected(false);
    setError(null);
    setUpdateCount(0);
    setLastUpdate(null);
    setTrades([]);
    setProcessed({
      bids: [],
      asks: [],
      maxBidTotal: 1,
      maxAskTotal: 1,
      spread: 0,
      spreadPercent: 0,
      midPrice: 0,
    });

    bidsRef.current.clear();
    asksRef.current.clear();
    bufferRef.current = [];
    readyRef.current = false;
    setBuffered(0);

    // load precision then snapshot then sockets
    loadPrecision(symbol);
    openSockets(symbol, s);
    // open depth first to start buffering, then snapshot
    (async () => {
      await loadSnapshot(symbol, s);
    })();

    return () => {
      closeSockets();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]); // only on symbol change

  // global styles
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <style jsx global>{`
        @keyframes flash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .animate-flash { animation: flash 0.3s ease-in-out; }
        .tabular-nums { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
        .scrollbar-thin::-webkit-scrollbar { width: 6px; height: 6px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: rgb(30 41 59); border-radius: 3px; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgb(71 85 105); border-radius: 3px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: rgb(100 116 139); }
      `}</style>

      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto px-4 py-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center backdrop-blur-sm">
                <svg className="w-6 h-6 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">
                  OrderFlow <span className="text-emerald-400">Pro</span>
                </h1>
                <p className="text-xs text-gray-500">Live Market Depth</p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all hover:bg-slate-800"
              >
                <option value="btcusdt">BTC/USDT</option>
                <option value="ethusdt">ETH/USDT</option>
                <option value="bnbusdt">BNB/USDT</option>
                <option value="solusdt">SOL/USDT</option>
                <option value="adausdt">ADA/USDT</option>
                <option value="dogeusdt">DOGE/USDT</option>
              </select>

              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all min-w-[130px] justify-center ${connected ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                {connected ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs font-bold tracking-wide">CONNECTED</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs font-bold tracking-wide">OFFLINE</span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg min-w-[110px]">
                <Zap className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                <span className="text-xs text-gray-300 font-mono tabular-nums">
                  {lastUpdate ? `${Math.min(Date.now() - lastUpdate, 999)}ms` : '---ms'}
                </span>
              </div>

              <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg min-w-[140px]">
                <Activity className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                <span className="text-xs text-gray-300 font-mono tabular-nums">{updateCount} updates</span>
              </div>
            </div>
          </div>

          {/* Observability */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mt-4">
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-gray-400 uppercase">Msgs/sec</div>
              <div className="text-lg font-mono">{mps}</div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-gray-400 uppercase">Reconnects</div>
              <div className="text-lg font-mono">{reconnects}</div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-gray-400 uppercase">Buffered</div>
              <div className="text-lg font-mono">{buffered}</div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-gray-400 uppercase">Session</div>
              <div className="text-lg font-mono">{sessionRef.current}</div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-gray-400 uppercase">Price dp</div>
              <div className="text-lg font-mono">{priceDp}</div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-gray-400 uppercase">Qty dp</div>
              <div className="text-lg font-mono">{qtyDp}</div>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 col-span-2 lg:col-span-2">
              <div className="text-[10px] text-gray-400 uppercase">Best Ticker</div>
              <div className="text-sm font-mono">
                Bid ${priceFmt(bestTickerRef.current.bid)} • Ask ${priceFmt(bestTickerRef.current.ask)}
              </div>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
            <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
              <div className="text-xs text-emerald-400/80 font-semibold mb-1 uppercase">Mid Price</div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">${priceFmt(processed.midPrice)}</div>
            </div>

            <div className="bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
              <div className="text-xs text-yellow-400/80 font-semibold mb-1 uppercase">Spread</div>
              <div className="text-lg font-bold text-white font-mono tabular-nums flex items-baseline gap-1">
                ${priceFmt(processed.spread)}
                <span className="text-xs text-gray-400 font-normal">
                  ({toFixed(processed.spreadPercent, 3)}%)
                </span>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/20 rounded-lg p-3">
              <div className="text-xs text-blue-400/80 font-semibold mb-1 uppercase">Total Volume</div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">
                {qtyFmt(
                  Array.from(bidsRef.current.values()).reduce((s, q) => s + q, 0) +
                  Array.from(asksRef.current.values()).reduce((s, q) => s + q, 0)
                )}
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border border-purple-500/20 rounded-lg p-3">
              <div className="text-xs text-purple-400/80 font-semibold mb-1 uppercase">Bid Levels</div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">
                {bidsRef.current.size}
              </div>
            </div>

            <div className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/20 rounded-lg p-3">
              <div className="text-xs text-orange-400/80 font-semibold mb-1 uppercase">Ask Levels</div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">
                {asksRef.current.size}
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-gray-400 font-semibold mb-1 uppercase">Imbalance</div>
              <div className="text-lg font-bold font-mono tabular-nums">
                {(() => {
                  const bidVol = Array.from(bidsRef.current.values()).reduce((s, q) => s + q, 0);
                  const askVol = Array.from(asksRef.current.values()).reduce((s, q) => s + q, 0);
                  const tot = bidVol + askVol;
                  const im = tot > 0 ? ((bidVol - askVol) / tot) * 100 : 0;
                  const sign = im > 0 ? '+' : '';
                  return `${sign}${toFixed(im, 2)}%`;
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-[1800px] mx-auto px-4 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Order book */}
          <div className="xl:col-span-2">
            <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
              <div className="grid grid-cols-1 lg:grid-cols-2">
                {/* Bids */}
                <div className="border-r border-slate-800">
                  <div className="bg-gradient-to-r from-emerald-500/20 to-emerald-500/10 px-4 py-3 border-b border-slate-800">
                    <div className="flex items-center justify-between font-mono text-xs font-bold">
                      <span className="text-emerald-400 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" /> BIDS (BUY)
                      </span>
                      <span className="text-gray-400">AMOUNT</span>
                      <span className="text-gray-500">TOTAL</span>
                    </div>
                  </div>

                  <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
                    {processed.bids.length > 0 ? (
                      processed.bids.map((row, idx) => (
                        <OrderRow
                          key={`bid-${row.price}-${idx}`}
                          price={row.price}
                          amount={row.amount}
                          total={row.total}
                          maxTotal={processed.maxBidTotal}
                          isBid
                          priceFmt={priceFmt}
                          qtyFmt={qtyFmt}
                        />
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-40 text-gray-500">
                        <div className="text-center">
                          <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-2" />
                          <p className="text-sm">Loading bids...</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Asks */}
                <div>
                  <div className="bg-gradient-to-r from-red-500/20 to-red-500/10 px-4 py-3 border-b border-slate-800">
                    <div className="flex items-center justify-between font-mono text-xs font-bold">
                      <span className="text-red-400 flex items-center gap-2">
                        <TrendingDown className="w-4 h-4" /> ASKS (SELL)
                      </span>
                      <span className="text-gray-400">AMOUNT</span>
                      <span className="text-gray-500">TOTAL</span>
                    </div>
                  </div>

                  <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
                    {processed.asks.length > 0 ? (
                      processed.asks.map((row, idx) => (
                        <OrderRow
                          key={`ask-${row.price}-${idx}`}
                          price={row.price}
                          amount={row.amount}
                          total={row.total}
                          maxTotal={processed.maxAskTotal}
                          isBid={false}
                          priceFmt={priceFmt}
                          qtyFmt={qtyFmt}
                        />
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-40 text-gray-500">
                        <div className="text-center">
                          <div className="animate-spin w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full mx-auto mb-2" />
                          <p className="text-sm">Loading asks...</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Spread bar */}
              <OrderRow
                price={processed.spread}
                amount={0}
                total={0}
                maxTotal={1}
                isBid={false}
                isSpread
                priceFmt={priceFmt}
                qtyFmt={qtyFmt}
              />
            </div>

            {/* Display rows slider */}
            <div className="mt-4 flex items-center gap-3 bg-slate-900/50 backdrop-blur-xl rounded-lg border border-slate-800 p-4">
              <label className="text-sm text-gray-400 font-semibold">Display Rows:</label>
              <input
                type="range"
                min={5}
                max={60}
                value={displayRows}
                onChange={(e) => setDisplayRows(parseInt(e.target.value))}
                className="flex-1 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <span className="text-sm font-mono text-white bg-slate-800 px-3 py-1 rounded-lg min-w-[50px] text-center">
                {displayRows}
              </span>
            </div>
          </div>

          {/* Trades */}
          <div className="xl:col-span-1">
            <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-800 overflow-hidden shadow-2xl h-[700px] flex flex-col">
              <div className="bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-purple-500/20 px-4 py-3 border-b border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Activity className="w-5 h-5 text-cyan-400" />
                    <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                      Recent Trades
                    </span>
                  </h3>
                  <span className="text-xs text-gray-400 bg-slate-800 px-2 py-1 rounded">
                    {trades.length}/50
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono text-xs font-bold mt-2 text-gray-500">
                  <span>PRICE</span>
                  <span>AMOUNT</span>
                  <span>TIME</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {trades.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    <div className="text-center">
                      <Activity className="w-12 h-12 mx-auto mb-2 opacity-20 animate-pulse" />
                      <p className="text-sm">Waiting for trades...</p>
                      <p className="text-xs text-gray-600 mt-1">Trades will appear here in real-time</p>
                    </div>
                  </div>
                ) : (
                  trades.map((trade) => (
                    <TradeRow key={`${trade.id}-${trade.time}`} trade={trade} priceFmt={priceFmt} qtyFmt={qtyFmt} />
                  ))
                )}
              </div>
            </div>

            {/* Trade sums */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="bg-slate-900/50 backdrop-blur-xl rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-emerald-400 font-semibold mb-1">Buy Volume</div>
                <div className="text-sm font-bold text-white font-mono">
                  {qtyFmt(trades.filter(t => !t.isBuyerMaker).reduce((s, t) => s + t.quantity, 0))}
                </div>
              </div>
              <div className="bg-slate-900/50 backdrop-blur-xl rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-red-400 font-semibold mb-1">Sell Volume</div>
                <div className="text-sm font-bold text-white font-mono">
                  {qtyFmt(trades.filter(t => t.isBuyerMaker).reduce((s, t) => s + t.quantity, 0))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-[1800px] mx-auto px-4 py-6 text-center">
        <div className="bg-slate-900/30 backdrop-blur-xl rounded-lg border border-slate-800/50 p-4">
          <p className="text-xs text-gray-500">
            Built with Next.js 15, TypeScript & Binance WebSocket API • Sequenced snapshot + diff • rAF batched updates
          </p>
        </div>
      </div>
    </div>
  );
}