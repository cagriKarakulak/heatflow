// ============================================================
// Signal Engine v3 — High-Probability Order Flow Setups
// Inspired by Fabio Valantini's institutional flow methodology
// ============================================================
//
// PROFITABILITY PHILOSOPHY:
//
//   Signal fires RARELY — only on high-conviction setups.
//   Each setup has a clear asymmetric risk/reward:
//     - SWEEP setup:      stop beyond swept level, target VWAP    → ~1:3
//     - EXHAUSTION setup: stop at delta extreme, target re-mean   → ~1:2.5
//     - AGGRESSION setup: stop structure, targets momentum        → ~1:2
//
// FIVE COMPONENTS (all independently smoothed, all weighted):
//
//   1. SWEEP     — Liquidity sweep above/below recent high/low:
//                  Price runs stops then REVERSES with delta.
//                  Most reliable institutional pattern.
//
//   2. EXHAUSTION — Delta at extreme percentile but price stuck:
//                   Buyers/sellers running out of fuel.
//                   Classic "smart money trapping retail" pattern.
//
//   3. ABSORPTION — Price impact ratio: big delta, small move?
//                   A wall is silently absorbing all aggression.
//
//   4. AGGRESSION — Sustained directional taker volume (30s window).
//                   Whales don't use limit orders — they TAKE.
//
//   5. VWAP SETUP — Price >1.5σ from VWAP + delta reversion flow.
//                   Institutions defend VWAP. Don't fight fair value.
//
// STATE MACHINE:
//   ENTRY: score > ±0.30 AND ≥3/5 agree AND regime OK
//   EXIT:  score crosses ±0.10 (wide hysteresis band)
//   LOCK:  60 seconds minimum hold
//   FLIP:  need 72% confidence in opposite direction
//
// ============================================================

class SignalEngine {

    constructor() {
        // ── Hysteresis thresholds ───────────────────────────
        this.ENTRY_THRESH     = 0.30;
        this.EXIT_THRESH      = 0.10;
        this.MIN_HOLD_MS      = 60000;   // 60s
        this.STRONG_FLIP_CONF = 0.72;

        // ── State ───────────────────────────────────────────
        this.state            = 'NEUTRAL';
        this.direction        = 'NEUTRAL';
        this.confidence       = 0;
        this.trend            = 'NEUTRAL';
        this.compositeScore   = 0;
        this.signalQuality    = 'C';
        this.activeSetup      = '';
        this.lastSignalChange = Date.now();

        // ── Smoothed component scores [-1…+1] ───────────────
        this.smoothed = {
            sweep      : 0,
            exhaustion : 0,
            absorption : 0,
            aggression : 0,
            vwap       : 0,
            amt        : 0,   // Auction Market Theory
        };

        // Raw (unsmoothed) for display
        this.rawScores = {
            sweep      : 0,
            exhaustion : 0,
            absorption : 0,
            aggression : 0,
            vwap       : 0,
            amt        : 0,
        };

        // Weights (sum = 1.00)
        this.weights = {
            sweep      : 0.23,
            exhaustion : 0.20,
            absorption : 0.17,
            aggression : 0.12,
            vwap       : 0.08,
            amt        : 0.20,  // AMT — high weight, structural
        };

        // EWMA alpha per frame ~60fps
        this.alpha = {
            sweep      : 0.006,
            exhaustion : 0.008,
            absorption : 0.010,
            aggression : 0.025,
            vwap       : 0.015,
            amt        : 0.010,  // slow — structural context
        };

        // ── Double-pass composite smoother ──────────────────
        this._smoothComp1 = 0;
        this._smoothComp2 = 0;
        this.ALPHA_C1     = 0.04;
        this.ALPHA_C2     = 0.06;

        // ── Snapshot buffer (every 2s) ───────────────────────
        this._snapshots    = [];
        this._snapInterval = 2000;
        this._lastSnapTime = 0;
        this.MAX_SNAPS     = 150;

        // ── 1. Sweep State ───────────────────────────────────
        this._rollingHigh   = 0;
        this._rollingLow    = Infinity;
        this._sweepHigh     = false;
        this._sweepLow      = false;
        this._sweepTime     = 0;
        this._sweepHighAt   = 0;
        this._sweepLowAt    = 0;
        this._sweepDeltaAt  = 0;
        this._sweepBias     = 0;
        this.SWEEP_LOOKBACK = 60;
        this.SWEEP_THRESH   = 0.00025;
        this.SWEEP_DECAY    = 0.994;


        // ── 6. Auction Market Theory State ───────────────────
        // Value Area = VWAP ± 0.7σ  (≈ 70% of volume)
        // POC        = VWAP (best available approximation)
        // Tracks: how long price is outside value, acceptance vs rejection
        this._amtBias           = 0;    // accumulated AMT score
        this.AMT_DECAY          = 0.992;
        this._outsideValueSnaps = 0;    // consecutive snaps outside VA
        this._outsideDir        = 0;    // +1 above VAH, -1 below VAL
        this._vaRejectionCount  = 0;    // rapid return from outside = rejection
        this._valueShiftLong    = false;// sustained acceptance above VAH
        this._valueShiftShort   = false;// sustained acceptance below VAL
        this.VA_FACTOR          = 0.7;  // VAH = VWAP + 0.7σ
        this.REJECTION_SNAPS    = 6;    // <6 snaps outside = rejection
        this.ACCEPTANCE_SNAPS   = 25;   // >25 snaps outside = acceptance (value shift)

        // ── 2. Exhaustion State ──────────────────────────────
        this._deltaPercentile = 0.5;
        this._deltaHistory    = [];
        this.DELTA_HIST_SIZE  = 120;
        this._exhaustBias     = 0;
        this.EXHAUST_DECAY    = 0.993;

        // ── 3. Absorption State ──────────────────────────────
        this._absorptionBias  = 0;
        this.ABSORB_DECAY     = 0.995;
        this._absorbLastSeen  = 0;

        // ── 4. Aggression State ──────────────────────────────
        this._aggrSnapshots   = [];
        this.AGGR_WINDOW_MS   = 30000;

        // ── 5. VWAP State ────────────────────────────────────
        // (self-contained, driven directly by tradeFlow data)

        // ── Regime Gate ──────────────────────────────────────
        this._regimeOK      = false;
        this._emaVolatility = 0;
        this._emaVolume     = 0;

        // ── Signal History + Trend ───────────────────────────
        this.signalHistory  = [];
        this._trendVotes    = [];
        this.TREND_WINDOW   = 60;
        this.MAX_HISTORY    = 300;

        // Alias for HUD compatibility
        this.scores = this.smoothed;
    }

