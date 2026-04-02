// ============================================================
// Sound Manager — Synthetic trade alerts
// ============================================================

class SoundManager {
    constructor() {
        this.enabled = false;
        this.audioCtx = null;
    }

    _init() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    toggle(state) {
        this.enabled = state;
        if (this.enabled) this._init();
    }

    playWhaleAlert(isBuy) {
        if (!this.enabled) return;
        this._init();
        
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        const osc = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();

        // Higher pitch for buy, lower for sell
        if (isBuy) {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, this.audioCtx.currentTime); // A5
            osc.frequency.exponentialRampToValueAtTime(1760, this.audioCtx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.3);
        } else {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(220, this.audioCtx.currentTime); // A3
            osc.frequency.exponentialRampToValueAtTime(110, this.audioCtx.currentTime + 0.15);
            gainNode.gain.setValueAtTime(0.4, this.audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.4);
        }

        osc.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.5);
    }
}

// ============================================================
// App Coordinator — Main Application Entry Point
// ============================================================

class HeatFlowApp {
    constructor() {
        // ── DOM References ─────────────────────────────────
        this.heatmapCanvas = document.getElementById('heatmap-canvas');
        this.volumeCanvas = document.getElementById('volume-canvas');
        this.orderflowCanvas = document.getElementById('orderflow-canvas');

        // ── Modules ────────────────────────────────────────
        this.ws = null;
        this.soundManager = new SoundManager();
        this.orderBook = new OrderBookManager();
        this.tradeFlow = new TradeFlowManager();
        this.heatmapRenderer = new HeatmapRenderer(this.heatmapCanvas);
        this.volumeRenderer = new VolumeProfileRenderer(this.volumeCanvas);
        this.orderflowRenderer = new OrderFlowRenderer(this.orderflowCanvas);

        // ── Signal Engine ──────────────────────────────────
        this.signalEngine = new SignalEngine();
        this.signalHUD    = new SignalHUD();
        this._signalHUDVisible = true;

        // Global ref for bubble rendering
        window._tradeFlow = this.tradeFlow;

        // ── State ──────────────────────────────────────────
        this.currentSymbol = CONFIG.DEFAULT_SYMBOL.toUpperCase();
        this.isRunning = false;
        this.frameCount = 0;
        this.fps = 0;
        this.lastFpsTime = performance.now();
        this.lastPrice = 0;
        this.priceChangePercent = 0;
        this._lastCascadeHandledTime = 0;

        // ── Initialize ─────────────────────────────────────
        this._setupEventListeners();
        this._populateSymbolList();
        
        // Initial i18n pass
        if (window.i18n) {
            window.i18n.updateDOM();
        }
        
        this._resize();
        this.start();
    }

    // ── Startup ────────────────────────────────────────────
    start() {
        if (this.isRunning) return;
        this.isRunning = true;

        // Connect WebSocket
        this.ws = new WebSocketManager(this.currentSymbol);
        this.ws.on('depth', (data) => this.orderBook.processDepth(data));
        this.ws.on('aggTrade', (data) => {
            this.tradeFlow.processTrade(data);
            this._updateTickerPrice(data);
        });
        this.ws.on('liquidation', (data) => this.tradeFlow.processLiquidation(data));
        this.ws.on('kline', (data) => this._processKline(data));
        this.ws.on('ticker', (data) => this._processTicker(data));
        this.ws.on('status', (status) => this._updateConnectionStatus(status));
        this.ws.connect();

        // Start render loop
        this._renderLoop();
    }

    stop() {
        this.isRunning = false;
        if (this.ws) this.ws.disconnect();
    }

    switchSymbol(symbol) {
        symbol = symbol.toUpperCase();
        if (symbol === this.currentSymbol) return;

        this.currentSymbol = symbol;
        this.orderBook.reset();
        this.tradeFlow.reset();
        this.signalEngine.reset();
        this.lastPrice = 0;
        this.priceChangePercent = 0;

        // Update UI
        document.getElementById('current-symbol').textContent = symbol;

        // Reconnect
        if (this.ws) this.ws.switchSymbol(symbol);

        // Update active state in symbol list
        document.querySelectorAll('.symbol-item').forEach(el => {
            el.classList.toggle('active', el.dataset.symbol === symbol);
        });
    }

