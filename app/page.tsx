'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { TrendingUp, TrendingDown, Activity, Wifi, WifiOff, DollarSign, BarChart3 } from 'lucide-react';

// Types
interface Trade {
  id: string;
  price: number;
  quantity: number;
  time: number;
  isBuyerMaker: boolean;
}

interface OrderBookLevel {
  price: number;
  quantity: number;
  total: number;
}

interface OrderBookData {
  bids: Map<number, number>;
  asks: Map<number, number>;
  lastUpdateId: number;
}

// Custom Hook for Binance WebSocket
const useBinanceSocket = (symbol: string = 'btcusdt') => {
  const [orderBook, setOrderBook] = useState<OrderBookData>({
    bids: new Map(),
    asks: new Map(),
    lastUpdateId: 0
  });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsDepth = useRef<WebSocket | null>(null);
  const wsTrade = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout>();

  const initializeOrderBook = useCallback(async () => {
    try {
      const response = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=100`);
      const data = await response.json();
      
      const bids = new Map<number, number>();
      const asks = new Map<number, number>();
      
      data.bids.forEach(([price, qty]: [string, string]) => {
        bids.set(parseFloat(price), parseFloat(qty));
      });
      
      data.asks.forEach(([price, qty]: [string, string]) => {
        asks.set(parseFloat(price), parseFloat(qty));
      });
      
      setOrderBook({
        bids,
        asks,
        lastUpdateId: data.lastUpdateId
      });
    } catch (error) {
      console.error('Error initializing order book:', error);
    }
  }, [symbol]);

  const connectWebSocket = useCallback(() => {
    // Depth WebSocket
    wsDepth.current = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@depth@100ms`);
    
    wsDepth.current.onopen = () => {
      setIsConnected(true);
      console.log('Depth WebSocket connected');
    };
    
    wsDepth.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      setOrderBook(prev => {
        const newBids = new Map(prev.bids);
        const newAsks = new Map(prev.asks);
        
        data.b?.forEach(([price, qty]: [string, string]) => {
          const p = parseFloat(price);
          const q = parseFloat(qty);
          if (q === 0) {
            newBids.delete(p);
          } else {
            newBids.set(p, q);
          }
        });
        
        data.a?.forEach(([price, qty]: [string, string]) => {
          const p = parseFloat(price);
          const q = parseFloat(qty);
          if (q === 0) {
            newAsks.delete(p);
          } else {
            newAsks.set(p, q);
          }
        });
        
        return {
          bids: newBids,
          asks: newAsks,
          lastUpdateId: data.u
        };
      });
    };
    
    wsDepth.current.onerror = (error) => {
      console.error('Depth WebSocket error:', error);
      setIsConnected(false);
    };
    
    wsDepth.current.onclose = () => {
      setIsConnected(false);
      reconnectTimeout.current = setTimeout(() => {
        console.log('Reconnecting depth...');
        connectWebSocket();
      }, 3000);
    };
    
    // Trade WebSocket
    wsTrade.current = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@aggTrade`);
    
    wsTrade.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const trade: Trade = {
        id: data.a.toString(),
        price: parseFloat(data.p),
        quantity: parseFloat(data.q),
        time: data.T,
        isBuyerMaker: data.m
      };
      
      setTrades(prev => [trade, ...prev.slice(0, 49)]);
    };
  }, [symbol]);

  useEffect(() => {
    initializeOrderBook();
    connectWebSocket();
    
    return () => {
      wsDepth.current?.close();
      wsTrade.current?.close();
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
    };
  }, [initializeOrderBook, connectWebSocket]);

  return { orderBook, trades, isConnected };
};

// OrderBookRow Component
const OrderBookRow = memo(({ 
  price, 
  quantity, 
  total, 
  maxTotal, 
  isBid,
  isTopOfBook 
}: { 
  price: number; 
  quantity: number; 
  total: number; 
  maxTotal: number; 
  isBid: boolean;
  isTopOfBook: boolean;
}) => {
  const percentage = (total / maxTotal) * 100;
  const bgColor = isBid ? 'bg-emerald-500/20' : 'bg-rose-500/20';
  const textColor = isBid ? 'text-emerald-400' : 'text-rose-400';
  const Icon = isBid ? TrendingUp : TrendingDown;
  const glowClass = isTopOfBook ? (isBid ? 'shadow-emerald-500/50' : 'shadow-rose-500/50') : '';
  
  return (
    <div className={`relative h-6 flex items-center text-xs font-mono transition-all duration-200 ${glowClass}`}>
      <div 
        className={`absolute inset-y-0 ${isBid ? 'right-0' : 'left-0'} ${bgColor} transition-all duration-300`}
        style={{ width: `${percentage}%` }}
      />
      <div className={`relative z-10 grid grid-cols-3 gap-2 w-full px-3 ${isBid ? 'text-right' : 'text-left'}`}>
        <span className={`${textColor} font-semibold ${isTopOfBook ? 'text-sm' : ''}`}>
          {price.toFixed(2)}
        </span>
        <span className="text-slate-300">
          {quantity.toFixed(6)}
        </span>
        <span className="text-slate-400">
          {total.toFixed(4)}
        </span>
      </div>
    </div>
  );
});

OrderBookRow.displayName = 'OrderBookRow';

// OrderBook Component
const OrderBook = memo(({ orderBook }: { orderBook: OrderBookData }) => {
  const processedBids = useMemo(() => {
    const sorted = Array.from(orderBook.bids.entries())
      .sort(([a], [b]) => b - a)
      .slice(0, 15);
    
    let runningTotal = 0;
    return sorted.map(([price, quantity]) => {
      runningTotal += quantity;
      return { price, quantity, total: runningTotal };
    });
  }, [orderBook.bids]);

  const processedAsks = useMemo(() => {
    const sorted = Array.from(orderBook.asks.entries())
      .sort(([a], [b]) => a - b)
      .slice(0, 15);
    
    let runningTotal = 0;
    return sorted.map(([price, quantity]) => {
      runningTotal += quantity;
      return { price, quantity, total: runningTotal };
    });
  }, [orderBook.asks]);

  const spread = useMemo(() => {
    const lowestAsk = processedAsks[0]?.price;
    const highestBid = processedBids[0]?.price;
    if (lowestAsk && highestBid) {
      return {
        value: lowestAsk - highestBid,
        percentage: ((lowestAsk - highestBid) / highestBid) * 100
      };
    }
    return null;
  }, [processedAsks, processedBids]);

  const maxBidTotal = processedBids[processedBids.length - 1]?.total || 1;
  const maxAskTotal = processedAsks[processedAsks.length - 1]?.total || 1;

  return (
    <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden shadow-2xl">
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-4 py-3 border-b border-slate-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold text-white">Order Book</h2>
          </div>
          <div className="text-xs text-slate-400">Depth Chart</div>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-3 gap-2 px-3 mb-2 text-xs font-semibold text-slate-500">
          <span>Price (USDT)</span>
          <span>Amount (BTC)</span>
          <span>Total</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Bids */}
          <div className="space-y-0.5">
            {processedBids.map((bid, idx) => (
              <OrderBookRow
                key={bid.price}
                price={bid.price}
                quantity={bid.quantity}
                total={bid.total}
                maxTotal={maxBidTotal}
                isBid={true}
                isTopOfBook={idx === 0}
              />
            ))}
          </div>

          {/* Asks */}
          <div className="space-y-0.5">
            {processedAsks.map((ask, idx) => (
              <OrderBookRow
                key={ask.price}
                price={ask.price}
                quantity={ask.quantity}
                total={ask.total}
                maxTotal={maxAskTotal}
                isBid={false}
                isTopOfBook={idx === 0}
              />
            ))}
          </div>
        </div>

        {/* Spread */}
        {spread && (
          <div className="mt-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Spread</span>
              <div className="text-right">
                <div className="text-sm font-bold text-amber-400">
                  ${spread.value.toFixed(2)}
                </div>
                <div className="text-xs text-slate-500">
                  {spread.percentage.toFixed(3)}%
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

OrderBook.displayName = 'OrderBook';

// TradeRow Component
const TradeRow = memo(({ trade, isNew }: { trade: Trade; isNew: boolean }) => {
  const isBuy = !trade.isBuyerMaker;
  const bgColor = isBuy ? 'bg-emerald-500/10' : 'bg-rose-500/10';
  const textColor = isBuy ? 'text-emerald-400' : 'text-rose-400';
  const Icon = isBuy ? TrendingUp : TrendingDown;
  
  return (
    <div 
      className={`flex items-center gap-3 px-4 py-2 transition-all duration-500 ${isNew ? `${bgColor} animate-pulse` : 'hover:bg-slate-800/30'}`}
    >
      <Icon className={`w-4 h-4 ${textColor} flex-shrink-0`} />
      <div className="flex-1 grid grid-cols-3 gap-4 text-xs font-mono">
        <span className={`${textColor} font-semibold`}>
          ${trade.price.toFixed(2)}
        </span>
        <span className="text-slate-300">
          {trade.quantity.toFixed(6)}
        </span>
        <span className="text-slate-500">
          {new Date(trade.time).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
});

TradeRow.displayName = 'TradeRow';

// RecentTrades Component
const RecentTrades = memo(({ trades }: { trades: Trade[] }) => {
  const [newTradeId, setNewTradeId] = useState<string>('');

  useEffect(() => {
    if (trades.length > 0) {
      setNewTradeId(trades[0].id);
      const timer = setTimeout(() => setNewTradeId(''), 500);
      return () => clearTimeout(timer);
    }
  }, [trades]);

  return (
    <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden shadow-2xl">
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-4 py-3 border-b border-slate-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-bold text-white">Recent Trades</h2>
          </div>
          <div className="text-xs text-slate-400">Live Feed</div>
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="grid grid-cols-3 gap-4 px-4 mb-2 text-xs font-semibold text-slate-500">
          <span>Price</span>
          <span>Amount</span>
          <span>Time</span>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto custom-scrollbar">
        {trades.map((trade) => (
          <TradeRow 
            key={trade.id} 
            trade={trade} 
            isNew={trade.id === newTradeId}
          />
        ))}
      </div>
    </div>
  );
});

RecentTrades.displayName = 'RecentTrades';

// Stats Component
const Stats = memo(({ orderBook, trades }: { orderBook: OrderBookData; trades: Trade[] }) => {
  const stats = useMemo(() => {
    const lastTrade = trades[0];
    const recentTrades = trades.slice(0, 10);
    const avgPrice = recentTrades.length > 0 
      ? recentTrades.reduce((sum, t) => sum + t.price, 0) / recentTrades.length 
      : 0;
    
    const volume24h = recentTrades.reduce((sum, t) => sum + (t.price * t.quantity), 0);
    
    return {
      lastPrice: lastTrade?.price || 0,
      avgPrice,
      volume24h,
      bidDepth: Array.from(orderBook.bids.values()).reduce((sum, qty) => sum + qty, 0),
      askDepth: Array.from(orderBook.asks.values()).reduce((sum, qty) => sum + qty, 0)
    };
  }, [orderBook, trades]);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {[
        { label: 'Last Price', value: `$${stats.lastPrice.toFixed(2)}`, color: 'text-blue-400' },
        { label: 'Avg Price', value: `$${stats.avgPrice.toFixed(2)}`, color: 'text-purple-400' },
        { label: 'Volume', value: `$${stats.volume24h.toFixed(0)}`, color: 'text-amber-400' },
        { label: 'Bid Depth', value: `${stats.bidDepth.toFixed(4)} BTC`, color: 'text-emerald-400' },
        { label: 'Ask Depth', value: `${stats.askDepth.toFixed(4)} BTC`, color: 'text-rose-400' }
      ].map((stat) => (
        <div key={stat.label} className="bg-slate-900/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4">
          <div className="text-xs text-slate-500 mb-1">{stat.label}</div>
          <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
        </div>
      ))}
    </div>
  );
});

Stats.displayName = 'Stats';

// Main App Component
export default function Page() {
  const { orderBook, trades, isConnected } = useBinanceSocket('btcusdt');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-6">
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.5);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(71, 85, 105, 0.5);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(71, 85, 105, 0.8);
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .animate-pulse {
          animation: pulse 0.5s ease-in-out;
        }
      `}</style>

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-blue-500 to-purple-600 p-3 rounded-xl shadow-lg">
                <DollarSign className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Real-Time Order Book
                </h1>
                <p className="text-sm text-slate-400">BTC/USDT • Binance</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isConnected ? (
                <>
                  <Wifi className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm text-emerald-400 font-semibold">Live</span>
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                </>
              ) : (
                <>
                  <WifiOff className="w-5 h-5 text-rose-400" />
                  <span className="text-sm text-rose-400">Disconnected</span>
                </>
              )}
            </div>
          </div>

          <Stats orderBook={orderBook} trades={trades} />
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <OrderBook orderBook={orderBook} />
          </div>
          <div>
            <RecentTrades trades={trades} />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-slate-500">
          <p>Data provided by Binance • Updates every 100ms</p>
        </div>
      </div>
    </div>
  );
}