    // ═══════════════════════════════════════════════════════════
    // Main Update (called every render frame ~60fps)
    // ═══════════════════════════════════════════════════════════
    update(orderBook, tradeFlow) {
        if (!orderBook || !tradeFlow || !orderBook.midPrice) return;

        const now = Date.now();

        if (now - this._lastSnapTime >= this._snapInterval) {
            this._takeSnapshot(orderBook, tradeFlow, now);
            this._lastSnapTime = now;
        }

        this._updateSweep(orderBook, tradeFlow, now);
        this._updateExhaustion(tradeFlow, orderBook);
        this._updateAbsorption(tradeFlow, orderBook, now);
        this._updateAggression(tradeFlow, now);
        this._updateVWAP(tradeFlow, orderBook);
        this._updateAMT(orderBook, tradeFlow);
        this._updateRegime(tradeFlow);

        // Composite double-EWMA
        let raw = 0;
        for (const [k, w] of Object.entries(this.weights)) {
            raw += (this.smoothed[k] || 0) * w;
        }
        raw = Math.max(-1, Math.min(1, raw));
        this._smoothComp1 = this._smoothComp1 * (1 - this.ALPHA_C1) + raw * this.ALPHA_C1;
        this._smoothComp2 = this._smoothComp2 * (1 - this.ALPHA_C2) + this._smoothComp1 * this.ALPHA_C2;
        this.compositeScore = this._smoothComp2;

        const confluence = this._calcConfluence();
        this._updateStateMachine(now, confluence);

        const confBonus = Math.max(0, (confluence.count - 2) * 9);
        this.confidence = Math.min(99, Math.round(
            Math.abs(this.compositeScore) * 100 * (this._regimeOK ? 1 : 0.5) + confBonus
        ));

        this._updateQuality(confluence);

        const vote = this.compositeScore > 0.08 ? 1 : this.compositeScore < -0.08 ? -1 : 0;
        this._trendVotes.push(vote);
        if (this._trendVotes.length > this.TREND_WINDOW) this._trendVotes.shift();
        this._updateTrend();

        this.signalHistory.push({ time: now, score: this.compositeScore });
        if (this.signalHistory.length > this.MAX_HISTORY) this.signalHistory.shift();
    }

    // ─────────────────────────────────────────────────────────
    // Snapshot helper
    // ─────────────────────────────────────────────────────────
    _takeSnapshot(orderBook, tradeFlow, now) {
        const cur = tradeFlow.currentBucket;
        const snap = {
            time    : now,
            price   : orderBook.midPrice,
            cumDelta: tradeFlow.cumulativeDelta,
            buyVol  : cur ? cur.buyVol : 0,
            sellVol : cur ? cur.sellVol : 0,
        };
        this._snapshots.push(snap);
        if (this._snapshots.length > this.MAX_SNAPS) this._snapshots.shift();

        if (this._snapshots.length >= 2) {
            const prev = this._snapshots[this._snapshots.length - 2];
            const vol  = Math.abs(snap.price - prev.price) / prev.price;
            const bvol = snap.buyVol + snap.sellVol;
            this._emaVolatility = this._emaVolatility * 0.9  + vol  * 0.1;
            this._emaVolume     = this._emaVolume     * 0.88 + bvol * 0.12;
        }

        // Rolling high / low (exclude current snap)
        const lookStart = Math.max(0, this._snapshots.length - 1 - this.SWEEP_LOOKBACK);
        const subset    = this._snapshots.slice(lookStart, -1);
        if (subset.length > 0) {
            this._rollingHigh = Math.max(...subset.map(s => s.price));
            this._rollingLow  = Math.min(...subset.map(s => s.price));
        }

        // Aggression snapshot
        this._aggrSnapshots.push({ time: now, buyAggr: snap.buyVol, sellAggr: snap.sellVol });
        const cutoff = now - this.AGGR_WINDOW_MS;
        while (this._aggrSnapshots.length > 1 && this._aggrSnapshots[0].time < cutoff) {
            this._aggrSnapshots.shift();
        }
    }

