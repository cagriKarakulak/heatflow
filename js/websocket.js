// ============================================================
// WebSocket Manager — Binance Futures Combined Stream
// ============================================================

class WebSocketManager {
    constructor(symbol) {
        this.symbol = symbol.toLowerCase();
        this.ws = null;
        this.handlers = {};
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.shouldReconnect = true;
        this.isConnected = false;
        this.messageCount = 0;
        this.lastMessageTime = 0;
        this.messagesPerSecond = 0;
        this._mpsInterval = null;
    }

    // Register event handler: 'depth', 'aggTrade', 'kline', 'status'
    on(event, handler) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(handler);
    }

    _emit(event, data) {
        const fns = this.handlers[event];
        if (fns) for (const fn of fns) fn(data);
    }

    connect() {
        this.shouldReconnect = true;
        this._connect();
        this._mpsInterval = setInterval(() => {
            this.messagesPerSecond = this.messageCount;
            this.messageCount = 0;
        }, 1000);
    }

    _connect() {
        const streams = [
            `${this.symbol}@depth${CONFIG.DEPTH_LEVELS}@${CONFIG.DEPTH_UPDATE_SPEED}`,
            `${this.symbol}@aggTrade`,
            `${this.symbol}@kline_1m`,
            `${this.symbol}@forceOrder`,
            `${this.symbol}@ticker`
        ].join('/');

        const url = CONFIG.WS_BASE_URL + streams;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            this.isConnected = true;
            this.reconnectDelay = 1000;
            this._emit('status', { connected: true, symbol: this.symbol });
        };

        this.ws.onmessage = (event) => {
            this.messageCount++;
            this.lastMessageTime = performance.now();
            try {
                const msg = JSON.parse(event.data);
                if (!msg.data) return;

                const stream = msg.stream;
                const data = msg.data;

                if (stream.includes('@depth')) {
                    this._emit('depth', data);
                } else if (stream.includes('@aggTrade')) {
                    this._emit('aggTrade', data);
                } else if (stream.includes('@kline')) {
                    this._emit('kline', data);
                } else if (stream.includes('@forceOrder')) {
                    this._emit('liquidation', data);
                } else if (stream.includes('@ticker')) {
                    this._emit('ticker', data);
                }
            } catch (e) {
                console.warn('WS parse error:', e);
            }
        };

        this.ws.onerror = (err) => {
            console.error('WS error:', err);
        };

        this.ws.onclose = () => {
            this.isConnected = false;
            this._emit('status', { connected: false, symbol: this.symbol });

            if (this.shouldReconnect) {
                setTimeout(() => {
                    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
                    this._connect();
                }, this.reconnectDelay);
            }
        };
    }

    disconnect() {
        this.shouldReconnect = false;
        if (this._mpsInterval) clearInterval(this._mpsInterval);
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }

    switchSymbol(newSymbol) {
        this.disconnect();
        this.symbol = newSymbol.toLowerCase();
        this.connect();
    }
}
