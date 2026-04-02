// ============================================================
// Trade Flow Manager — Order Flow & Delta
// ============================================================

class TradeFlowManager {
    constructor() {
        this.buckets = [];                  // { time, buyVol, sellVol, delta, trades[] }
        this.maxBuckets = CONFIG.ORDER_FLOW.MAX_BUCKETS;
        this.bucketInterval = CONFIG.ORDER_FLOW.TIME_BUCKET_MS;
        this.currentBucket = null;
        this.maxDelta = 1;
        this.maxVolume = 1;

        // ── Trade Bubbles (persistent, scroll with heatmap) ──
        this.activeBubbles = [];            // { timestamp, price, qty, usdValue, isBuy }
        this.liquidations = [];             // { timestamp, price, isLongLiquidation }
        this.absorptions = [];              // { timestamp, price, usdValue, isBuy }
        this.maxBubbleAge = CONFIG.HEATMAP.TIME_WINDOW_MS;  // keep for full visible window

        // ── Cumulative Delta ───────────────────────────────
        this.cumulativeDelta = 0;
        this.cumulativeDeltaHistory = [];   // { time, delta, price }
        this.maxCumDelta = 1;

        // ── Scalper Features ───────────────────────────────
        this.divergences = [];              // { timestamp, price, type: 'bull'|'bear' }
        this.lastCascadeTime = 0;           // Track last nuke event

        // ── Stats ──────────────────────────────────────────
        this.totalBuyVol = 0;
        this.totalSellVol = 0;
        this.lastPrice = 0;
        this.lastTradeTime = 0;
        this.recentLargeTradesCount = 0;

        // ── VWAP ───────────────────────────────────────────
        this.vwapVolume = 0;
        this.vwapSumPriceVol = 0;
        this.vwapSumPriceSqVol = 0;
        this.vwap = 0;
        this.vwapStdDev = 0;
    }

    // Process incoming aggTrade
    processTrade(data) {
        const price = parseFloat(data.p);
        const qty = parseFloat(data.q);
        const isBuy = !data.m;            // m=true means buyer is maker → sell aggression
        const time = data.T || Date.now();
        const usdValue = price * qty;

        this.lastPrice = price;
        this.lastTradeTime = time;

        // ── Bucket management ──────────────────────────────
        const bucketKey = Math.floor(time / this.bucketInterval) * this.bucketInterval;

        if (!this.currentBucket || this.currentBucket.time !== bucketKey) {
            // Start new bucket
            if (this.currentBucket) {
                this._finalizeBucket(this.currentBucket);
            }
            this.currentBucket = {
                time: bucketKey,
                buyVol: 0,
                sellVol: 0,
                delta: 0,
                count: 0,
                maxSingleTrade: 0,
            };
        }

        // ── Absorption Tracking ────────────────────────────
        if (this._absorptionPrice === price) {
            this._absorptionUsdSum = (this._absorptionUsdSum || 0) + usdValue;
        } else {
            this._absorptionPrice = price;
            this._absorptionUsdSum = usdValue;
            this._absorptionReported = false;
        }

        if (this._absorptionUsdSum >= 200000 && !this._absorptionReported) {
            this.absorptions.push({
                timestamp: Date.now(),
                price: price,
                usdValue: this._absorptionUsdSum,
                isBuy: isBuy // true = market buyers hitting Ask Iceberg, false = market sellers hitting Bid Iceberg
            });
            this._absorptionReported = true;
        }

        if (isBuy) {
            this.currentBucket.buyVol += qty;
            this.totalBuyVol += qty;
        } else {
            this.currentBucket.sellVol += qty;
            this.totalSellVol += qty;
        }
        this.currentBucket.delta = this.currentBucket.buyVol - this.currentBucket.sellVol;
        this.currentBucket.count++;
        if (qty > this.currentBucket.maxSingleTrade) {
            this.currentBucket.maxSingleTrade = qty;
        }

        // ── VWAP Calculation ───────────────────────────────
        this.vwapVolume += qty;
        this.vwapSumPriceVol += (price * qty);
        this.vwapSumPriceSqVol += (price * price * qty);
        
        this.vwap = this.vwapSumPriceVol / this.vwapVolume;
        const variance = (this.vwapSumPriceSqVol / this.vwapVolume) - (this.vwap * this.vwap);
        this.vwapStdDev = Math.sqrt(Math.max(0, variance));

        // ── Cumulative Delta ───────────────────────────────
        this.cumulativeDelta += isBuy ? qty : -qty;
        this.cumulativeDeltaHistory.push({ time, delta: this.cumulativeDelta, price: this.lastPrice });
        if (this.cumulativeDeltaHistory.length > this.maxBuckets * 10) {
            this.cumulativeDeltaHistory = this.cumulativeDeltaHistory.slice(-this.maxBuckets * 5);
        }
        const absCum = Math.abs(this.cumulativeDelta);
        if (absCum > this.maxCumDelta) this.maxCumDelta = absCum;

        // ── Trade Bubbles (large trades — persistent) ───────
        if (usdValue >= CONFIG.BUBBLES.MIN_QTY_USD) {
            this.activeBubbles.push({
                timestamp: Date.now(),    // wall-clock time to align with heatmap columns
                price,
                qty,
                usdValue,
                isBuy,
            });

            if (usdValue >= CONFIG.ORDER_FLOW.WHALE_THRESHOLD_USD) {
                this.recentLargeTradesCount++;
                if (window.app && window.app.soundManager) {
                    window.app.soundManager.playWhaleAlert(isBuy);
                }
            }
        }
    }

