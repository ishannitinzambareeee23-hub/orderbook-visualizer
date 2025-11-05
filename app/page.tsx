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
  Minus,
  Plus,
  SlidersHorizontal,
  Pause,
  Play,
  Eye,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================
type StrNumTuple = [string, string];

interface OrderBookLevel { price: number; amount: number; total: number; }
interface BestLevel { price: number; amount: number; }
interface ProcessedOrderBook {
  bids: OrderBookLevel[]; asks: OrderBookLevel[];
  maxBidTotal: number; maxAskTotal: number;
  spread: number; spreadPercent: number; midPrice: number;
  bestBid?: BestLevel; bestAsk?: BestLevel;
}
interface Trade { id: number; price: number; quantity: number; time: number; isBuyerMaker: boolean; isNew: boolean; }
interface BinanceDepthUpdate { e:string; E:number; s:string; U:number; u:number; b:StrNumTuple[]; a:StrNumTuple[]; }
interface BinanceTradeUpdate { e:string; E:number; s:string; a:number; p:string; q:string; T:number; m:boolean; }
interface BookTickerUpdate { u:number; s:string; b:string; B:string; a:string; A:string; }

// ============================================================================
// Format helpers
// ============================================================================
const nfCache = new Map<number, Intl.NumberFormat>();
function fmtFixed(n: number, dp: number): string {
  if (!isFinite(n)) return '0';
  let nf = nfCache.get(dp);
  if (!nf) {
    nf = new Intl.NumberFormat(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
    nfCache.set(dp, nf);
  }
  return nf.format(n);
}
function fmtCompact(n: number): string {
  if (!isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}
function decimalsFromStep(step: string): number {
  if (!step.includes('.')) return 0;
  const trimmed = step.replace(/0+$/, '');
  const i = trimmed.indexOf('.');
  return i >= 0 ? (trimmed.length - i - 1) : 0;
}

// ============================================================================
// Rows (memoized)
// ============================================================================
const OrderRow = memo(function OrderRow({
  price, amount, total, maxTotal, isBid, isSpread = false, priceFmt, qtyFmt, dense,
}: {
  price: number; amount: number; total: number; maxTotal: number; isBid: boolean; isSpread?: boolean;
  priceFmt: (n:number)=>string; qtyFmt:(n:number)=>string; dense:boolean;
}) {
  const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  const bgColor = isBid ? 'bg-emerald-500/10' : 'bg-red-500/10';
  const textColor = isBid ? 'text-emerald-400' : 'text-red-400';
  const py = dense ? 'py-1.5' : 'py-2.5';
  const text = dense ? 'text-[11px] sm:text-xs' : 'text-[12px] sm:text-sm';

  if (isSpread) {
    return (
      <div className="flex items-center justify-center py-3 px-4 bg-gradient-to-r from-emerald-500/5 via-yellow-500/10 to-red-500/5 border-y border-yellow-500/20">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-yellow-400" />
          <span className="text-yellow-400 font-bold text-sm">SPREAD</span>
          <span className="text-white font-mono font-bold">${priceFmt(price)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group hover:bg-white/5 transition-colors">
      <div className={`absolute inset-y-0 ${isBid ? 'right-0' : 'left-0'} ${bgColor}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      <div className={`relative flex justify-between items-center px-3 sm:px-4 ${py} font-mono ${text}`}>
        <span className={`${textColor} font-bold min-w-[90px] sm:min-w-[120px]`}>${priceFmt(price)}</span>
        <span className="text-gray-300 min-w-[80px] sm:min-w-[100px] text-right">{qtyFmt(amount)}</span>
        <span className="text-gray-400 text-[10px] sm:text-xs min-w-[80px] sm:min-w-[100px] text-right">{qtyFmt(total)}</span>
      </div>
    </div>
  );
});

const TradeRow = memo(function TradeRow({ trade, priceFmt, qtyFmt }:{
  trade: Trade; priceFmt:(n:number)=>string; qtyFmt:(n:number)=>string;
}) {
  const isBuy = !trade.isBuyerMaker;
  const bgColor = isBuy ? 'bg-emerald-500/20' : 'bg-red-500/20';
  const textColor = isBuy ? 'text-emerald-400' : 'text-red-400';
  const icon = isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />;

  return (
    <div className={`flex justify-between items-center px-3 py-2 font-mono text-[11px] sm:text-xs border-l-2 ${isBuy ? 'border-emerald-500' : 'border-red-500'} ${trade.isNew ? `${bgColor} animate-flash` : 'bg-slate-800/30'} transition-colors`}>
      <div className="flex items-center gap-2 min-w-[110px] sm:min-w-[120px]">
        {icon}
        <span className={`${textColor} font-bold`}>${priceFmt(trade.price)}</span>
      </div>
      <span className="text-gray-300 min-w-[80px] sm:min-w-[90px] text-right">{qtyFmt(trade.quantity)}</span>
      <span className="text-gray-500 text-[9px] sm:text-[10px] min-w-[64px] sm:min-w-[70px] text-right">{new Date(trade.time).toLocaleTimeString()}</span>
    </div>
  );
});

// ============================================================================
// Page
// ============================================================================
export default function Page() {
  // core controls
  const [symbol, setSymbol] = useState<string>('btcusdt');
  const [displayRows, _setDisplayRows] = useState<number>(20);
  const setDisplayRows = useCallback((n:number) => _setDisplayRows(Math.max(5, Math.min(100, Math.floor(n)))), []);
  const rowsRef = useRef<number>(20);

  const [groupMult, setGroupMult] = useState<number>(1);            // ×ticks
  const groupMultRef = useRef<number>(1);
  const tickSizeRef = useRef<number>(0.01);

  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  const [dense, setDense] = useState<boolean>(false);

  // connection state
  const [connected, setConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [updateCount, setUpdateCount] = useState<number>(0);

  // precision
  const [priceDp, setPriceDp] = useState<number>(2);
  const [qtyDp, setQtyDp] = useState<number>(6);

  // processed + trades
  const [processed, setProcessed] = useState<ProcessedOrderBook>({
    bids: [], asks: [], maxBidTotal: 1, maxAskTotal: 1, spread: 0, spreadPercent: 0, midPrice: 0,
  });
  const [trades, setTrades] = useState<Trade[]>([]);

  // metrics
  const [mps, setMps] = useState<number>(0);
  const [reconnects, setReconnects] = useState<number>(0);
  const [buffered, setBuffered] = useState<number>(0);

  // refs for book + sockets
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
  const priceFmt = useCallback((n: number) => fmtFixed(n, priceDp), [priceDp]);
  const qtyFmt   = useCallback((n: number) => fmtFixed(n, qtyDp),   [qtyDp]);

  // msgs/sec
  useEffect(() => { const id = setInterval(() => { setMps(msgCounterRef.current); msgCounterRef.current = 0; }, 1000); return () => clearInterval(id); }, []);

  // keep refs in sync
  useEffect(() => { rowsRef.current = displayRows; queueFlush(); }, [displayRows]);
  useEffect(() => { groupMultRef.current = groupMult; queueFlush(); }, [groupMult]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // ----- helpers -----
  const bucketize = (price: number, step: number, side: 'bid'|'ask') => {
    if (step <= 0 || !isFinite(step)) return price;
    const inv = 1 / step;
    const idx = side === 'bid' ? Math.floor(price * inv) : Math.ceil(price * inv);
    return idx / inv;
  };

  // ----- rAF batched view computation -----
  const flushView = useCallback(() => {
    rafIdRef.current = 0;
    if (pausedRef.current) return;

    const be = Array.from(bidsRef.current.entries());
    const ae = Array.from(asksRef.current.entries());

    if (be.length === 0 || ae.length === 0) {
      setProcessed({ bids: [], asks: [], maxBidTotal: 1, maxAskTotal: 1, spread: 0, spreadPercent: 0, midPrice: 0, bestBid: undefined, bestAsk: undefined });
      return;
    }

    const bestBidRaw = Math.max(...be.map(([p]) => parseFloat(p)));
    const bestAskRaw = Math.min(...ae.map(([p]) => parseFloat(p)));
    let spread = bestAskRaw - bestBidRaw;

    if (!isFinite(spread) || spread <= 0) {
      const { bid, ask } = bestTickerRef.current;
      if (ask > bid && isFinite(ask - bid)) {
        const midT = (ask + bid) / 2;
        const sprT = ask - bid;
        setProcessed({ bids: [], asks: [], maxBidTotal: 1, maxAskTotal: 1, spread: sprT, spreadPercent: midT > 0 ? (sprT/midT)*100 : 0, midPrice: midT, bestBid: {price: bid, amount: 0}, bestAsk: {price: ask, amount: 0} });
        return;
      }
      setProcessed({ bids: [], asks: [], maxBidTotal: 1, maxAskTotal: 1, spread: 0, spreadPercent: 0, midPrice: 0, bestBid: undefined, bestAsk: undefined });
      return;
    }

    const mid = (bestAskRaw + bestBidRaw) / 2;
    const sPct = mid > 0 ? (spread / mid) * 100 : 0;
    if (!isFinite(sPct) || sPct > 10) {
      setProcessed({ bids: [], asks: [], maxBidTotal: 1, maxAskTotal: 1, spread: 0, spreadPercent: 0, midPrice: 0, bestBid: undefined, bestAsk: undefined });
      return;
    }

    const tick = tickSizeRef.current || Math.pow(10, -priceDp);
    const step = Math.max(tick * groupMultRef.current, tick);

    const gBids = new Map<number, number>();
    const gAsks = new Map<number, number>();
    for (const [ps, q] of be) {
      const p = parseFloat(ps);
      const b = bucketize(p, step, 'bid');
      gBids.set(b, (gBids.get(b) ?? 0) + q);
    }
    for (const [ps, q] of ae) {
      const p = parseFloat(ps);
      const b = bucketize(p, step, 'ask');
      gAsks.set(b, (gAsks.get(b) ?? 0) + q);
    }

    const bidsArr = Array.from(gBids.entries()).sort((a,b)=> b[0]-a[0]).slice(0, rowsRef.current);
    const asksArr = Array.from(gAsks.entries()).sort((a,b)=> a[0]-b[0]).slice(0, rowsRef.current);

    let bt = 0;
    const bids = bidsArr.map(([p,q]) => { bt += q; return { price:p, amount:q, total:bt }; });
    let at = 0;
    const asks = asksArr.map(([p,q]) => { at += q; return { price:p, amount:q, total:at }; });

    setProcessed({
      bids, asks,
      maxBidTotal: bids[bids.length-1]?.total ?? 1,
      maxAskTotal: asks[asks.length-1]?.total ?? 1,
      spread, spreadPercent: sPct, midPrice: mid,
      bestBid: bids.length ? { price: bids[0].price, amount: gBids.get(bids[0].price) ?? bids[0].amount } : undefined,
      bestAsk: asks.length ? { price: asks[0].price, amount: gAsks.get(asks[0].price) ?? asks[0].amount } : undefined,
    });
  }, [priceDp]);

  const queueFlush = useCallback(() => { if (!rafIdRef.current) rafIdRef.current = requestAnimationFrame(flushView); }, [flushView]);

  // precision from REST
  const loadPrecision = useCallback(async (sym: string) => {
    try {
      const r = await fetch('https://api.binance.com/api/v3/exchangeInfo?symbol=' + sym.toUpperCase());
      const j = await r.json();
      const filt = j.symbols?.[0]?.filters || [];
      const priceFilter = filt.find((f: any) => f.filterType === 'PRICE_FILTER');
      const lotFilter = filt.find((f: any) => f.filterType === 'LOT_SIZE');
      tickSizeRef.current = parseFloat(priceFilter?.tickSize ?? '0.01');
      setPriceDp(Math.min(8, Math.max(0, decimalsFromStep(priceFilter?.tickSize ?? '0.01'))));
      setQtyDp(Math.min(8, Math.max(0, decimalsFromStep(lotFilter?.stepSize ?? '0.000001'))));
    } catch { tickSizeRef.current = 0.01; setPriceDp(2); setQtyDp(6); }
  }, []);

  // snapshot
  const loadSnapshot = useCallback(async (sym: string, session: number) => {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/depth?symbol=${sym.toUpperCase()}&limit=1000`);
      const s = await r.json() as { lastUpdateId:number; bids:StrNumTuple[]; asks:StrNumTuple[]; };
      if (session !== sessionRef.current) return;

      bidsRef.current.clear(); asksRef.current.clear();
      for (const [p,q] of s.bids) { const n=+q; if (n>0) bidsRef.current.set(p,n); }
      for (const [p,q] of s.asks) { const n=+q; if (n>0) asksRef.current.set(p,n); }
      lastUpdateIdRef.current = s.lastUpdateId;

      const buf = bufferRef.current.sort((x,y)=>x.U-y.U);
      let i = buf.findIndex(ev => ev.U <= lastUpdateIdRef.current + 1 && ev.u >= lastUpdateIdRef.current + 1);
      if (i === -1) i = buf.findIndex(ev => ev.u >= lastUpdateIdRef.current);

      if (i !== -1) {
        for (let k=i; k<buf.length; k++){
          const ev = buf[k];
          if (ev.U > lastUpdateIdRef.current + 1) {
            bufferRef.current = []; readyRef.current=false; await loadSnapshot(sym, session); return;
          }
          for (const [p,q] of ev.b){ const n=+q; n===0 ? bidsRef.current.delete(p) : bidsRef.current.set(p,n); }
          for (const [p,q] of ev.a){ const n=+q; n===0 ? asksRef.current.delete(p) : asksRef.current.set(p,n); }
          lastUpdateIdRef.current = ev.u;
        }
      }

      bufferRef.current = []; readyRef.current = true; setBuffered(0); queueFlush();
    } catch {
      setTimeout(() => { if (session === sessionRef.current) loadSnapshot(sym, session); }, 800);
    }
  }, [queueFlush]);

  // apply depth deltas
  const applyDepth = useCallback((ev: BinanceDepthUpdate, sym: string) => {
    if (!readyRef.current) { bufferRef.current.push(ev); setBuffered(bufferRef.current.length); return; }
    if (ev.u <= lastUpdateIdRef.current) return;
    if (ev.U > lastUpdateIdRef.current + 1) {
      readyRef.current=false; bufferRef.current=[]; setBuffered(0); loadSnapshot(sym, sessionRef.current); return;
    }
    for (const [p,q] of ev.b){ const n=+q; n===0 ? bidsRef.current.delete(p) : bidsRef.current.set(p,n); }
    for (const [p,q] of ev.a){ const n=+q; n===0 ? asksRef.current.delete(p) : asksRef.current.set(p,n); }
    lastUpdateIdRef.current = ev.u;
    queueFlush();
  }, [loadSnapshot, queueFlush]);

  // sockets
  const openSockets = useCallback((sym: string, session: number) => {
    try {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@depth@100ms`);
      wsDepthRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        if (session !== sessionRef.current) return;
        msgCounterRef.current++; setLastUpdate(Date.now()); setUpdateCount(c=>c+1);
        try { applyDepth(JSON.parse(e.data) as BinanceDepthUpdate, sym); } catch {}
      };
      ws.onerror = () => setError('depth connection error');
      ws.onclose = () => {
        if (session !== sessionRef.current) return;
        setConnected(false); setReconnects(r=>r+1);
        const d = 800 + Math.floor(Math.random()*800);
        reconnectTimers.current.depth = setTimeout(()=> openSockets(sym, sessionRef.current), d);
      };
    } catch { setError('failed to open depth socket'); }

    try {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@aggTrade`);
      wsTradesRef.current = ws;
      ws.onmessage = (e) => {
        if (session !== sessionRef.current) return;
        msgCounterRef.current++; setLastUpdate(Date.now()); setUpdateCount(c=>c+1);
        try {
          const t = JSON.parse(e.data) as BinanceTradeUpdate;
          const trade: Trade = { id: t.a, price: +t.p, quantity: +t.q, time: t.T, isBuyerMaker: t.m, isNew: true };
          setTrades(prev => {
            const nxt = [trade, ...prev.slice(0,49)];
            setTimeout(()=> setTrades(cur => cur.map(x => x.id===trade.id ? {...x,isNew:false} : x)), 300);
            return nxt;
          });
        } catch {}
      };
      ws.onclose = () => {
        if (session !== sessionRef.current) return;
        const d = 1000 + Math.floor(Math.random()*1200);
        reconnectTimers.current.trades = setTimeout(()=> openSockets(sym, sessionRef.current), d);
      };
    } catch { setError('failed to open trades socket'); }

    try {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@bookTicker`);
      wsTickerRef.current = ws;
      ws.onmessage = (e) => {
        if (session !== sessionRef.current) return;
        msgCounterRef.current++;
        try {
          const t = JSON.parse(e.data) as BookTickerUpdate;
          bestTickerRef.current.bid = +t.b; bestTickerRef.current.ask = +t.a;
        } catch {}
      };
      ws.onclose = () => {
        if (session !== sessionRef.current) return;
        const d = 1500 + Math.floor(Math.random()*1200);
        reconnectTimers.current.ticker = setTimeout(()=> openSockets(sym, sessionRef.current), d);
      };
    } catch { setError('failed to open bookTicker socket'); }
  }, [applyDepth]);

  const closeSockets = useCallback(() => {
    [wsDepthRef.current, wsTradesRef.current, wsTickerRef.current].forEach(ws => {
      if (!ws) return;
      ws.onclose = null; ws.onmessage = null; ws.onerror = null;
      try { if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(); } catch {}
    });
    wsDepthRef.current = null; wsTradesRef.current = null; wsTickerRef.current = null;
    Object.values(reconnectTimers.current).forEach(t => t && clearTimeout(t));
    reconnectTimers.current = { depth: null, trades: null, ticker: null };
  }, []);

  // symbol switch lifecycle
  useEffect(() => {
    closeSockets(); sessionRef.current += 1; const s = sessionRef.current;
    setConnected(false); setError(null); setUpdateCount(0); setLastUpdate(null); setTrades([]);
    setProcessed({ bids: [], asks: [], maxBidTotal: 1, maxAskTotal: 1, spread: 0, spreadPercent: 0, midPrice: 0 });
    bidsRef.current.clear(); asksRef.current.clear(); bufferRef.current = []; readyRef.current = false; setBuffered(0);

    loadPrecision(symbol);
    openSockets(symbol, s);
    (async ()=>{ await loadSnapshot(symbol, s); })();

    return () => { closeSockets(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // derived for headers
  const totalBidVol = Array.from(bidsRef.current.values()).reduce((s,q)=>s+q,0);
  const totalAskVol = Array.from(asksRef.current.values()).reduce((s,q)=>s+q,0);
  const totalVol = totalBidVol + totalAskVol;
  const dominance = totalVol > 0 ? (totalBidVol / totalVol) : 0;

  // 1-minute trade imbalance for quick judgment
  const now = Date.now();
  const lastMin = trades.filter(t => now - t.time <= 60_000);
  const buy1m = lastMin.filter(t=>!t.isBuyerMaker).reduce((s,t)=>s+t.quantity,0);
  const sell1m = lastMin.filter(t=> t.isBuyerMaker).reduce((s,t)=>s+t.quantity,0);
  const im1m = (buy1m + sell1m) > 0 ? ((buy1m - sell1m)/(buy1m + sell1m))*100 : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-[env(safe-area-inset-bottom)]">
      <style jsx global>{`
        @keyframes flash { 0%,100%{opacity:1} 50%{opacity:.6} }
        .animate-flash { animation: flash .3s ease-in-out; }
        .tabular-nums { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
        .scrollbar-thin::-webkit-scrollbar { width: 6px; height: 6px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: rgb(30 41 59); border-radius: 3px; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgb(71 85 105); border-radius: 3px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: rgb(100 116 139); }
        .touch-scroll { -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
      `}</style>

      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold">OrderFlow <span className="text-emerald-400">Pro</span></h1>
                <p className="text-[10px] sm:text-xs text-gray-500">Live Market Depth</p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="px-3 sm:px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg text-xs sm:text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              >
                <option value="btcusdt">BTC/USDT</option>
                <option value="ethusdt">ETH/USDT</option>
                <option value="bnbusdt">BNB/USDT</option>
                <option value="solusdt">SOL/USDT</option>
                <option value="adausdt">ADA/USDT</option>
                <option value="dogeusdt">DOGE/USDT</option>
              </select>

              <button
                onClick={() => setPaused(p => !p)}
                className={`px-3 py-2 rounded-lg text-xs sm:text-sm border ${paused ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300' : 'border-slate-700/50 bg-slate-800/80 text-gray-200'}`}
                title={paused ? 'Resume' : 'Pause live updates'}
              >
                <span className="inline-flex items-center gap-2">
                  {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  {paused ? 'Resume' : 'Pause'}
                </span>
              </button>

              <button
                onClick={() => setDense(d => !d)}
                className="px-3 py-2 rounded-lg text-xs sm:text-sm border border-slate-700/50 bg-slate-800/80 text-gray-200"
                title="Toggle density"
              >
                <span className="inline-flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  {dense ? 'Comfort' : 'Compact'}
                </span>
              </button>

              <div className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg min-w-[110px] sm:min-w-[130px] justify-center ${connected ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                {connected ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                <span className="text-[10px] sm:text-xs font-bold">{connected ? 'CONNECTED' : 'OFFLINE'}</span>
              </div>

              <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg min-w-[96px] sm:min-w-[110px]">
                <Zap className="w-4 h-4 text-yellow-400" />
                <span className="text-[10px] sm:text-xs text-gray-300 font-mono tabular-nums">
                  {lastUpdate ? `${Math.min(Date.now() - lastUpdate, 999)}ms` : '---ms'}
                </span>
              </div>
            </div>
          </div>

          {/* Top-of-book strip for instant judgment */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            <BestCard
              title="Best Bid"
              price={processed.bestBid?.price ?? bestTickerRef.current.bid}
              size={processed.bestBid?.amount ?? 0}
              color="emerald"
              priceFmt={priceFmt}
              qtyFmt={qtyFmt}
            />
            <BestCard
              title="Best Ask"
              price={processed.bestAsk?.price ?? bestTickerRef.current.ask}
              size={processed.bestAsk?.amount ?? 0}
              color="red"
              priceFmt={priceFmt}
              qtyFmt={qtyFmt}
            />
            <div className="bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
              <div className="text-[10px] sm:text-xs text-yellow-300/90 font-semibold uppercase mb-1">Spread / Mid</div>
              <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums">
                ${priceFmt(processed.spread)} <span className="text-sm sm:text-lg text-gray-400">({fmtFixed(processed.spreadPercent,3)}%)</span>
              </div>
              <div className="text-[11px] sm:text-xs text-gray-400 mt-1">Mid ${priceFmt(processed.midPrice)}</div>
            </div>
          </div>

          {/* Quick metrics */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3 mt-3">
            <InfoBox label="Msgs/sec" value={mps} />
            <InfoBox label="Reconnects" value={reconnects} />
            <InfoBox label="Buffered" value={buffered} />
            <InfoBox label="Group" value={`×${groupMult} • ~${priceFmt((tickSizeRef.current || 0.01) * groupMult)}`} />
            <InfoBox label="1m Imbalance" value={`${fmtFixed(im1m,1)}%`} />
            <InfoBox label="Rows" value={rowsRef.current} />
          </div>

          {/* Dominance bar */}
          <div className="mt-3 bg-slate-900/70 border border-slate-800 rounded-lg p-3">
            <div className="flex items-center justify-between text-[10px] sm:text-xs font-mono mb-2">
              <span className="text-emerald-400">Bid: {fmtCompact(totalBidVol)}</span>
              <span className="text-gray-400">Total: {fmtCompact(totalVol)}</span>
              <span className="text-red-400">Ask: {fmtCompact(totalAskVol)}</span>
            </div>
            <div className="h-2 rounded bg-slate-800 overflow-hidden">
              <div className="h-full bg-emerald-600" style={{ width: `${dominance*100}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="max-w-[1800px] mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="grid grid-cols-1 2xl:grid-cols-3 gap-4 sm:gap-6">
          {/* Order Book */}
          <div className="2xl:col-span-2">
            <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
              <div className="grid grid-cols-1 lg:grid-cols-2">
                {/* Bids */}
                <div className="border-r border-slate-800">
                  <SectionHeader title="BIDS (BUY)" icon={<TrendingUp className="w-4 h-4" />} color="emerald" />
                  <div className="max-h-[52vh] md:max-h-[600px] overflow-y-auto scrollbar-thin touch-scroll">
                    {processed.bids.length > 0 ? processed.bids.map((row, i) => (
                      <OrderRow key={`bid-${row.price}-${i}`} price={row.price} amount={row.amount} total={row.total}
                        maxTotal={processed.maxBidTotal} isBid priceFmt={priceFmt} qtyFmt={qtyFmt} dense={dense} />
                    )) : <EmptyLoad color="emerald" text="Loading bids..." />}
                  </div>
                </div>

                {/* Asks */}
                <div>
                  <SectionHeader title="ASKS (SELL)" icon={<TrendingDown className="w-4 h-4" />} color="red" />
                  <div className="max-h-[52vh] md:max-h-[600px] overflow-y-auto scrollbar-thin touch-scroll">
                    {processed.asks.length > 0 ? processed.asks.map((row, i) => (
                      <OrderRow key={`ask-${row.price}-${i}`} price={row.price} amount={row.amount} total={row.total}
                        maxTotal={processed.maxAskTotal} isBid={false} priceFmt={priceFmt} qtyFmt={qtyFmt} dense={dense} />
                    )) : <EmptyLoad color="red" text="Loading asks..." />}
                  </div>
                </div>
              </div>

              {/* Spread bar */}
              <OrderRow price={processed.spread} amount={0} total={0} maxTotal={1} isBid={false} isSpread priceFmt={priceFmt} qtyFmt={qtyFmt} dense={dense} />
            </div>

            {/* Display + Group controls */}
            <div className="mt-3 sm:mt-4 bg-slate-900/50 rounded-lg border border-slate-800 p-3 sm:p-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
                <span className="text-xs sm:text-sm text-gray-300 font-semibold">Display rows</span>
              </div>

              <div className="mt-2 sm:mt-3 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <button onClick={() => setDisplayRows(displayRows - 1)} className="p-2 rounded-md bg-slate-800 border border-slate-700 active:scale-95" aria-label="decrease rows">
                    <Minus className="w-4 h-4" />
                  </button>

                  <input
                    type="number" min={5} max={100} step={1} value={displayRows}
                    onChange={(e) => setDisplayRows(Number(e.target.value))}
                    className="w-20 text-center font-mono text-sm bg-slate-800 border border-slate-700 rounded-md py-2"
                  />

                  <button onClick={() => setDisplayRows(displayRows + 1)} className="p-2 rounded-md bg-slate-800 border border-slate-700 active:scale-95" aria-label="increase rows">
                    <Plus className="w-4 h-4" />
                  </button>

                  <input
                    type="range" min={5} max={100} step={1} value={displayRows}
                    onChange={(e) => setDisplayRows(Number(e.target.value))}
                    className="hidden sm:block flex-1 h-2 bg-slate-800 rounded-lg accent-emerald-500"
                  />
                </div>

                {/* Grouping */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-400">Group by</span>
                  {[1,5,10,50].map(m => (
                    <button
                      key={m}
                      onClick={() => setGroupMult(m)}
                      className={`px-3 py-1.5 rounded-md border text-xs font-semibold ${groupMult===m ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300' : 'bg-slate-800 border-slate-700 text-gray-300'}`}
                    >
                      ×{m} ticks
                    </button>
                  ))}
                  <span className="text-[11px] text-gray-500 font-mono ml-1">~ {priceFmt((tickSizeRef.current||0.01)*groupMult)} per level</span>
                </div>
              </div>
            </div>
          </div>

          {/* Trades */}
          <div>
            <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-800 overflow-hidden shadow-2xl h-[52vh] md:h-[700px] flex flex-col">
              <div className="bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-purple-500/20 px-3 sm:px-4 py-3 border-b border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                    <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400" />
                    <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">Recent Trades</span>
                  </h3>
                  <span className="text-[10px] sm:text-xs text-gray-400 bg-slate-800 px-2 py-1 rounded">{trades.length}/50</span>
                </div>
                <div className="flex items-center justify-between font-mono text-[10px] sm:text-xs font-bold mt-2 text-gray-500">
                  <span>PRICE</span><span>AMOUNT</span><span>TIME</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin touch-scroll">
                {trades.length === 0
                  ? <EmptyPanel />
                  : trades.map(t => <TradeRow key={`${t.id}-${t.time}`} trade={t} priceFmt={priceFmt} qtyFmt={qtyFmt} />)}
              </div>
            </div>

            {/* Trade sums */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
              <MiniStat title="Buy Volume" tone="emerald" value={fmtCompact(trades.filter(t=>!t.isBuyerMaker).reduce((s,t)=>s+t.quantity,0))} />
              <MiniStat title="Sell Volume" tone="red"     value={fmtCompact(trades.filter(t=> t.isBuyerMaker).reduce((s,t)=>s+t.quantity,0))} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-[1800px] mx-auto px-3 sm:px-4 py-5 text-center">
        <div className="bg-slate-900/30 rounded-lg border border-slate-800/50 p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs text-gray-500">
            Snapshot+delta sync • rAF-batched renders • Price grouping • Pause to inspect • Compact/Comfort modes
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// UI helpers
// ============================================================================
function InfoBox({ label, value }:{label:string; value:number|string}) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2 sm:p-3">
      <div className="text-[9px] sm:text-[10px] text-gray-400 uppercase">{label}</div>
      <div className="text-sm sm:text-lg font-mono">{value}</div>
    </div>
  );
}

function BestCard({
  title, price, size, color, priceFmt, qtyFmt,
}:{
  title:string; price:number; size:number; color:'emerald'|'red'; priceFmt:(n:number)=>string; qtyFmt:(n:number)=>string;
}) {
  const cls = color==='emerald' ? 'from-emerald-500/10 to-emerald-500/5 border-emerald-500/20' : 'from-red-500/10 to-red-500/5 border-red-500/20';
  const text = color==='emerald' ? 'text-emerald-300' : 'text-red-300';
  const icon = color==='emerald' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />;

  return (
    <div className={`bg-gradient-to-br ${cls} rounded-lg p-3 border`}>
      <div className="text-[10px] sm:text-xs text-white/70 font-semibold uppercase mb-1 flex items-center gap-2">{icon}{title}</div>
      <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums">${priceFmt(price || 0)}</div>
      <div className={`text-[11px] sm:text-xs ${text} mt-1`}>Size {qtyFmt(size || 0)}</div>
    </div>
  );
}

function SectionHeader({ title, icon, color }:{title:string; icon:React.ReactNode; color:'emerald'|'red'}) {
  const cls = color==='emerald' ? 'from-emerald-500/20 to-emerald-500/10' : 'from-red-500/20 to-red-500/10';
  const text = color==='emerald' ? 'text-emerald-400' : 'text-red-400';
  return (
    <div className={`bg-gradient-to-r ${cls} px-3 sm:px-4 py-3 border-b border-slate-800 sticky top-0 z-10`}>
      <div className="flex items-center justify-between font-mono text-[10px] sm:text-xs font-bold">
        <span className={`${text} flex items-center gap-2`}>{icon}{title}</span>
        <span className="text-gray-400">AMOUNT</span>
        <span className="text-gray-500">TOTAL</span>
      </div>
    </div>
  );
}
function EmptyLoad({ color, text }:{color:'emerald'|'red'; text:string}) {
  const borderColor = color==='emerald' ? 'border-emerald-500' : 'border-red-500';
  return (
    <div className="flex items-center justify-center h-40 text-gray-500">
      <div className="text-center">
        <div className={`animate-spin w-8 h-8 border-2 ${borderColor} border-t-transparent rounded-full mx-auto mb-2`} />
        <p className="text-sm">{text}</p>
      </div>
    </div>
  );
}
function EmptyPanel() {
  return (
    <div className="flex items-center justify-center h-full text-gray-500">
      <div className="text-center">
        <Activity className="w-10 h-10 mx-auto mb-2 opacity-20 animate-pulse" />
        <p className="text-sm">Waiting for trades...</p>
        <p className="text-xs text-gray-600 mt-1">Trades will appear here in real-time</p>
      </div>
    </div>
  );
}
function MiniStat({ title, value, tone }:{title:string; value:string; tone:'emerald'|'red'}) {
  const c = tone==='emerald' ? 'text-emerald-400' : 'text-red-400';
  return (
    <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-2 sm:p-3">
      <div className={`text-[10px] sm:text-xs ${c} font-semibold mb-1`}>{title}</div>
      <div className="text-sm sm:text-base font-bold text-white font-mono">{value}</div>
    </div>
  );
}