    // ─────────────────────────────────────────────────────────
    // 1. LIQUIDITY SWEEP DETECTOR
    //    Price sweeps recent high/low, then reverses with delta.
    //    Stop = beyond swept level. Target = VWAP / structure.
    // ─────────────────────────────────────────────────────────
    _updateSweep(orderBook, tradeFlow, now) {
        const price    = orderBook.midPrice;
        const maxD     = Math.max(tradeFlow.maxCumDelta, 1);
        const latestDelta = tradeFlow.cumulativeDelta;

        this._sweepBias *= this.SWEEP_DECAY;

        if (this._snapshots.length < 12 || !this._rollingHigh || !this._rollingLow) {
            this.rawScores.sweep = 0;
            this.smoothed.sweep  = this.smoothed.sweep * (1 - this.alpha.sweep);
            return;
        }

        // Detect new sweep above high
        if (!this._sweepHigh && price > this._rollingHigh * (1 + this.SWEEP_THRESH)) {
            this._sweepHigh    = true;
            this._sweepTime    = now;
            this._sweepHighAt  = price;
            this._sweepDeltaAt = latestDelta;
        }

        // Confirm sweep above: came back + delta reversed
        if (this._sweepHigh) {
            const elapsed      = now - this._sweepTime;
            const comeBack     = price < this._rollingHigh * (1 + this.SWEEP_THRESH * 0.4);
            const deltaReversed = latestDelta < this._sweepDeltaAt - maxD * 0.04;
            if (elapsed < 40000) {
                if (comeBack && deltaReversed) {
                    const strength = Math.min(1, (this._sweepHighAt - this._rollingHigh) / (this._rollingHigh * this.SWEEP_THRESH * 3));
                    this._sweepBias = Math.max(-1, this._sweepBias - 0.7 * (0.5 + strength * 0.5));
                    this._sweepHigh = false;
                }
            } else {
                this._sweepHigh = false;
            }
        }

        // Detect new sweep below low
        if (!this._sweepLow && price < this._rollingLow * (1 - this.SWEEP_THRESH)) {
            this._sweepLow     = true;
            this._sweepTime    = now;
            this._sweepLowAt   = price;
            this._sweepDeltaAt = latestDelta;
        }

        // Confirm sweep below: came back + delta reversed
        if (this._sweepLow) {
            const elapsed      = now - this._sweepTime;
            const comeBack     = price > this._rollingLow * (1 - this.SWEEP_THRESH * 0.4);
            const deltaReversed = latestDelta > this._sweepDeltaAt + maxD * 0.04;
            if (elapsed < 40000) {
                if (comeBack && deltaReversed) {
                    const strength = Math.min(1, (this._rollingLow - this._sweepLowAt) / (this._rollingLow * this.SWEEP_THRESH * 3));
                    this._sweepBias = Math.min(1, this._sweepBias + 0.7 * (0.5 + strength * 0.5));
                    this._sweepLow  = false;
                }
            } else {
                this._sweepLow = false;
            }
        }

        const raw = Math.max(-1, Math.min(1, this._sweepBias));
        this.rawScores.sweep = raw;
        this.smoothed.sweep  = this.smoothed.sweep * (1 - this.alpha.sweep) + raw * this.alpha.sweep;
    }

    // ─────────────────────────────────────────────────────────
    // 2. DELTA EXHAUSTION
    //    Delta at extreme percentile but price not confirming.
    //    HIGH delta + price stuck = buyers exhausted → SHORT
    //    LOW  delta + price stuck = sellers exhausted → LONG
    // ─────────────────────────────────────────────────────────
    _updateExhaustion(tradeFlow, orderBook) {
        this._exhaustBias *= this.EXHAUST_DECAY;

        if (this._snapshots.length < 20) {
            this.rawScores.exhaustion = 0;
            this.smoothed.exhaustion  = this.smoothed.exhaustion * (1 - this.alpha.exhaustion);
            return;
        }

        const latestDelta = tradeFlow.cumulativeDelta;
        this._deltaHistory.push(latestDelta);
        if (this._deltaHistory.length > this.DELTA_HIST_SIZE) this._deltaHistory.shift();
        if (this._deltaHistory.length < 20) { this.rawScores.exhaustion = 0; return; }

        // Delta percentile in recent history
        const sorted = [...this._deltaHistory].sort((a, b) => a - b);
        const rank   = sorted.findIndex(v => v >= latestDelta);
        const pct    = rank / (sorted.length - 1);
        this._deltaPercentile = pct;

        // Price position in recent N bars
        const recent     = this._snapshots.slice(-30);
        const priceHigh  = Math.max(...recent.map(s => s.price));
        const priceLow   = Math.min(...recent.map(s => s.price));
        const priceRange = priceHigh - priceLow;
        const pricePct   = priceRange > 0 ? (orderBook.midPrice - priceLow) / priceRange : 0.5;

        // HIGH exhaust: delta > 85th pctle, price < 65th → SHORT
        if (pct > 0.85 && pricePct < 0.65) {
            const intensity = ((pct - 0.85) / 0.15) * ((0.65 - pricePct) / 0.65);
            this._exhaustBias = Math.max(-1, this._exhaustBias - intensity * 0.5);
        }
        // LOW exhaust: delta < 15th pctle, price > 35th → LONG
        else if (pct < 0.15 && pricePct > 0.35) {
            const intensity = ((0.15 - pct) / 0.15) * ((pricePct - 0.35) / 0.65);
            this._exhaustBias = Math.min(1, this._exhaustBias + intensity * 0.5);
        }

        const raw = Math.max(-1, Math.min(1, this._exhaustBias));
        this.rawScores.exhaustion = raw;
        this.smoothed.exhaustion  = this.smoothed.exhaustion * (1 - this.alpha.exhaustion) + raw * this.alpha.exhaustion;
    }

