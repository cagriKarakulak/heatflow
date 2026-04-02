// ============================================================
// Volume Profile Renderer — Right Panel
// ============================================================

class VolumeProfileRenderer {
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

    render(orderBook, heatmapRenderer) {
        if (!this.width || !this.height || !orderBook.midPrice) return;

        const { ctx, width, height } = this;
        const priceTop = heatmapRenderer._lastPriceTop;
        const priceRange = heatmapRenderer._lastPriceRange;
        if (!priceTop || !priceRange) return;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Draw background
        ctx.fillStyle = 'rgba(10, 10, 20, 0.7)';
        ctx.fillRect(0, 0, width, height);

        // Draw separator line
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, height);
        ctx.stroke();

        // Get volume profile data
        const tickSize = orderBook.tickSize;
        const priceBottom = priceTop - priceRange;

        // Aggregate: use the built volume profile
        const maxBarWidth = width - 20;
        const maxQty = orderBook.vpMaxQty || 1;
        const { poc, vah, val } = orderBook.valueArea;

        const barGap = CONFIG.VOLUME_PROFILE.BAR_GAP;
        const pixelsPerPrice = height / priceRange;
        const barHeight = Math.max(1, Math.floor(pixelsPerPrice * tickSize) - barGap);

        // ── Draw bars ──────
        for (const [price, v] of orderBook.volumeProfile) {
            if (price < priceBottom || price > priceTop) continue;
            const y = Math.floor((priceTop - price) / priceRange * height);
            
            // Check if inside value area
            const inVA = price >= val && price <= vah;
            
            const bidW = (v.bid / maxQty) * maxBarWidth;
            const askW = (v.ask / maxQty) * maxBarWidth;

            // Draw Bid part (Green)
            if (bidW > 0) {
                const gradBid = ctx.createLinearGradient(0, 0, bidW, 0);
                gradBid.addColorStop(0, inVA ? 'rgba(0,230,118,0.2)' : 'rgba(0,230,118,0.05)');
                gradBid.addColorStop(1, inVA ? CONFIG.COLORS.VP_BID : 'rgba(0,230,118,0.3)');
                ctx.fillStyle = gradBid;
                ctx.fillRect(4, y, bidW, barHeight);
            }

            // Draw Ask part (Red) appended to Bid part
            if (askW > 0) {
                const gradAsk = ctx.createLinearGradient(0, 0, askW, 0);
                gradAsk.addColorStop(0, inVA ? 'rgba(255,23,68,0.2)' : 'rgba(255,23,68,0.05)');
                gradAsk.addColorStop(1, inVA ? CONFIG.COLORS.VP_ASK : 'rgba(255,23,68,0.3)');
                ctx.fillStyle = gradAsk;
                ctx.fillRect(4 + bidW, y, askW, barHeight);
            }
        }

        // ── Value Area Brackets ───────────
        if (vah >= priceBottom && vah <= priceTop) {
            const vahY = (priceTop - vah) / priceRange * height;
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.setLineDash([2, 4]);
            ctx.strokeRect(0, vahY, width, 1);
        }
        if (val >= priceBottom && val <= priceTop) {
            const valY = (priceTop - val) / priceRange * height;
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.setLineDash([2, 4]);
            ctx.strokeRect(0, valY, width, 1);
        }

        // ── POC (Point of Control) ───────────
        if (poc >= priceBottom && poc <= priceTop) {
            const pocY = (priceTop - poc) / priceRange * height;
            ctx.strokeStyle = CONFIG.COLORS.VP_POC;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 2]);
            ctx.beginPath();
            ctx.moveTo(0, pocY);
            ctx.lineTo(width, pocY);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.font = `bold ${CONFIG.UI.FONT_SIZE_SMALL}px ${CONFIG.UI.FONT_FAMILY}`;
            ctx.fillStyle = CONFIG.COLORS.VP_POC;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            const text = window.i18n ? window.i18n.t('canvasPoc') : 'POC';
            ctx.fillText(text, width - 4, pocY - 2);
        }

        // ── Header ─────────────────────────────────────────
        ctx.font = `bold ${CONFIG.UI.FONT_SIZE_SMALL}px ${CONFIG.UI.FONT_FAMILY}`;
        ctx.fillStyle = CONFIG.COLORS.TEXT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const headerText = window.i18n ? window.i18n.t('canvasVolProfile') : 'VOLUME PROFILE';
        ctx.fillText(headerText, width / 2, 4);

        // ── Depth ratio bar ────────────────────────────────
        const totalBid = orderBook.totalBidDepth;
        const totalAsk = orderBook.totalAskDepth;
        const total = totalBid + totalAsk;
        if (total > 0) {
            const bidRatio = totalBid / total;
            const barY = height - 18;
            const barW = width - 8;

            ctx.fillStyle = 'rgba(20,20,40,0.8)';
            ctx.fillRect(4, barY, barW, 14);

            // Bid portion
            ctx.fillStyle = CONFIG.COLORS.VP_BID;
            ctx.fillRect(4, barY, barW * bidRatio, 14);

            // Ask portion
            ctx.fillStyle = CONFIG.COLORS.VP_ASK;
            ctx.fillRect(4 + barW * bidRatio, barY, barW * (1 - bidRatio), 14);

            // Text
            ctx.font = `bold ${CONFIG.UI.FONT_SIZE_SMALL}px ${CONFIG.UI.FONT_FAMILY}`;
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${(bidRatio * 100).toFixed(0)}% / ${((1 - bidRatio) * 100).toFixed(0)}%`, width / 2, barY + 7);
        }
    }
}
