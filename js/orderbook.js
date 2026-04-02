// ============================================================
// OrderBook Manager — Heatmap Data Buffer
// ============================================================

class OrderBookManager {
    constructor() {
        this.bids = [];              // [[price, qty], ...]
        this.asks = [];              // [[price, qty], ...]
        this.midPrice = 0;
        this.spread = 0;
        this.bestBid = 0;
        this.bestAsk = 0;
        this.tickSize = 0.1;         // will be auto-detected
        this.maxQty = 1;             // running max for normalization

        // ── Spoofing & Micro OFI ───────────────────────────
        this.spoofEvents = [];
        this.bestBidVolume = 0;
        this.bestAskVolume = 0;
        this.prevBids = new Map();
        this.prevAsks = new Map();

        // ── Heatmap Ring Buffer ────────────────────────────
        this.maxColumns = CONFIG.HEATMAP.MAX_COLUMNS;
        this.priceLevels = CONFIG.HEATMAP.PRICE_LEVELS;
        this.columns = [];           // array of { time, prices[], quantities[], midPrice }
        this.writeIndex = 0;
        this.columnCount = 0;

        // ── Volume Profile accumulator ─────────────────────
        this.volumeProfile = new Map(); // price → { bid: qty, ask: qty }
        this.vpMaxQty = 1;
        this.valueArea = { poc: 0, vah: 0, val: 0 };

        // ── Price history for overlay ──────────────────────
        this.priceHistory = [];
        this.maxPriceHistory = CONFIG.HEATMAP.MAX_COLUMNS;

        // ── Stats ──────────────────────────────────────────
        this.totalBidDepth = 0;
        this.totalAskDepth = 0;
    }

    // Process incoming depth snapshot
    processDepth(data) {
        const bids = data.b.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
        const asks = data.a.map(([p, q]) => [parseFloat(p), parseFloat(q)]);

        if (bids.length === 0 || asks.length === 0) return;

        this.bids = bids;
        this.asks = asks;
        this.bestBid = bids[0][0];
        this.bestAsk = asks[0][0];
        this.midPrice = (this.bestBid + this.bestAsk) / 2;
        this.spread = this.bestAsk - this.bestBid;

        // Auto-detect tick size from price differences
        if (bids.length >= 2) {
            const diff = Math.abs(bids[0][0] - bids[1][0]);
            if (diff > 0) this.tickSize = diff;
        }

        // Calculate total bid/ask depth
        this.totalBidDepth = bids.reduce((s, [, q]) => s + q, 0);
        this.totalAskDepth = asks.reduce((s, [, q]) => s + q, 0);

        // ── Micro OFI ──────────────────────────────────────
        this.bestBidVolume = bids[0][1];
        this.bestAskVolume = asks[0][1];

        // ── Spoofing Detection ─────────────────────────────
        const newBidsMap = new Map(bids);
        for (const [prevP, prevQ] of this.prevBids) {
            const newQ = newBidsMap.get(prevP) || 0;
            const dropQty = prevQ - newQ;
            if (dropQty * prevP >= 100000) { // $100k pulled without execution
                this.spoofEvents.push({ timestamp: Date.now(), price: prevP, isBid: true });
            }
        }
        this.prevBids = newBidsMap;

        const newAsksMap = new Map(asks);
        for (const [prevP, prevQ] of this.prevAsks) {
            const newQ = newAsksMap.get(prevP) || 0;
            const dropQty = prevQ - newQ;
            if (dropQty * prevP >= 100000) {
                this.spoofEvents.push({ timestamp: Date.now(), price: prevP, isBid: false });
            }
        }
        this.prevAsks = newAsksMap;

        // Cleanup old spoof events
        const cutoff = Date.now() - CONFIG.HEATMAP.TIME_WINDOW_MS;
        this.spoofEvents = this.spoofEvents.filter(e => e.timestamp >= cutoff);

        // ── Build heatmap column ───────────────────────────
        this._appendColumn(bids, asks);

        // ── Update volume profile ──────────────────────────
        this._updateVolumeProfile(bids, asks);
    }