    // ─────────────────────────────────────────────────────────
    // 3. ABSORPTION QUALITY
    //    Price impact ratio + explicit absorption events.
    //    Big delta, tiny price move = wall absorbing aggression.
    // ─────────────────────────────────────────────────────────
    _updateAbsorption(tradeFlow, orderBook, now) {
        this._absorptionBias *= this.ABSORB_DECAY;

        // Price impact ratio (8-snap window)
        if (this._snapshots.length >= 8) {
            const old8   = this._snapshots[this._snapshots.length - 8];
            const latest = this._snapshots[this._snapshots.length - 1];
            const maxD   = Math.max(tradeFlow.maxCumDelta, 1);
            const deltaFlow = Math.abs(latest.cumDelta - old8.cumDelta);
            const priceMove = Math.abs(latest.price - old8.price) / old8.price;

            if (deltaFlow > maxD * 0.02 && priceMove > 0) {
                const normDelta = deltaFlow / (maxD * 0.3);
                const normPrice = priceMove / 0.001;
                const impact    = normDelta / (normPrice + 0.01);

                if (impact > 3.0) {
                    const deltaSign = Math.sign(latest.cumDelta - old8.cumDelta);
                    const bias = -deltaSign * Math.min(0.3, (impact - 3) * 0.05);
                    this._absorptionBias = Math.max(-1, Math.min(1, this._absorptionBias + bias));
                }
            }
        }

        // Explicit absorption events
        const WINDOW_MS = 30000;
        for (const abs of tradeFlow.absorptions.filter(a => now - a.timestamp < WINDOW_MS)) {
            if (abs.timestamp <= this._absorbLastSeen) continue;
            this._absorbLastSeen = Math.max(this._absorbLastSeen, abs.timestamp);
            const bias     = abs.isBuy ? -1.0 : 1.0;
            const sizeNorm = Math.min(1, abs.usdValue / 500000);
            this._absorptionBias = Math.max(-1, Math.min(1, this._absorptionBias + bias * sizeNorm * 0.45));
        }

        // Inferred: price flat vs. significant delta flow
        if (this._snapshots.length >= 10) {
            const old10  = this._snapshots[this._snapshots.length - 10];
            const latest = this._snapshots[this._snapshots.length - 1];
            const maxD   = Math.max(tradeFlow.maxCumDelta, 1);
            const priceMv = Math.abs((latest.price - old10.price) / old10.price);
            const deltaMv = (latest.cumDelta - old10.cumDelta) / maxD;
            if (priceMv < 0.00005 && Math.abs(deltaMv) > 0.02) {
                const inferBias = -Math.sign(deltaMv) * Math.min(0.15, Math.abs(deltaMv) * 2);
                this._absorptionBias = Math.max(-1, Math.min(1, this._absorptionBias + inferBias));
            }
        }

        const raw = Math.max(-1, Math.min(1, this._absorptionBias));
        this.rawScores.absorption = raw;
        this.smoothed.absorption  = this.smoothed.absorption * (1 - this.alpha.absorption) + raw * this.alpha.absorption;
    }

    // ─────────────────────────────────────────────────────────
    // 4. VOLUME AGGRESSION
    //    Sustained one-sided taker flow over 30-second window.
    //    Includes aggression divergence: fading momentum warning.
    // ─────────────────────────────────────────────────────────
    _updateAggression(tradeFlow, now) {
        const aggrSnaps = this._aggrSnapshots;
        if (aggrSnaps.length < 5) {
            this.rawScores.aggression = 0;
            this.smoothed.aggression  = this.smoothed.aggression * (1 - this.alpha.aggression);
            return;
        }

        let totalBuy = 0, totalSell = 0;
        for (const s of aggrSnaps) { totalBuy += s.buyAggr; totalSell += s.sellAggr; }
        const totalVol = totalBuy + totalSell;
        if (totalVol < 0.01) {
            this.rawScores.aggression = 0;
            this.smoothed.aggression  = this.smoothed.aggression * (1 - this.alpha.aggression);
            return;
        }

        const netRatio = (totalBuy - totalSell) / totalVol;
        const sign = Math.sign(netRatio);
        const abs  = Math.abs(netRatio);
        let raw;
        if (abs > 0.70) {
            raw = sign * Math.min(1, 0.5 + (abs - 0.70) * 3.3);
        } else if (abs > 0.55) {
            raw = sign * 0.3 * ((abs - 0.55) / 0.15);
        } else {
            raw = 0;
        }

        // Aggression divergence (fading momentum dampener)
        if (aggrSnaps.length >= 10) {
            const half    = Math.floor(aggrSnaps.length / 2);
            const oldHalf = aggrSnaps.slice(0, half);
            const newHalf = aggrSnaps.slice(half);
            const tally   = arr => {
                const b = arr.reduce((a, s) => a + s.buyAggr - s.sellAggr, 0);
                const t = arr.reduce((a, s) => a + s.buyAggr + s.sellAggr, 0);
                return t > 0 ? b / t : 0;
            };
            const oldR = tally(oldHalf);
            const newR = tally(newHalf);
            if (Math.sign(oldR) === Math.sign(newR) && Math.abs(newR) < Math.abs(oldR) * 0.6) {
                raw *= 0.5;
            }
        }

        raw = Math.max(-1, Math.min(1, raw));
        this.rawScores.aggression = raw;
        this.smoothed.aggression  = this.smoothed.aggression * (1 - this.alpha.aggression) + raw * this.alpha.aggression;
    }

    // ─────────────────────────────────────────────────────────
    // 5. VWAP SETUP
    //    Extension >1.5σ from VWAP + delta reversion confirmation.
    //    If delta still pushing same direction → no fade (breakout).
    // ─────────────────────────────────────────────────────────
    _updateVWAP(tradeFlow, orderBook) {
        const price  = orderBook.midPrice;
        const vwap   = tradeFlow.vwap;
        const stdDev = tradeFlow.vwapStdDev;

        if (!vwap || !price || stdDev < 0.01) {
            this.smoothed.vwap = this.smoothed.vwap * (1 - this.alpha.vwap);
            return;
        }

        const sigmas = (price - vwap) / stdDev;
        const clampedSig = Math.max(-3.5, Math.min(3.5, sigmas));
        const absS = Math.abs(clampedSig);

        if (absS < 1.2) {
            this.rawScores.vwap = 0;
            this.smoothed.vwap  = this.smoothed.vwap * (1 - this.alpha.vwap);
            return;
        }

        // Delta reversion check
        let deltaReversion = 0;
        const snaps = this._snapshots;
        if (snaps.length >= 6) {
            const mid    = snaps[snaps.length - 6];
            const latest = snaps[snaps.length - 1];
            const maxD   = Math.max(tradeFlow.maxCumDelta, 1);
            const dFlow  = (latest.cumDelta - mid.cumDelta) / maxD;
            if (Math.sign(dFlow) !== Math.sign(clampedSig)) {
                deltaReversion = Math.min(1, Math.abs(dFlow) / 0.06);
            } else {
                deltaReversion = -0.3; // breakout — don't fade
            }
        }

        const fadeStrength = absS < 2.0
            ? (absS - 1.2) / 0.8 * 0.5
            : 0.5 + (absS - 2.0) / 1.5 * 0.5;
        const raw = Math.max(-1, Math.min(1,
            -Math.sign(clampedSig) * fadeStrength * (0.3 + deltaReversion * 0.7)
        ));

        this.rawScores.vwap = raw;
        this.smoothed.vwap  = this.smoothed.vwap * (1 - this.alpha.vwap) + raw * this.alpha.vwap;
    }

