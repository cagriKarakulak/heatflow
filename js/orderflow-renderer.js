// ============================================================
// Order Flow Renderer — Left Panel
// ============================================================

class OrderFlowRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0;
        this.height = 0;
    }

    resize(width, height) {
        this.width = width;
        this.height = height;
        this.canvas.width = width;
        this.canvas.height = height;
    }

    render(tradeFlow) {
        if (!this.width || !this.height) return;

        const { ctx, width, height } = this;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = 'rgba(10, 10, 20, 0.7)';
        ctx.fillRect(0, 0, width, height);

        // Separator
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(width - 1, 0);
        ctx.lineTo(width - 1, height);
        ctx.stroke();

        // ── Header ─────────────────────────────────────────
        ctx.font = `bold ${CONFIG.UI.FONT_SIZE_SMALL}px ${CONFIG.UI.FONT_FAMILY}`;
        ctx.fillStyle = CONFIG.COLORS.TEXT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('ORDER FLOW', width / 2, 4);

        // ── Delta Bars ─────────────────────────────────────
        const buckets = tradeFlow.getBuckets(Math.floor((height - 60) / 6));
        if (buckets.length === 0) return;

        const barAreaTop = 22;
        const barAreaHeight = height * 0.45;
        const barHeight = Math.max(2, Math.floor(barAreaHeight / buckets.length) - 1);
        const midX = width / 2;
        const maxBarWidth = (width - 20) / 2;
        const maxDelta = tradeFlow.maxDelta || 1;

        for (let i = 0; i < buckets.length; i++) {
            const bucket = buckets[i];
            const y = barAreaTop + i * (barHeight + 1);
            const delta = bucket.delta;
            const absNorm = Math.min(1, Math.abs(delta) / maxDelta);
            const barW = absNorm * maxBarWidth;

            if (delta >= 0) {
                // Buy pressure → green bar to the right
                const gradient = ctx.createLinearGradient(midX, 0, midX + barW, 0);
                gradient.addColorStop(0, 'rgba(0,230,118,0.2)');
                gradient.addColorStop(1, CONFIG.COLORS.OF_DELTA_POS);
                ctx.fillStyle = gradient;
                ctx.fillRect(midX, y, barW, barHeight);
            } else {
                // Sell pressure → red bar to the left
                const gradient = ctx.createLinearGradient(midX - barW, 0, midX, 0);
                gradient.addColorStop(0, CONFIG.COLORS.OF_DELTA_NEG);
                gradient.addColorStop(1, 'rgba(255,23,68,0.2)');
                ctx.fillStyle = gradient;
                ctx.fillRect(midX - barW, y, barW, barHeight);
            }
        }

        // Center line
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(midX, barAreaTop);
        ctx.lineTo(midX, barAreaTop + barAreaHeight);
        ctx.stroke();

        // ── Cumulative Delta Chart ─────────────────────────
        const cdTop = barAreaTop + barAreaHeight + 20;
        const cdHeight = height - cdTop - 50;

        if (cdHeight > 30 && tradeFlow.cumulativeDeltaHistory.length > 1) {
            ctx.font = `bold ${CONFIG.UI.FONT_SIZE_SMALL}px ${CONFIG.UI.FONT_FAMILY}`;
            ctx.fillStyle = CONFIG.COLORS.TEXT;
            ctx.textAlign = 'center';
            ctx.fillText('CUM. DELTA', width / 2, cdTop - 4);

            const history = tradeFlow.cumulativeDeltaHistory;
            const maxAbs = tradeFlow.maxCumDelta || 1;
            const len = Math.min(history.length, width - 10);
            const step = Math.max(1, Math.floor(history.length / len));
            const midY = cdTop + cdHeight / 2;

            // Zero line
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.beginPath();
            ctx.moveTo(5, midY);
            ctx.lineTo(width - 5, midY);
            ctx.stroke();

            // Delta line
            ctx.beginPath();
            let first = true;
            for (let i = 0; i < history.length; i += step) {
                const x = 5 + ((i / history.length) * (width - 10));
                const val = history[i].delta;
                const y = midY - (val / maxAbs) * (cdHeight / 2) * 0.9;
                if (first) { ctx.moveTo(x, y); first = false; }
                else ctx.lineTo(x, y);
            }

            // Color based on current delta
            const currentDelta = tradeFlow.cumulativeDelta;
            ctx.strokeStyle = currentDelta >= 0 ? CONFIG.COLORS.OF_BUY : CONFIG.COLORS.OF_SELL;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Fill area under/over
            if (history.length > 0) {
                const lastX = width - 5;
                ctx.lineTo(lastX, midY);
                ctx.lineTo(5, midY);
                ctx.closePath();
                ctx.fillStyle = currentDelta >= 0 ? 'rgba(0,230,118,0.08)' : 'rgba(255,23,68,0.08)';
                ctx.fill();
            }

            // Current value label
            ctx.font = `bold ${CONFIG.UI.FONT_SIZE}px ${CONFIG.UI.FONT_FAMILY}`;
            ctx.fillStyle = currentDelta >= 0 ? CONFIG.COLORS.OF_BUY : CONFIG.COLORS.OF_SELL;
            ctx.textAlign = 'center';
            ctx.fillText(this._formatQty(currentDelta), width / 2, cdTop + cdHeight + 4);
        }

        // ── Buy/Sell Summary Bar ───────────────────────────
        const summaryY = height - 22;
        const totalBuy = tradeFlow.totalBuyVol;
        const totalSell = tradeFlow.totalSellVol;
        const totalVol = totalBuy + totalSell;

        if (totalVol > 0) {
            const buyRatio = totalBuy / totalVol;
            const barW = width - 8;

            ctx.fillStyle = 'rgba(20,20,40,0.8)';
            ctx.fillRect(4, summaryY, barW, 14);

            ctx.fillStyle = CONFIG.COLORS.OF_BUY;
            ctx.fillRect(4, summaryY, barW * buyRatio, 14);

            ctx.fillStyle = CONFIG.COLORS.OF_SELL;
            ctx.fillRect(4 + barW * buyRatio, summaryY, barW * (1 - buyRatio), 14);

            ctx.font = `bold ${CONFIG.UI.FONT_SIZE_SMALL}px ${CONFIG.UI.FONT_FAMILY}`;
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`B:${(buyRatio * 100).toFixed(0)}% S:${((1 - buyRatio) * 100).toFixed(0)}%`, width / 2, summaryY + 7);
        }
    }

    _formatQty(qty) {
        const abs = Math.abs(qty);
        const sign = qty >= 0 ? '+' : '-';
        if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
        if (abs >= 1) return `${sign}${abs.toFixed(2)}`;
        return `${sign}${abs.toFixed(4)}`;
    }
}
