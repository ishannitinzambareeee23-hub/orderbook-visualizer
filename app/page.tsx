'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { TrendingUp, TrendingDown, Activity, Wifi, WifiOff, Zap, BarChart3, AlertCircle, CheckCircle2 } from 'lucide-react';

// ============================================================================
// TYPES & INTERFACES - Clean TypeScript usage
// ============================================================================

interface OrderBookLevel {
  price: number;
  amount: number;
  total: number;
}

interface Trade {
  id: number;
  price: number;
  quantity: number;
  time: number;
  isBuyerMaker: boolean;
  isNew: boolean;
}

interface OrderBookData {
  bids: Map<number, number>;
  asks: Map<number, number>;
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

interface BinanceDepthUpdate {
  e: string;
  E: number;
  s: string;
  U: number;
  u: number;
  b: [string, string][];
  a: [string, string][];
}

interface BinanceTradeUpdate {
  e: string;
  E: number;
  s: string;
  a: number;
  p: string;
  q: string;
  T: number;
  m: boolean;
}

// ============================================================================
// CUSTOM HOOK - useBinanceSocket with robust error handling
// ============================================================================

const useBinanceSocket = (symbol: string = 'btcusdt') => {
  const [orderBook, setOrderBook] = useState<OrderBookData>({ 
    bids: new Map(), 
    asks: new Map() 
  });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [connected, setConnected] = useState<boolean>(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateCount, setUpdateCount] = useState<number>(0);
  
  const wsRefs = useRef<{ 
    depth: WebSocket | null; 
    trades: WebSocket | null;
  }>({ depth: null, trades: null });
  
  const reconnectTimeouts = useRef<{ 
    depth: NodeJS.Timeout | null; 
    trades: NodeJS.Timeout | null;
  }>({ depth: null, trades: null });
  
  const reconnectAttempts = useRef<{ depth: number; trades: number }>({ 
    depth: 0, 
    trades: 0 
  });

  // Memoized WebSocket connection function with exponential backoff
  const connectWebSocket = useCallback((type: 'depth' | 'trades') => {
    const urls = {
      depth: `wss://stream.binance.com:9443/ws/${symbol}@depth@100ms`,
      trades: `wss://stream.binance.com:9443/ws/${symbol}@aggTrade`
    };

    try {
      const ws = new WebSocket(urls[type]);
      
      ws.onopen = () => {
        console.log(`✅ ${type} WebSocket connected to ${symbol}`);
        setConnected(true);
        setError(null);
        reconnectAttempts.current[type] = 0; // Reset attempts on successful connection
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastUpdate(Date.now());
          setUpdateCount(prev => prev + 1);

          if (type === 'depth') {
            // Efficient delta aggregation using Map for O(1) updates
            const depthData = data as BinanceDepthUpdate;
            
            setOrderBook(prev => {
              const newBids = new Map(prev.bids);
              const newAsks = new Map(prev.asks);

              // Process bid updates
              depthData.b?.forEach(([price, qty]) => {
                const p = parseFloat(price);
                const q = parseFloat(qty);
                
                // Remove price level if quantity is 0
                if (q === 0) {
                  newBids.delete(p);
                } else {
                  newBids.set(p, q);
                }
              });

              // Process ask updates
              depthData.a?.forEach(([price, qty]) => {
                const p = parseFloat(price);
                const q = parseFloat(qty);
                
                // Remove price level if quantity is 0
                if (q === 0) {
                  newAsks.delete(p);
                } else {
                  newAsks.set(p, q);
                }
              });

              return { bids: newBids, asks: newAsks };
            });
          } else if (type === 'trades') {
            const tradeData = data as BinanceTradeUpdate;
            
            const trade: Trade = {
              id: tradeData.a,
              price: parseFloat(tradeData.p),
              quantity: parseFloat(tradeData.q),
              time: tradeData.T,
              isBuyerMaker: tradeData.m,
              isNew: true
            };

            // Add new trade to top of list, keep only 50 most recent
            setTrades(prev => {
              const newTrades = [trade, ...prev.slice(0, 49)];
              
              // Remove flash after 300ms for smooth animation
              setTimeout(() => {
                setTrades(t => t.map(tr => 
                  tr.id === trade.id ? { ...tr, isNew: false } : tr
                ));
              }, 300);
              
              return newTrades;
            });
          }
        } catch (parseError) {
          console.error(`Error parsing ${type} message:`, parseError);
          setError(`Failed to parse ${type} data`);
        }
      };

      ws.onerror = (error) => {
        console.error(`❌ ${type} WebSocket error:`, error);
        setError(`${type} connection error`);
      };

      ws.onclose = (event) => {
        console.log(`🔌 ${type} WebSocket closed (${event.code}: ${event.reason})`);
        setConnected(false);
        
        // Exponential backoff reconnection
        const attempt = reconnectAttempts.current[type];
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30s
        
        reconnectAttempts.current[type]++;
        
        console.log(`🔄 Reconnecting ${type} in ${delay}ms (attempt ${attempt + 1})...`);
        
        reconnectTimeouts.current[type] = setTimeout(() => {
          wsRefs.current[type] = connectWebSocket(type);
        }, delay);
      };

      return ws;
    } catch (error) {
      console.error(`Failed to create ${type} WebSocket:`, error);
      setError(`Failed to initialize ${type} connection`);
      return null;
    }
  }, [symbol]);