    // ─────────────────────────────────────────────────────────
    // 6. AUCTION MARKET THEORY (AMT)
    //
    //  Core principle: Markets are continuous two-way auctions.
    //  Price alternates between "building value" (balance inside VA)
    //  and "finding new value" (trending outside VA).
    //
    //  Value Area (VA) = price range of 70% volume ≈ VWAP ± 0.7σ
    //  Point of Control (POC) ≈ VWAP
    //
    //  Four AMT signals:
    //
    //  A) REJECTION from above VAH  → SHORT (responsive sellers defending value)
    //     Price probed above VAH, came back quickly (<6 snaps)
    //     Stop: above high of probe. Target: VWAP / VAL.
    //
    //  B) REJECTION from below VAL  → LONG  (responsive buyers defending value)
    //     Price probed below VAL, came back quickly.
    //
    //  C) ACCEPTANCE above VAH      → LONG  (initiative buyers, value shifting up)
    //     Price stayed above VAH for >25 snaps (50s).
    //     Market is "auctioning higher" → trend signal.
    //
    //  D) ACCEPTANCE below VAL      → SHORT (value shifting down)
    //
    //  Also: POC Magnet — when price is far from POC, mild pull back.
    // ─────────────────────────────────────────────────────────
    _updateAMT(orderBook, tradeFlow) {
        const price  = orderBook.midPrice;
        const vwap   = tradeFlow.vwap;
        const stdDev = tradeFlow.vwapStdDev;

        // Decay existing bias
        this._amtBias *= this.AMT_DECAY;

        if (!vwap || !price || stdDev < 0.01 || this._snapshots.length < 15) {
            this.rawScores.amt = 0;
            this.smoothed.amt  = this.smoothed.amt * (1 - this.alpha.amt);
            return;
        }

        const vah = vwap + stdDev * this.VA_FACTOR;  // Value Area High
        const val = vwap - stdDev * this.VA_FACTOR;  // Value Area Low
        const poc = vwap;                             // POC ≈ VWAP

        // ── Determine current price zone ─────────────────────
        const aboveVAH = price > vah;
        const belowVAL = price < val;
        const inValue  = !aboveVAH && !belowVAL;
        const curDir   = aboveVAH ? 1 : belowVAL ? -1 : 0;

        if (inValue) {
            // Price returned inside Value Area
            if (this._outsideValueSnaps > 0 && this._outsideValueSnaps < this.REJECTION_SNAPS) {
                // REJECTION: quick probe outside, came back — strong counter-trend
                const rejStrength = 1 - this._outsideValueSnaps / this.REJECTION_SNAPS;
                // Was above VAH → came back → SHORT (rejection of high prices)
                // Was below VAL → came back → LONG  (rejection of low prices)
                const rejBias = -this._outsideDir * rejStrength * 0.6;
                this._amtBias = Math.max(-1, Math.min(1, this._amtBias + rejBias));
                this._vaRejectionCount++;
            } else if (this._outsideValueSnaps >= this.ACCEPTANCE_SNAPS) {
                // Was accepted outside, now returned — possible exhaustion
                // Moderate counter-signal (value has shifted, now mean-reverting)
                const retBias = -this._outsideDir * 0.25;
                this._amtBias = Math.max(-1, Math.min(1, this._amtBias + retBias));
            }
            // Reset outside counter
            this._outsideValueSnaps = 0;
            this._outsideDir = 0;
            this._valueShiftLong  = false;
            this._valueShiftShort = false;

            // POC pull: price above POC inside VA → mild bullish (price > fair value but within range)
            // Conversely below POC → mild bearish
            const distFromPOC = (price - poc) / (stdDev * 0.5 + 0.001);
            const pocBias = Math.max(-0.15, Math.min(0.15, -distFromPOC * 0.05));
            this._amtBias = Math.max(-1, Math.min(1, this._amtBias + pocBias));

        } else {
            // Price is OUTSIDE Value Area
            if (this._outsideDir !== curDir) {
                // Just crossed outside (or switched side)
                this._outsideValueSnaps = 1;
                this._outsideDir = curDir;
            } else {
                this._outsideValueSnaps++;
            }

            const snaps = this._outsideValueSnaps;

            if (snaps >= this.ACCEPTANCE_SNAPS) {
                // ACCEPTANCE — value is genuinely shifting
                // curDir=+1 (above VAH) → market auctioning higher → LONG
                // curDir=-1 (below VAL) → market auctioning lower  → SHORT
                if (!this._valueShiftLong && curDir === 1) {
                    this._valueShiftLong = true;
                    this._amtBias = Math.min(1, this._amtBias + 0.5);
                } else if (!this._valueShiftShort && curDir === -1) {
                    this._valueShiftShort = true;
                    this._amtBias = Math.max(-1, this._amtBias - 0.5);
                }
                // Continuation bias as price extends
                const extBias = curDir * 0.008;
                this._amtBias = Math.max(-1, Math.min(1, this._amtBias + extBias));

            } else if (snaps >= this.REJECTION_SNAPS) {
                // UNCERTAIN ZONE: not rejection (too long) but not acceptance yet
                // Mild opposite-direction fade bias — market still deciding
                const fadeBias = -curDir * 0.02 * (snaps - this.REJECTION_SNAPS) / (this.ACCEPTANCE_SNAPS - this.REJECTION_SNAPS);
                this._amtBias = Math.max(-1, Math.min(1, this._amtBias + fadeBias));
            }
            // snaps < REJECTION_SNAPS: too early to judge — let decay handle it
        }

        const raw = Math.max(-1, Math.min(1, this._amtBias));
        this.rawScores.amt = raw;
        this.smoothed.amt  = this.smoothed.amt * (1 - this.alpha.amt) + raw * this.alpha.amt;
    }