    // Process incoming ForceOrder (Liquidation)
    processLiquidation(data) {
        if (!data.o) return;
        const o = data.o;
        const isLongLiquidation = o.S === 'SELL'; // if the forced order is a SELL, a long was liquidated
        
        const now = Date.now();
        this.liquidations.push({
            timestamp: now,
            price: parseFloat(o.p),
            qty: parseFloat(o.q),
            isLongLiquidation,
            animationStart: performance.now()
        });

        // ── Cascade Detector ───────────────────────────────
        if (now - this.lastCascadeTime > 3000) { // Cooldown of 3s
            const recent = this.liquidations.filter(l => now - l.timestamp < 2000);
            if (recent.length >= 3) {
                this.lastCascadeTime = now;
            }
        }
    }

    _finalizeBucket(bucket) {
        this.buckets.push(bucket);
        if (this.buckets.length > this.maxBuckets) {
            this.buckets.shift();
        }

        // Update max values
        const absDelta = Math.abs(bucket.delta);
        if (absDelta > this.maxDelta) this.maxDelta = absDelta;

        const vol = bucket.buyVol + bucket.sellVol;
        if (vol > this.maxVolume) this.maxVolume = vol;

        // Slow decay
        this.maxDelta *= 0.999;
        this.maxVolume *= 0.999;

        // ── Divergence Detector ────────────────────────────
        // Compare current bucket to 10 buckets ago (approx 10 seconds)
        if (this.buckets.length > 10) {
            const oldBucket = this.buckets[this.buckets.length - 10];
            const oldDelta = this.cumulativeDeltaHistory.find(h => h.time >= oldBucket.time)?.delta || 0;
            const oldPrice = this.cumulativeDeltaHistory.find(h => h.time >= oldBucket.time)?.price || this.lastPrice;

            const priceDiff = this.lastPrice - oldPrice;
            const pricePct = priceDiff / oldPrice;
            const deltaDiff = this.cumulativeDelta - oldDelta;

            // Simple heuristic for strong divergence
            if (pricePct > 0.0005 && deltaDiff < -10000) { // Price up, Volume heavily selling -> Bear Divergence
                this.divergences.push({ timestamp: Date.now(), price: this.lastPrice, type: 'bear' });
            } else if (pricePct < -0.0005 && deltaDiff > 10000) { // Price down, Volume heavily buying -> Bull Divergence
                this.divergences.push({ timestamp: Date.now(), price: this.lastPrice, type: 'bull' });
            }
        }
    }

    // Prune bubbles that have scrolled off the visible time window
    updateBubbles() {
        const cutoff = Date.now() - this.maxBubbleAge;
        this.activeBubbles = this.activeBubbles.filter(b => b.timestamp >= cutoff);
        this.liquidations = this.liquidations.filter(b => b.timestamp >= cutoff);
        this.absorptions = this.absorptions.filter(a => a.timestamp >= cutoff);
        this.divergences = this.divergences.filter(d => d.timestamp >= cutoff);
    }

    // Get recent buckets for rendering
    getBuckets(count) {
        const total = Math.min(count, this.buckets.length);
        // Include current bucket
        const result = this.buckets.slice(-total);
        if (this.currentBucket) {
            result.push(this.currentBucket);
        }
        return result;
    }

    // Reset on symbol change
    reset() {
        this.buckets = [];
        this.currentBucket = null;
        this.activeBubbles = [];
        this.liquidations = [];
        this.absorptions = [];
        this.divergences = [];
        this.cumulativeDelta = 0;
        this.cumulativeDeltaHistory = [];
        this.maxDelta = 1;
        this.maxVolume = 1;
        this.maxCumDelta = 1;
        this.totalBuyVol = 0;
        this.totalSellVol = 0;
        this.recentLargeTradesCount = 0;

        this.vwapVolume = 0;
        this.vwapSumPriceVol = 0;
        this.vwapSumPriceSqVol = 0;
        this.vwap = 0;
        this.vwapStdDev = 0;
    }
}