    // ── Render Loop ────────────────────────────────────────
    _renderLoop() {
        if (!this.isRunning) return;

        // FPS counter
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsTime >= CONFIG.UI.FPS_UPDATE_INTERVAL) {
            this.fps = Math.round(this.frameCount / ((now - this.lastFpsTime) / 1000));
            this.frameCount = 0;
            this.lastFpsTime = now;
            document.getElementById('fps-counter').textContent = `${this.fps} FPS`;
        }

        // Update bubbles
        this.tradeFlow.updateBubbles();

        // ── Signal Engine ──────────────────────────────────
        this.signalEngine.update(this.orderBook, this.tradeFlow);
        if (this._signalHUDVisible) {
            this.signalHUD.render(this.signalEngine.getState());
        }

        // Render all panels
        this.heatmapRenderer.render(this.orderBook, this.tradeFlow);
        this.volumeRenderer.render(this.orderBook, this.heatmapRenderer);
        this.orderflowRenderer.render(this.tradeFlow);

        // Scalping Tape Speed Glow
        this._updateMomentumGlow();

        // Cascade Flash Detection
        if (this.tradeFlow.lastCascadeTime > this._lastCascadeHandledTime) {
            this._lastCascadeHandledTime = this.tradeFlow.lastCascadeTime;
            this._triggerCascadeFlash();
        }

        // Update stats
        this._updateStats();