    // ─────────────────────────────────────────────────────────
    // Regime Gate
    // ─────────────────────────────────────────────────────────
    _updateRegime() {
        this._regimeOK = this._snapshots.length >= 15
                      && this._emaVolatility > 0.00002
                      && this._emaVolume > 0.01;
    }

    // ─────────────────────────────────────────────────────────
    // Confluence
    // ─────────────────────────────────────────────────────────
    _calcConfluence() {
        const sign = Math.sign(this._smoothComp1);
        if (sign === 0) return { count: 0, fraction: 0 };
        let agree = 0, total = 0;
        for (const v of Object.values(this.smoothed)) {
            total++;
            if (Math.sign(v) === sign && Math.abs(v) >= 0.03) agree++;
        }
        return { count: agree, fraction: total > 0 ? agree / total : 0 };
    }

    // ─────────────────────────────────────────────────────────
    // State Machine (Hysteresis)
    // ─────────────────────────────────────────────────────────
    _updateStateMachine(now, confluence) {
        const score   = this.compositeScore;
        const locked  = (now - this.lastSignalChange) < this.MIN_HOLD_MS;
        const confOK  = confluence.count >= 3;
        const prev    = this.state;
        let   next    = this.state;

        if (!this._regimeOK) {
            if (this.state !== 'NEUTRAL') next = 'NEUTRAL';
        } else {
            switch (this.state) {
                case 'NEUTRAL':
                    if      (score >=  this.ENTRY_THRESH && confOK) next = 'LONG';
                    else if (score <= -this.ENTRY_THRESH && confOK) next = 'SHORT';
                    break;
                case 'LONG':
                    if (locked) {
                        if (score <= -this.ENTRY_THRESH && this.confidence >= this.STRONG_FLIP_CONF * 100) next = 'SHORT';
                    } else {
                        if (score <= -this.EXIT_THRESH) next = (score <= -this.ENTRY_THRESH && confOK) ? 'SHORT' : 'NEUTRAL';
                    }
                    break;
                case 'SHORT':
                    if (locked) {
                        if (score >= this.ENTRY_THRESH && this.confidence >= this.STRONG_FLIP_CONF * 100) next = 'LONG';
                    } else {
                        if (score >= this.EXIT_THRESH) next = (score >= this.ENTRY_THRESH && confOK) ? 'LONG' : 'NEUTRAL';
                    }
                    break;
            }
        }

        if (next !== prev) {
            this.state = next; this.direction = next; this.lastSignalChange = now;
            this._updateActiveSetup();
        } else {
            this.direction = this.state;
        }
    }

    _updateActiveSetup() {
        const labels = { sweep:'Liquidity Sweep', exhaustion:'Delta Exhaustion', absorption:'Absorption Wall', aggression:'Vol Aggression', vwap:'VWAP Extension', amt:'AMT Rejection' };
        const dominant = Object.entries(this.smoothed)
            .filter(([, v]) => Math.sign(v) === Math.sign(this.compositeScore))
            .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));
        this.activeSetup = dominant.length > 0 ? (labels[dominant[0][0]] || '') : '';
    }

    _updateQuality(confluence) {
        const absComp = Math.abs(this.compositeScore);
        if      (confluence.count >= 4 && absComp > 0.35 && this._regimeOK) this.signalQuality = 'A';
        else if (confluence.count >= 3 && absComp > 0.26 && this._regimeOK)  this.signalQuality = 'B';
        else                                                                   this.signalQuality = 'C';
    }

    _updateTrend() {
        if (this._trendVotes.length < 20) { this.trend = 'NEUTRAL'; return; }
        const avg = this._trendVotes.reduce((a, b) => a + b, 0) / this._trendVotes.length;
        if      (avg >  0.28) this.trend = 'LONG';
        else if (avg < -0.28) this.trend = 'SHORT';
        else                  this.trend = 'NEUTRAL';
    }

    // ─────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────
    getState() {
        return {
            direction       : this.direction,
            confidence      : this.confidence,
            compositeScore  : this.compositeScore,
            trend           : this.trend,
            scores          : { ...this.smoothed },
            rawScores       : { ...this.rawScores },
            lastSignalChange: this.lastSignalChange,
            regimeOK        : this._regimeOK,
            confluence      : this._calcConfluence(),
            history         : this.signalHistory,
            locked          : (Date.now() - this.lastSignalChange) < this.MIN_HOLD_MS,
            lockRemaining   : Math.max(0, this.MIN_HOLD_MS - (Date.now() - this.lastSignalChange)),
            signalQuality   : this.signalQuality,
            activeSetup     : this.activeSetup,
            deltaPercentile : this._deltaPercentile,
        };
    }

    reset() {
        this.state = 'NEUTRAL'; this.direction = 'NEUTRAL';
        this.compositeScore = 0; this._smoothComp1 = 0; this._smoothComp2 = 0;
        this.signalHistory = []; this._snapshots = []; this._aggrSnapshots = [];
        this._deltaHistory = []; this._trendVotes = [];
        this._emaVolatility = 0; this._emaVolume = 0; this._lastSnapTime = 0;
        this._sweepHigh = false; this._sweepLow = false; this._sweepBias = 0;
        this._exhaustBias = 0; this._absorptionBias = 0; this._absorbLastSeen = 0;
        this._rollingHigh = 0; this._rollingLow = Infinity;
        // AMT reset
        this._amtBias = 0; this._outsideValueSnaps = 0; this._outsideDir = 0;
        this._vaRejectionCount = 0; this._valueShiftLong = false; this._valueShiftShort = false;
        for (const k of Object.keys(this.smoothed)) { this.smoothed[k] = 0; this.rawScores[k] = 0; }
    }
}