    _appendColumn(bids, asks) {
        const now = Date.now();

        // Merge bids and asks relative to mid price
        const priceMap = new Map();

        for (const [price, qty] of bids) {
            priceMap.set(price, { qty, side: 'bid' });
            if (qty > this.maxQty) this.maxQty = qty;
        }
        for (const [price, qty] of asks) {
            priceMap.set(price, { qty, side: 'ask' });
            if (qty > this.maxQty) this.maxQty = qty;
        }

        const column = {
            time: now,
            midPrice: this.midPrice,
            bestBid: this.bestBid,
            bestAsk: this.bestAsk,
            data: priceMap,
        };

        if (this.columns.length < this.maxColumns) {
            this.columns.push(column);
        } else {
            this.columns[this.writeIndex] = column;
        }
        this.writeIndex = (this.writeIndex + 1) % this.maxColumns;
        this.columnCount = Math.min(this.columnCount + 1, this.maxColumns);

        // Price history
        this.priceHistory.push({ time: now, price: this.midPrice });
        if (this.priceHistory.length > this.maxPriceHistory) {
            this.priceHistory.shift();
        }

        // Slowly decay maxQty for adaptive scaling
        this.maxQty *= 0.9999;
        if (this.maxQty < 1) this.maxQty = 1;
    }

    _updateVolumeProfile(bids, asks) {
        for (const [price, qty] of bids) {
            const key = this._roundPrice(price);
            let entry = this.volumeProfile.get(key);
            if (!entry) { entry = { bid: 0, ask: 0 }; this.volumeProfile.set(key, entry); }
            entry.bid = qty;
        }
        for (const [price, qty] of asks) {
            const key = this._roundPrice(price);
            let entry = this.volumeProfile.get(key);
            if (!entry) { entry = { bid: 0, ask: 0 }; this.volumeProfile.set(key, entry); }
            entry.ask = qty;
        }

        // Recalculate VP max and find POC
        this.vpMaxQty = 1;
        let pocVol = 0;
        let pocPrice = 0;
        let totalVol = 0;
        const profileArr = [];

        for (const [p, v] of this.volumeProfile) {
            const tot = v.bid + v.ask;
            totalVol += tot;
            profileArr.push({ price: p, vol: tot });
            if (tot > this.vpMaxQty) this.vpMaxQty = tot;
            if (tot > pocVol) {
                pocVol = tot;
                pocPrice = p;
            }
        }
        
        // ── Calculate Value Area (70% of volume) ──
        profileArr.sort((a, b) => a.price - b.price); // Ascending price
        const targetVol = totalVol * CONFIG.VOLUME_PROFILE.VALUE_AREA_PCT;
        let currentVol = pocVol;

        let pocIdx = profileArr.findIndex(p => p.price === pocPrice);
        let upIdx = pocIdx + 1;
        let downIdx = pocIdx - 1;

        while (currentVol < targetVol && (upIdx < profileArr.length || downIdx >= 0)) {
            let upVol = upIdx < profileArr.length ? profileArr[upIdx].vol : -1;
            let downVol = downIdx >= 0 ? profileArr[downIdx].vol : -1;

            if (upVol >= downVol && upVol !== -1) {
                currentVol += upVol;
                upIdx++;
            } else if (downVol > upVol) {
                currentVol += downVol;
                downIdx--;
            } else {
                break;
            }
        }

        const vah = upIdx <= profileArr.length && upIdx > 0 ? profileArr[upIdx - 1].price : pocPrice;
        const val = downIdx >= -1 && downIdx < profileArr.length - 1 ? profileArr[downIdx + 1].price : pocPrice;

        this.valueArea = { poc: pocPrice, vah, val };
    }

    _roundPrice(price) {
        return Math.round(price / this.tickSize) * this.tickSize;
    }

    // Get ordered columns for rendering (oldest → newest)
    getColumns(count, offset = 0) {
        const available = Math.max(0, this.columnCount - offset);
        const total = Math.min(count, available);
        if (total === 0) return [];

        const result = [];
        const start = (this.writeIndex - offset - total + this.maxColumns * 2) % this.maxColumns;
        
        for (let i = 0; i < total; i++) {
            const idx = (start + i) % this.maxColumns;
            result.push(this.columns[idx]);
        }
        return result;
    }

    // Get volume profile entries near current price
    getVolumeProfile(priceLevels) {
        if (!this.midPrice) return [];

        const halfRange = (priceLevels / 2) * this.tickSize;
        const minP = this.midPrice - halfRange;
        const maxP = this.midPrice + halfRange;

        const entries = [];
        for (const [price, vol] of this.volumeProfile) {
            if (price >= minP && price <= maxP) {
                entries.push({ price, ...vol });
            }
        }
        entries.sort((a, b) => b.price - a.price);
        return entries;
    }

    // Reset on symbol change
    reset() {
        this.columns = [];
        this.writeIndex = 0;
        this.columnCount = 0;
        this.volumeProfile.clear();
        this.priceHistory = [];
        this.maxQty = 1;
        this.vpMaxQty = 1;
        this.midPrice = 0;
        this.bestBidVolume = 0;
        this.bestAskVolume = 0;
        this.prevBids.clear();
        this.prevAsks.clear();
        this.spoofEvents = [];
    }
}