        // Loop
        requestAnimationFrame(() => this._renderLoop());
    }

    _updateMomentumGlow() {
        const glowEl = document.getElementById('momentum-glow');
        if (!glowEl || !this.ws) return;

        const mps = this.ws.messagesPerSecond || 0;
        const threshold = 100; // If more than 100 WebSocket messages per second (high volatility)

        if (mps > threshold) {
            // Determine direction from active buckets or recent tick
            let activeClass = 'active-buy';
            if (this.tradeFlow && this.tradeFlow.currentBucket) {
                if (this.tradeFlow.currentBucket.delta < 0) {
                    activeClass = 'active-sell';
                }
            }
            
            glowEl.className = 'momentum-glow ' + activeClass;
            
            // Adjust opacity based on how much the threshold is exceeded (max 1.0)
            const opacity = Math.min(1.0, (mps - threshold) / 300);
            glowEl.style.opacity = opacity;
        } else {
            // Fade out
            glowEl.style.opacity = '0';
        }
    }

    // ── Data Processing ────────────────────────────────────
    _updateTickerPrice(data) {
        const price = parseFloat(data.p);
        if (this.lastPrice && this.lastPrice !== price) {
            const el = document.getElementById('ticker-price');
            el.textContent = price.toFixed(this._getPriceDecimals(price));
            el.className = price > this.lastPrice ? 'ticker-price up' : 'ticker-price down';
        }
        this.lastPrice = price;
    }

    _processKline(data) {
        if (data.k) {
            // Unused since we have pure ticker now, but keeping for future 1m kline functionality
        }
    }

    _processTicker(data) {
        // Ticker update logic stripped (UI element removed per user request)
    }

    _updateStats() {
        // Spread
        const spread = this.orderBook.spread;
        if (spread > 0) {
            document.getElementById('stat-spread').textContent = spread.toFixed(this._getPriceDecimals(spread));
        }

        // Messages per second
        if (this.ws) {
            document.getElementById('stat-mps').textContent = `${this.ws.messagesPerSecond}/s`;
        }

        // Bid/Ask depth
        const bidD = this.orderBook.totalBidDepth;
        const askD = this.orderBook.totalAskDepth;
        if (bidD > 0 || askD > 0) {
            document.getElementById('stat-bid-depth').textContent = this._formatQty(bidD);
            document.getElementById('stat-ask-depth').textContent = this._formatQty(askD);
        }

        // Large trades
        document.getElementById('stat-whales').textContent = this.tradeFlow.recentLargeTradesCount;
    }

    _updateConnectionStatus(status) {
        const dot = document.getElementById('connection-dot');
        const label = document.getElementById('connection-label');
        if (status.connected) {
            dot.className = 'connection-dot connected';
            label.textContent = window.i18n ? window.i18n.t('statusLive') : 'LIVE';
            label.className = 'connection-label connected';
        } else {
            dot.className = 'connection-dot disconnected';
            label.textContent = window.i18n ? window.i18n.t('statusDisconnected') : 'DISCONNECTED';
            label.className = 'connection-label disconnected';
        }
    }

    // ── Event Listeners ────────────────────────────────────
    _setupEventListeners() {
        // Resize
        window.addEventListener('resize', () => this._resize());

        // ── Signal HUD Toggle ──────────────────────────────
        const btnSignal = document.getElementById('btn-signal-toggle');
        if (btnSignal) {
            btnSignal.addEventListener('click', () => {
                this._signalHUDVisible = !this._signalHUDVisible;
                if (this.signalHUD.el) {
                    this.signalHUD.el.style.display = this._signalHUDVisible ? '' : 'none';
                }
                btnSignal.style.color      = this._signalHUDVisible ? '#ffab00' : '#8892a4';
                btnSignal.style.borderColor= this._signalHUDVisible ? 'rgba(255,171,0,.35)' : 'rgba(255,255,255,.1)';
                btnSignal.style.textShadow = this._signalHUDVisible ? '0 0 8px rgba(255,171,0,.5)' : '';
            });
            // Active by default
            btnSignal.style.color       = '#ffab00';
            btnSignal.style.borderColor = 'rgba(255,171,0,.35)';
            btnSignal.style.textShadow  = '0 0 8px rgba(255,171,0,.5)';
        }

        // Heatmap mouse events
        this.heatmapCanvas.addEventListener('mouseenter', () => {
            this.heatmapRenderer.showCrosshair = true;
        });
        this.heatmapCanvas.addEventListener('mouseleave', () => {
            this.heatmapRenderer.showCrosshair = false;
            this.heatmapRenderer.setMouse(-1, -1);
        });
        this.heatmapCanvas.addEventListener('mousemove', (e) => {
            const rect = this.heatmapCanvas.getBoundingClientRect();
            this.heatmapRenderer.setMouse(e.clientX - rect.left, e.clientY - rect.top);
        });

        // Zoom with mouse wheel
        this.heatmapCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;

            if (e.shiftKey) {
                // Horizontal zoom (time compression)
                this.heatmapRenderer.zoomX = Math.max(0.2, Math.min(10, this.heatmapRenderer.zoomX * delta));
            } else {
                // Vertical zoom (price levels)
                this.heatmapRenderer.zoomY = Math.max(0.3, Math.min(10, this.heatmapRenderer.zoomY * delta));
            }
        });

        // Pan with left or middle mouse button drag
        let isDragging = false;
        let lastDragX = 0;
        let lastDragY = 0;
        this.heatmapCanvas.addEventListener('mousedown', (e) => {
            if (e.button === 0 || e.button === 1) { // Left or Middle button
                isDragging = true;
                lastDragX = e.clientX;
                lastDragY = e.clientY;
                e.preventDefault();
            }
        });
        window.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const dx = e.clientX - lastDragX;
                const dy = e.clientY - lastDragY;
                
                // Vertical Pan
                this.heatmapRenderer.panY += dy * 0.05;
                
                // Horizontal Pan (Time Shift)
                if (Math.abs(dx) > 0) {
                    this.heatmapRenderer.panOffset = (this.heatmapRenderer.panOffset || 0) + (dx / this.heatmapRenderer.zoomX);
                    if (this.heatmapRenderer.panOffset < 0) this.heatmapRenderer.panOffset = 0;
                    
                    // If user manually pans away from edge, unlock auto-scroll
                    const btnLock = document.getElementById('btn-lock-scroll');
                    if (this.heatmapRenderer.panOffset > 0 && btnLock && btnLock.classList.contains('locked')) {
                        btnLock.classList.remove('locked');
                        btnLock.innerHTML = '<span class="icon">🔓</span> Lock View';
                    } else if (this.heatmapRenderer.panOffset === 0 && btnLock && !btnLock.classList.contains('locked')) {
                        btnLock.classList.add('locked');
                        btnLock.innerHTML = '<span class="icon">🔒</span> Auto-Scroll';
                    }
                }
                
                lastDragX = e.clientX;
                lastDragY = e.clientY;
            }
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0 || e.button === 1) isDragging = false;
        });

        // Toggle Auto-Scroll lock
        const btnLock = document.getElementById('btn-lock-scroll');
        if (btnLock) {
            btnLock.addEventListener('click', () => {
                const isLocked = btnLock.classList.toggle('locked');
                if (isLocked) {
                    btnLock.innerHTML = '<span class="icon">🔒</span> Auto-Scroll';
                    this.heatmapRenderer.panOffset = 0; // snap to live edge
                } else {
                    btnLock.innerHTML = '<span class="icon">🔓</span> Lock View';
                }
            });
        }

        // Toggle Sound Mute
        const btnSound = document.getElementById('btn-sound-toggle');
        if (btnSound) {
            btnSound.addEventListener('click', () => {
                const isSoundOn = !btnSound.classList.contains('active');
                if (isSoundOn) {
                    btnSound.classList.add('active');
                    btnSound.style.color = 'var(--text-primary)';
                    btnSound.innerHTML = '<span class="icon">🔊</span> Sound On';
                    this.soundManager.toggle(true);
                } else {
                    btnSound.classList.remove('active');
                    btnSound.style.color = '';
                    btnSound.innerHTML = '<span class="icon">🔇</span> Sound Off';
                    this.soundManager.toggle(false);
                }
            });
        }

        // Symbol search
        const searchInput = document.getElementById('symbol-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toUpperCase();
                document.querySelectorAll('.symbol-item').forEach(el => {
                    const match = el.dataset.symbol.includes(query);
                    el.style.display = match ? '' : 'none';
                });
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'r':
                case 'R':
                    // Reset zoom & pan
                    this.heatmapRenderer.zoomX = 1.0;
                    this.heatmapRenderer.zoomY = 1.0;
                    this.heatmapRenderer.panY = 0;
                    this.heatmapRenderer.panOffset = 0;
                    
                    const lockBtn = document.getElementById('btn-lock-scroll');
                    if (lockBtn) {
                        lockBtn.classList.add('locked');
                        lockBtn.innerHTML = '<span class="icon">🔒</span> Auto-Scroll';
                    }
                    break;
                case 'Escape':
                    // Close dropdowns
                    document.getElementById('symbol-dropdown').classList.remove('open');
                    break;
            }
        });

        // Symbol dropdown toggle
        const symbolBtn = document.getElementById('symbol-btn');
        const dropdown = document.getElementById('symbol-dropdown');
        if (symbolBtn) {
            symbolBtn.addEventListener('click', () => {
                dropdown.classList.toggle('open');
                if (dropdown.classList.contains('open') && searchInput) {
                    searchInput.focus();
                }
            });
        }

        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.symbol-selector')) {
                dropdown.classList.remove('open');
            }
        });

        // ── Settings Modal ─────────────────────────────────
        const btnSettings = document.getElementById('btn-settings');
        const modalSettings = document.getElementById('settings-modal');
        const btnCloseSettings = document.getElementById('btn-close-settings');

        if (btnSettings && modalSettings && btnCloseSettings) {
            btnSettings.addEventListener('click', () => {
                modalSettings.classList.add('open');
                
                // Sync UI with current config
                const whaleT = document.getElementById('setting-whale-threshold');
                const whaleL = document.getElementById('label-whale-threshold');
                if (whaleT && whaleL) {
                    whaleT.value = CONFIG.ORDER_FLOW.WHALE_THRESHOLD_USD;
                    whaleL.textContent = '$' + (CONFIG.ORDER_FLOW.WHALE_THRESHOLD_USD / 1000) + 'K';
                }

                const curveT = document.getElementById('setting-heatmap-curve');
                const curveL = document.getElementById('label-heatmap-curve');
                if (curveT && curveL) {
                    curveT.value = CONFIG.HEATMAP.INTENSITY_CURVE || 0.6;
                    curveL.textContent = parseFloat(CONFIG.HEATMAP.INTENSITY_CURVE || 0.6).toFixed(2);
                }
            });

            btnCloseSettings.addEventListener('click', () => {
                modalSettings.classList.remove('open');
            });

            // Close on background click
            modalSettings.addEventListener('click', (e) => {
                if (e.target === modalSettings) {
                    modalSettings.classList.remove('open');
                }
            });

            // Handle range inputs
            document.getElementById('setting-whale-threshold').addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                CONFIG.ORDER_FLOW.WHALE_THRESHOLD_USD = val;
                document.getElementById('label-whale-threshold').textContent = '$' + (val / 1000) + 'K';
            });

            document.getElementById('setting-heatmap-curve').addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                CONFIG.HEATMAP.INTENSITY_CURVE = val;
                document.getElementById('label-heatmap-curve').textContent = val.toFixed(2);
            });
        }

        // ── Language Toggle ────────────────────────────────
        const btnLang = document.getElementById('btn-lang');
        if (btnLang) {
            btnLang.addEventListener('click', () => {
                if (window.i18n) {
                    window.i18n.toggle();
                    this._updateConnectionStatus({ connected: this.ws && this.ws.isConnected });
                }
            });
        }

        // ── Info Modal ─────────────────────────────────────
        const btnInfo = document.getElementById('btn-info');
        const modalInfo = document.getElementById('info-modal');
        const btnCloseInfo = document.getElementById('btn-close-info');

        if (btnInfo && modalInfo && btnCloseInfo) {
            btnInfo.addEventListener('click', () => modalInfo.classList.add('open'));
            btnCloseInfo.addEventListener('click', () => modalInfo.classList.remove('open'));
            modalInfo.addEventListener('click', (e) => {
                if (e.target === modalInfo) modalInfo.classList.remove('open');
            });

            // Auto-show on first load
            if (!localStorage.getItem('heatflow_info_seen')) {
                modalInfo.classList.add('open');
                localStorage.setItem('heatflow_info_seen', 'true');
            }
        }
    }

    _triggerCascadeFlash() {
        const flashEl = document.getElementById('cascade-flash');
        if (flashEl) {
            flashEl.classList.remove('active');
            void flashEl.offsetWidth; // trigger reflow
            flashEl.classList.add('active');
        }
        
        const alertTx = document.getElementById('cascade-alert');
        if (alertTx) {
            alertTx.classList.add('show');
            setTimeout(() => alertTx.classList.remove('show'), 2000);
        }
    }

    _populateSymbolList() {
        const list = document.getElementById('symbol-list');
        if (!list) return;

        for (const symbol of CONFIG.SYMBOLS) {
            const item = document.createElement('div');
            item.className = 'symbol-item' + (symbol === this.currentSymbol ? ' active' : '');
            item.dataset.symbol = symbol;
            item.textContent = symbol;
            item.addEventListener('click', () => {
                this.switchSymbol(symbol);
                document.getElementById('symbol-dropdown').classList.remove('open');
            });
            list.appendChild(item);
        }
    }

    _resize() {
        const container = document.getElementById('main-content');
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const totalWidth = rect.width;
        const totalHeight = rect.height;

        const ofWidth = CONFIG.ORDER_FLOW.WIDTH;
        const vpWidth = CONFIG.VOLUME_PROFILE.WIDTH;
        const hmWidth = totalWidth - ofWidth - vpWidth;

        // Resize renderers
        this.heatmapRenderer.resize(Math.floor(hmWidth), Math.floor(totalHeight));
        this.volumeRenderer.resize(vpWidth, Math.floor(totalHeight));
        this.orderflowRenderer.resize(ofWidth, Math.floor(totalHeight));

        // Update canvas container sizes
        document.getElementById('orderflow-panel').style.width = ofWidth + 'px';
        document.getElementById('volume-panel').style.width = vpWidth + 'px';
    }

    _getPriceDecimals(price) {
        if (price >= 10000) return 1;
        if (price >= 100) return 2;
        if (price >= 1) return 3;
        return 4;
    }

    _formatQty(qty) {
        if (qty >= 1000000) return (qty / 1000000).toFixed(1) + 'M';
        if (qty >= 1000) return (qty / 1000).toFixed(1) + 'K';
        return qty.toFixed(2);
    }
}

// ── Launch ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    window.app = new HeatFlowApp();
});