// ============================================================
// Signal HUD v3 — Premium Overlay Card
// ============================================================

class SignalHUD {
    constructor() {
        this.el          = null;
        this.alertEl     = null;
        this.barEls      = {};
        this.lastDir     = null;
        this.flashTimer  = null;
        this._alertTimer = null;
        this._buildUI();
    }

    _buildUI() {
        const hud = document.createElement('div');
        hud.id        = 'signal-hud';
        hud.className = 'signal-hud';
        hud.innerHTML = `
          <div class="sh-header">
            <span class="sh-title">⚡ ORDER FLOW SIGNAL</span>
            <span class="sh-badge sh-badge-neutral" id="sh-dir-badge">NEUTRAL</span>
          </div>

          <div class="sh-gauge-wrap">
            <div class="sh-gauge-track">
              <div class="sh-gauge-fill" id="sh-gauge-fill"></div>
              <div class="sh-gauge-center"></div>
            </div>
            <div class="sh-gauge-labels">
              <span class="sh-label-short">SHORT</span>
              <span class="sh-label-center">0</span>
              <span class="sh-label-long">LONG</span>
            </div>
          </div>

          <div class="sh-confidence-row">
            <span class="sh-conf-label">Confidence</span>
            <div class="sh-conf-bar-wrap"><div class="sh-conf-bar" id="sh-conf-bar"></div></div>
            <span class="sh-conf-value" id="sh-conf-value">0%</span>
          </div>

          <div class="sh-confluence-row">
            <span class="sh-conf-label">Confluence</span>
            <div class="sh-dots">
              <span class="sh-dot" id="sh-dot-0"></span>
              <span class="sh-dot" id="sh-dot-1"></span>
              <span class="sh-dot" id="sh-dot-2"></span>
              <span class="sh-dot" id="sh-dot-3"></span>
              <span class="sh-dot" id="sh-dot-4"></span>
            </div>
            <span class="sh-conf-value" id="sh-regime-badge">—</span>
          </div>

          <div class="sh-lock-row" id="sh-lock-row" style="display:none">
            <span class="sh-lock-icon">🔒</span>
            <div class="sh-lock-bar-wrap"><div class="sh-lock-bar" id="sh-lock-bar"></div></div>
            <span class="sh-conf-value" id="sh-lock-time">60s</span>
          </div>

          <!-- Signal quality badge + active setup -->
          <div class="sh-setup-row" id="sh-setup-row">
            <span class="sh-quality-badge" id="sh-quality-badge">C</span>
            <span class="sh-setup-name" id="sh-setup-name">Waiting for setup…</span>
          </div>

          <div class="sh-components">
            ${this._componentRow('sweep',      '🔫 Sweep')}
            ${this._componentRow('exhaustion', '🔋 Exhaustion')}
            ${this._componentRow('absorption', '🧲 Absorb')}
            ${this._componentRow('aggression', '⚡ Aggression')}
            ${this._componentRow('vwap',       '〽️ VWAP')}
            ${this._componentRow('amt',        '🏛️ AMT')}
          </div>

          <div class="sh-footer">
            <span class="sh-trend-label">Trend:</span>
            <span class="sh-trend-value" id="sh-trend-val">—</span>
            <span class="sh-time" id="sh-time">0s</span>
          </div>
        `;

        const target = document.getElementById('heatmap-panel')
                    || document.getElementById('main-content')
                    || document.body;
        target.style.position = 'relative';
        target.appendChild(hud);

        const alertEl = document.createElement('div');
        alertEl.id = 'sh-signal-alert';
        alertEl.className = 'sh-signal-alert';
        target.appendChild(alertEl);
        this.alertEl = alertEl;

        this.el = hud;

        ['sweep','exhaustion','absorption','aggression','vwap','amt'].forEach(k => {
            this.barEls[k] = document.getElementById(`sh-bar-${k}`);
        });

        this._makeDraggable(hud);
    }

    _componentRow(key, label) {
        return `
          <div class="sh-row">
            <span class="sh-row-label">${label}</span>
            <div class="sh-mini-track">
              <div class="sh-mini-fill" id="sh-bar-${key}"></div>
            </div>
          </div>
        `;
    }

    _makeDraggable(el) {
        let ox = 0, oy = 0, startX = 0, startY = 0, dragging = false;
        const header = el.querySelector('.sh-header');
        if (!header) return;
        header.style.cursor = 'grab';
        header.addEventListener('mousedown', e => {
            dragging = true; startX = e.clientX; startY = e.clientY;
            const rect = el.getBoundingClientRect();
            ox = rect.left; oy = rect.top;
            el.style.right = 'auto'; el.style.bottom = 'auto';
            header.style.cursor = 'grabbing'; e.preventDefault();
        });
        window.addEventListener('mousemove', e => {
            if (!dragging) return;
            el.style.left = (ox + e.clientX - startX) + 'px';
            el.style.top  = (oy + e.clientY - startY) + 'px';
        });
        window.addEventListener('mouseup', () => { dragging = false; header.style.cursor = 'grab'; });
    }