  // Initialize WebSocket connections on mount or symbol change
  useEffect(() => {
    // Clear existing order book when symbol changes
    setOrderBook({ bids: new Map(), asks: new Map() });
    setTrades([]);
    setUpdateCount(0);
    
    wsRefs.current.depth = connectWebSocket('depth');
    wsRefs.current.trades = connectWebSocket('trades');

    // Cleanup function
    return () => {
      console.log('🧹 Cleaning up WebSocket connections...');
      
      // Close WebSocket connections
      Object.values(wsRefs.current).forEach(ws => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
      
      // Clear reconnection timeouts
      Object.values(reconnectTimeouts.current).forEach(timeout => {
        if (timeout) clearTimeout(timeout);
      });
    };
  }, [connectWebSocket, symbol]);

  return { 
    orderBook, 
    trades, 
    connected, 
    lastUpdate, 
    error,
    updateCount 
  };
};

// ============================================================================
// MEMOIZED COMPONENTS - Optimized for performance
// ============================================================================

// Order Book Row with depth visualization
const OrderRow = memo(({ 
  price, 
  amount, 
  total, 
  maxTotal, 
  isBid, 
  isSpread = false 
}: {
  price: number;
  amount: number;
  total: number;
  maxTotal: number;
  isBid: boolean;
  isSpread?: boolean;
}) => {
  const percentage = (total / maxTotal) * 100;
  const bgColor = isBid ? 'bg-emerald-500/10' : 'bg-red-500/10';
  const textColor = isBid ? 'text-emerald-400' : 'text-red-400';
  
  if (isSpread) {
    return (
      <div className="flex items-center justify-center py-3 px-4 bg-gradient-to-r from-emerald-500/5 via-yellow-500/10 to-red-500/5 border-y border-yellow-500/20">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-yellow-400" />
          <span className="text-yellow-400 font-bold text-sm">SPREAD</span>
          <span className="text-white font-mono font-bold">${price.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group hover:bg-white/5 transition-all duration-150 cursor-pointer">
      {/* Depth visualization bar */}
      <div 
        className={`absolute inset-y-0 ${isBid ? 'right-0' : 'left-0'} ${bgColor} transition-all duration-300`}
        style={{ width: `${percentage}%` }}
      />
      
      {/* Price, Amount, Total columns */}
      <div className="relative flex justify-between items-center px-4 py-2 font-mono text-sm">
        <span className={`${textColor} font-bold min-w-[100px]`}>
          ${price.toFixed(2)}
        </span>
        <span className="text-gray-300 min-w-[100px] text-right">
          {amount.toFixed(6)}
        </span>
        <span className="text-gray-400 text-xs min-w-[100px] text-right">
          {total.toFixed(6)}
        </span>
      </div>
    </div>
  );
});

OrderRow.displayName = 'OrderRow';

// Trade Row with flash animation
const TradeRow = memo(({ trade }: { trade: Trade }) => {
  const isBuy = !trade.isBuyerMaker; // Market buy (taker buy)
  const bgColor = isBuy ? 'bg-emerald-500/20' : 'bg-red-500/20';
  const textColor = isBuy ? 'text-emerald-400' : 'text-red-400';
  const icon = isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />;

  return (
    <div 
      className={`flex justify-between items-center px-3 py-2 font-mono text-xs border-l-2 ${
        isBuy ? 'border-emerald-500' : 'border-red-500'
      } ${trade.isNew ? `${bgColor} animate-flash` : 'bg-slate-800/30'} transition-all duration-300`}
    >
      <div className="flex items-center gap-2 min-w-[120px]">
        {icon}
        <span className={`${textColor} font-bold`}>${trade.price.toFixed(2)}</span>
      </div>
      <span className="text-gray-300 min-w-[90px] text-right">
        {trade.quantity.toFixed(6)}
      </span>
      <span className="text-gray-500 text-[10px] min-w-[70px] text-right">
        {new Date(trade.time).toLocaleTimeString()}
      </span>
    </div>
  );
});

TradeRow.displayName = 'TradeRow';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function OrderBookVisualizer() {
  const [symbol, setSymbol] = useState<string>('btcusdt');
  const [displayRows, setDisplayRows] = useState<number>(15);
  
  const { orderBook, trades, connected, lastUpdate, error, updateCount } = useBinanceSocket(symbol);

  // Process order book data with memoization to avoid recalculation
  const processedOrderBook = useMemo((): ProcessedOrderBook => {
    // Sort and slice bids (descending order - highest first)
    const bidsArray = Array.from(orderBook.bids.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, displayRows);
    
    // Sort and slice asks (ascending order - lowest first)
    const asksArray = Array.from(orderBook.asks.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, displayRows);

    // Calculate cumulative totals for bids
    let bidTotal = 0;
    const bidsWithTotal = bidsArray.map(([price, amount]) => {
      bidTotal += amount;
      return { price, amount, total: bidTotal };
    });

    // Calculate cumulative totals for asks
    let askTotal = 0;
    const asksWithTotal = asksArray.map(([price, amount]) => {
      askTotal += amount;
      return { price, amount, total: askTotal };
    });

    const maxBidTotal = bidsWithTotal[bidsWithTotal.length - 1]?.total || 1;
    const maxAskTotal = asksWithTotal[asksWithTotal.length - 1]?.total || 1;

    const highestBid = bidsArray[0]?.[0] || 0;
    const lowestAsk = asksArray[0]?.[0] || 0;
    const spread = lowestAsk - highestBid;
    const spreadPercent = highestBid > 0 ? (spread / highestBid) * 100 : 0;
    const midPrice = (highestBid + lowestAsk) / 2;

    return {
      bids: bidsWithTotal,
      asks: asksWithTotal,
      maxBidTotal,
      maxAskTotal,
      spread,
      spreadPercent,
      midPrice
    };
  }, [orderBook, displayRows]);

  // Calculate market statistics with memoization
  const stats = useMemo(() => {
    const totalBidVolume = Array.from(orderBook.bids.values())
      .reduce((sum, qty) => sum + qty, 0);
    
    const totalAskVolume = Array.from(orderBook.asks.values())
      .reduce((sum, qty) => sum + qty, 0);
    
    const totalVolume = totalBidVolume + totalAskVolume;
    const imbalance = totalVolume > 0 
      ? ((totalBidVolume - totalAskVolume) / totalVolume) * 100 
      : 0;

    return {
      totalBidVolume,
      totalAskVolume,
      totalVolume,
      imbalance: isFinite(imbalance) ? imbalance : 0,
      bidLevels: orderBook.bids.size,
      askLevels: orderBook.asks.size
    };
  }, [orderBook]);

  // Memoized symbol change handler
  const handleSymbolChange = useCallback((newSymbol: string) => {
    setSymbol(newSymbol);
  }, []);

  // Memoized display rows change handler
  const handleDisplayRowsChange = useCallback((rows: number) => {
    setDisplayRows(rows);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Global Styles */}
      <style jsx global>{`
        @keyframes flash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .animate-flash {
          animation: flash 0.3s ease-in-out;
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(16, 185, 129, 0.3); }
          50% { box-shadow: 0 0 30px rgba(16, 185, 129, 0.6); }
        }
        .pulse-glow {
          animation: pulse-glow 2s ease-in-out infinite;
        }
        @keyframes gradient-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .gradient-animate {
          background-size: 200% 200%;
          animation: gradient-shift 3s ease infinite;
        }
        
        /* Tabular numbers to prevent layout shift */
        .tabular-nums {
          font-variant-numeric: tabular-nums;
          font-feature-settings: "tnum";
        }
        
        /* Custom scrollbar */
        .scrollbar-thin::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: rgb(30 41 59);
          border-radius: 3px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgb(71 85 105);
          border-radius: 3px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: rgb(100 116 139);
        }
      `}</style>

      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto px-4 py-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Logo and Title */}
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
              {/* Symbol Selector */}
              <select
                value={symbol}
                onChange={(e) => handleSymbolChange(e.target.value)}
                className="px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all hover:bg-slate-800"
              >
                <option value="btcusdt">BTC/USDT</option>
                <option value="ethusdt">ETH/USDT</option>
                <option value="bnbusdt">BNB/USDT</option>
                <option value="solusdt">SOL/USDT</option>
                <option value="adausdt">ADA/USDT</option>
                <option value="dogeusdt">DOGE/USDT</option>
              </select>

              {/* Connection Status */}
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all min-w-[130px] justify-center ${
                connected 
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                  : 'bg-red-500/10 border border-red-500/20 text-red-400'
              }`}>
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

              {/* Latency Monitor */}
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg min-w-[100px]">
                <Zap className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                <span className="text-xs text-gray-300 font-mono tabular-nums">
                  {lastUpdate ? `${Math.min(Date.now() - lastUpdate, 999)}ms` : '---ms'}
                </span>
              </div>

              {/* Update Counter */}
              <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg min-w-[130px]">
                <Activity className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                <span className="text-xs text-gray-300 font-mono tabular-nums">{updateCount} updates</span>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mt-3 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {/* Statistics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
            {/* Mid Price */}
            <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 hover:border-emerald-500/40 transition-all">
              <div className="text-xs text-emerald-400/80 font-semibold mb-1 uppercase tracking-wide">Mid Price</div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">
                ${processedOrderBook.midPrice.toFixed(2)}
              </div>
            </div>

            {/* Spread */}
            <div className="bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 border border-yellow-500/20 rounded-lg p-3 hover:border-yellow-500/40 transition-all">
              <div className="text-xs text-yellow-400/80 font-semibold mb-1 uppercase tracking-wide">Spread</div>
              <div className="text-lg font-bold text-white font-mono tabular-nums flex items-baseline gap-1">
                ${processedOrderBook.spread.toFixed(2)}
                <span className="text-xs text-gray-400 font-normal">
                  ({processedOrderBook.spreadPercent.toFixed(3)}%)
                </span>
              </div>
            </div>

            {/* Total Volume */}
            <div className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/20 rounded-lg p-3 hover:border-blue-500/40 transition-all">
              <div className="text-xs text-blue-400/80 font-semibold mb-1 uppercase tracking-wide">Total Volume</div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">
                {stats.totalVolume.toFixed(2)}
              </div>
            </div>

            {/* Market Imbalance */}
            <div className={`bg-gradient-to-br ${
              stats.imbalance > 0 
                ? 'from-emerald-500/10 to-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40' 
                : 'from-red-500/10 to-red-500/5 border-red-500/20 hover:border-red-500/40'
            } border rounded-lg p-3 transition-all`}>
              <div className={`text-xs ${
                stats.imbalance > 0 ? 'text-emerald-400/80' : 'text-red-400/80'
              } font-semibold mb-1 uppercase tracking-wide`}>
                Imbalance
              </div>
              <div className={`text-lg font-bold ${
                stats.imbalance > 0 ? 'text-emerald-400' : 'text-red-400'
              } font-mono tabular-nums`}>
                {stats.imbalance > 0 ? '+' : ''}{stats.imbalance.toFixed(2)}%
              </div>
            </div>

            {/* Bid Levels */}
            <div className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border border-purple-500/20 rounded-lg p-3 hover:border-purple-500/40 transition-all">
              <div className="text-xs text-purple-400/80 font-semibold mb-1 uppercase tracking-wide">Bid Levels</div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">{stats.bidLevels}</div>
            </div>

            {/* Ask Levels */}
            <div className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/20 rounded-lg p-3 hover:border-orange-500/40 transition-all">
              <div className="text-xs text-orange-400/80 font-semibold mb-1 uppercase tracking-wide">Ask Levels</div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">{stats.askLevels}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1800px] mx-auto px-4 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Order Book - Two Column Layout */}
          <div className="xl:col-span-2">
            <div className="bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
              <div className="grid grid-cols-1 lg:grid-cols-2">
                {/* BIDS - Left Side */}
                <div className="border-r border-slate-800">
                  <div className="bg-gradient-to-r from-emerald-500/20 to-emerald-500/10 px-4 py-3 border-b border-slate-800">
                    <div className="flex items-center justify-between font-mono text-xs font-bold">
                      <span className="text-emerald-400 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        BIDS (BUY)
                      </span>
                      <span className="text-gray-400">AMOUNT</span>
                      <span className="text-gray-500">TOTAL</span>
                    </div>
                  </div>
                  
                  <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
                    {processedOrderBook.bids.length > 0 ? (
                      processedOrderBook.bids.map((row, idx) => (
                        <OrderRow
                          key={`bid-${row.price}-${idx}`}
                          price={row.price}
                          amount={row.amount}
                          total={row.total}
                          maxTotal={processedOrderBook.maxBidTotal}
                          isBid={true}
                        />
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-40 text-gray-500">
                        <p className="text-sm">Loading bids...</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* ASKS - Right Side */}
                <div>
                  <div className="bg-gradient-to-r from-red-500/20 to-red-500/10 px-4 py-3 border-b border-slate-800">
                    <div className="flex items-center justify-between font-mono text-xs font-bold">
                      <span className="text-red-400 flex items-center gap-2">
                        <TrendingDown className="w-4 h-4" />
                        ASKS (SELL)
                      </span>
                      <span className="text-gray-400">AMOUNT</span>
                      <span className="text-gray-500">TOTAL</span>
                    </div>
                  </div>
                  
                  <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
                    {processedOrderBook.asks.length > 0 ? (
                      processedOrderBook.asks.map((row, idx) => (
                        <OrderRow
                          key={`ask-${row.price}-${idx}`}
                          price={row.price}
                          amount={row.amount}
                          total={row.total}
                          maxTotal={processedOrderBook.maxAskTotal}
                          isBid={false}
                        />
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-40 text-gray-500">
                        <p className="text-sm">Loading asks...</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Spread Display */}
              <OrderRow
                price={processedOrderBook.spread}
                amount={0}
                total={0}
                maxTotal={1}
                isBid={false}
                isSpread={true}
              />
            </div>

            {/* Display Controls */}
            <div className="mt-4 flex items-center gap-3 bg-slate-900/50 backdrop-blur-xl rounded-lg border border-slate-800 p-4">
              <label className="text-sm text-gray-400 font-semibold">Display Rows:</label>
              <input
                type="range"
                min="5"
                max="30"
                value={displayRows}
                onChange={(e) => handleDisplayRowsChange(parseInt(e.target.value))}
                className="flex-1 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <span className="text-sm font-mono text-white bg-slate-800 px-3 py-1 rounded-lg min-w-[50px] text-center">
                {displayRows}
              </span>
            </div>
          </div>

          {/* Recent Trades - 50 Most Recent */}
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
                    <TradeRow key={`${trade.id}-${trade.time}`} trade={trade} />
                  ))
                )}
              </div>
            </div>

            {/* Trade Statistics */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="bg-slate-900/50 backdrop-blur-xl rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-emerald-400 font-semibold mb-1">Buy Volume</div>
                <div className="text-sm font-bold text-white font-mono">
                  {trades.filter(t => !t.isBuyerMaker).reduce((sum, t) => sum + t.quantity, 0).toFixed(4)}
                </div>
              </div>
              <div className="bg-slate-900/50 backdrop-blur-xl rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-red-400 font-semibold mb-1">Sell Volume</div>
                <div className="text-sm font-bold text-white font-mono">
                  {trades.filter(t => t.isBuyerMaker).reduce((sum, t) => sum + t.quantity, 0).toFixed(4)}
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
            Built with <span className="text-emerald-400">♥</span> using Next.js 15, TypeScript & Binance WebSocket API
          </p>
          <p className="text-xs text-gray-600 mt-1">
            High-Performance Real-time Market Data • Production Ready • 60 FPS Guaranteed
          </p>
        </div>
      </div>
    </div>
  );
}