    render(state) {
        if (!this.el) return;
        const {
            direction, confidence, compositeScore, trend,
            scores, lastSignalChange, regimeOK, confluence,
            locked, lockRemaining, signalQuality, activeSetup
        } = state;

        // Direction badge
        const badge = document.getElementById('sh-dir-badge');
        if (badge && direction !== this.lastDir) {
            this.lastDir = direction;
            badge.textContent = direction;
            badge.className   = `sh-badge sh-badge-${direction.toLowerCase()}`;
            this.el.classList.remove('sh-flash');
            void this.el.offsetWidth;
            this.el.classList.add('sh-flash');
            clearTimeout(this.flashTimer);
            this.flashTimer = setTimeout(() => this.el.classList.remove('sh-flash'), 800);
            if (direction !== 'NEUTRAL') this._showSignalAlert(direction, activeSetup);
        }

        // Gauge
        const fill = document.getElementById('sh-gauge-fill');
        if (fill) {
            const pct   = Math.abs(compositeScore) * 50;
            const side  = compositeScore >= 0 ? 'right' : 'left';
            const other = compositeScore >= 0 ? 'left'  : 'right';
            fill.style.width      = pct + '%';
            fill.style[side]      = '50%';
            fill.style[other]     = 'auto';
            fill.style.background = compositeScore >= 0
                ? 'linear-gradient(90deg, rgba(0,230,118,0.2), #00e676)'
                : 'linear-gradient(270deg, rgba(255,23,68,0.2), #ff1744)';
        }

        // Confidence bar
        const confBar = document.getElementById('sh-conf-bar');
        const confVal = document.getElementById('sh-conf-value');
        if (confBar) {
            confBar.style.width = Math.min(confidence, 99) + '%';
            confBar.style.background =
                confidence > 65 ? (direction === 'LONG' ? '#00e676' : direction === 'SHORT' ? '#ff1744' : '#ffab00') :
                confidence > 35 ? '#ffab00' : '#4a5270';
        }
        if (confVal) confVal.textContent = confidence + '%';

        // Confluence dots
        const count = confluence?.count || 0;
        const sign  = Math.sign(compositeScore);
        for (let i = 0; i < 5; i++) {
            const dot = document.getElementById(`sh-dot-${i}`);
            if (!dot) continue;
            const lit = i < count;
            dot.style.background = lit ? (sign >= 0 ? '#00e676' : '#ff1744') : 'rgba(255,255,255,0.08)';
            dot.style.boxShadow  = lit ? (sign >= 0 ? '0 0 5px rgba(0,230,118,0.5)' : '0 0 5px rgba(255,23,68,0.5)') : 'none';
        }

        // Regime badge
        const regBadge = document.getElementById('sh-regime-badge');
        if (regBadge) {
            regBadge.textContent = regimeOK ? 'OK' : 'LOW';
            regBadge.style.color = regimeOK ? '#00e676' : '#4a5270';
        }

        // Lock bar
        const lockRow  = document.getElementById('sh-lock-row');
        const lockBar  = document.getElementById('sh-lock-bar');
        const lockTime = document.getElementById('sh-lock-time');
        if (lockRow) {
            lockRow.style.display = locked ? '' : 'none';
            if (locked && lockBar)  lockBar.style.width = (lockRemaining / 60000 * 100) + '%';
            if (locked && lockTime) lockTime.textContent = Math.ceil(lockRemaining / 1000) + 's';
        }

        // Signal quality + setup name
        const qualEl   = document.getElementById('sh-quality-badge');
        const setupEl  = document.getElementById('sh-setup-name');
        if (qualEl) {
            qualEl.textContent = signalQuality || 'C';
            qualEl.style.color =
                signalQuality === 'A' ? '#00e676' :
                signalQuality === 'B' ? '#ffab00' : '#4a5270';
            qualEl.style.borderColor = qualEl.style.color;
        }
        if (setupEl) {
            setupEl.textContent = activeSetup || (direction !== 'NEUTRAL' ? '—' : 'Waiting for setup…');
            setupEl.style.color = direction === 'LONG' ? '#00e676' : direction === 'SHORT' ? '#ff1744' : '#3e4560';
        }

        // Component bars
        for (const [key, score] of Object.entries(scores)) {
            const barEl = this.barEls[key];
            if (!barEl) continue;
            const pct = Math.abs(score) * 100;
            barEl.style.width      = pct + '%';
            barEl.style.left       = score >= 0 ? '50%' : 'auto';
            barEl.style.right      = score <  0 ? '50%' : 'auto';
            barEl.style.background = score >= 0 ? '#00e676' : '#ff1744';
            barEl.style.opacity    = 0.35 + Math.abs(score) * 0.65;
        }

        // Trend
        const trendEl = document.getElementById('sh-trend-val');
        if (trendEl) {
            trendEl.textContent = trend;
            trendEl.className   = `sh-trend-value sh-trend-${trend.toLowerCase()}`;
        }

        // Elapsed time
        const timeEl = document.getElementById('sh-time');
        if (timeEl) {
            const elapsed = Math.round((Date.now() - lastSignalChange) / 1000);
            const h = Math.floor(elapsed / 3600);
            const m = Math.floor((elapsed % 3600) / 60);
            const s = elapsed % 60;
            timeEl.textContent = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
        }
    }

    _showSignalAlert(direction, setupName) {
        if (!this.alertEl) return;
        const isLong = direction === 'LONG';
        const color  = isLong ? '#00e676' : '#ff1744';
        const shadow = isLong ? 'rgba(0,230,118,0.6)' : 'rgba(255,23,68,0.6)';
        const bg     = isLong ? 'rgba(0,230,118,0.08)' : 'rgba(255,23,68,0.08)';

        this.alertEl.innerHTML = `
          <span class="sha-emoji">${isLong ? '▲' : '▼'}</span>
          <span class="sha-label">${direction}</span>
          <span class="sha-sub">${setupName || 'Order Flow Confluence'}</span>
        `;
        this.alertEl.style.borderColor = color;
        this.alertEl.style.background  = bg;
        this.alertEl.style.color       = color;
        this.alertEl.style.textShadow  = `0 0 30px ${shadow}`;
        this.alertEl.style.boxShadow   = `0 0 40px ${shadow}, inset 0 0 40px ${bg}`;
        this.alertEl.classList.remove('sha-show');
        void this.alertEl.offsetWidth;
        this.alertEl.classList.add('sha-show');
        clearTimeout(this._alertTimer);
        this._alertTimer = setTimeout(() => this.alertEl.classList.remove('sha-show'), 3000);
    }
}
