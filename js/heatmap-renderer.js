// ============================================================
// Heatmap Renderer — Main Canvas (Center Panel)
// ============================================================

class HeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.width = 0;
        this.height = 0;
        this.imageData = null;
        this.pixels = null;

        // ── View State ─────────────────────────────────────
        this.zoomY = 1.0;          // vertical zoom
        this.panY = 0;             // vertical pan offset (in pixels)
        this.zoomX = 1.0;          // horizontal zoom (time compression)
        this.mouseX = -1;
        this.mouseY = -1;
        this.showCrosshair = false;

        // ── Cached values ──────────────────────────────────
        this._lut = CONFIG.COLORS._HEATMAP_LUT;
    }

    resize(width, height) {
        this.width = width;
        this.height = height;
        this.canvas.width = width;
        this.canvas.height = height;
        this.imageData = this.ctx.createImageData(width, height);
        this.pixels = this.imageData.data;
    }

    render(orderBook, tradeFlow) {
        if (!this.width || !this.height || !orderBook.midPrice) return;

        const { width, height, ctx, pixels } = this;
        const lut = this._lut;

        // Clear to background
        const bgR = 10, bgG = 10, bgB = 20;
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = bgR;
            pixels[i + 1] = bgG;
            pixels[i + 2] = bgB;
            pixels[i + 3] = 255;
        }

        // ── Get visible columns ────────────────────────────
        const colWidth = this.zoomX;
        const visibleCols = Math.floor(width / colWidth);
        const columns = orderBook.getColumns(visibleCols, Math.floor(this.panOffset || 0));
        if (columns.length === 0) return;

        // ── Determine price range ──────────────────────────
        const tickSize = orderBook.tickSize;
        const levelsVisible = Math.floor((height / (this.zoomY * 3)) / 2);
        const currentMid = orderBook.midPrice;
        const priceTop = currentMid + levelsVisible * tickSize + this.panY * tickSize;
        const priceBottom = currentMid - levelsVisible * tickSize + this.panY * tickSize;
        const priceRange = priceTop - priceBottom;
        const pixelsPerPrice = height / priceRange;

        // ── Render heatmap columns ─────────────────────────
        const maxQty = orderBook.maxQty;

        for (let c = 0; c < columns.length; c++) {
            const col = columns[c];
            if (!col) continue;

            const x = width - (columns.length - c) * colWidth;
            if (x + colWidth < 0) continue;
            if (x >= width) break;

            for (const [price, { qty }] of col.data) {
                if (price < priceBottom || price > priceTop) continue;

                const y = Math.floor((priceTop - price) / priceRange * height);
                const cellHeight = Math.max(1, Math.ceil(pixelsPerPrice * tickSize));

                // Normalize quantity → 0..255 index (use root curve to boost visibility of dense levels)
                const ratio = Math.pow(Math.min(1, qty / maxQty), CONFIG.HEATMAP.INTENSITY_CURVE || 0.6);
                const intensity = Math.min(255, Math.floor(ratio * 255));
                const lutIdx = intensity * 4;
                const r = lut[lutIdx];
                const g = lut[lutIdx + 1];
                const b = lut[lutIdx + 2];

                // Draw rectangle
                const xStart = Math.max(0, Math.floor(x));
                const xEnd = Math.min(width, Math.max(xStart + 1, Math.ceil(x + colWidth)));
                const yStart = Math.max(0, Math.floor(y));
                const yEnd = Math.min(height, y + cellHeight);

                for (let py = yStart; py < yEnd; py++) {
                    for (let px = xStart; px < xEnd; px++) {
                        const idx = (py * width + px) * 4;
                        pixels[idx] = r;
                        pixels[idx + 1] = g;
                        pixels[idx + 2] = b;
                    }
                }
            }
        }

        // ── Put pixel data ─────────────────────────────────
        ctx.putImageData(this.imageData, 0, 0);

        // ── Draw price line ────────────────────────────────
        if (orderBook.midPrice >= priceBottom && orderBook.midPrice <= priceTop) {
            const priceY = (priceTop - orderBook.midPrice) / priceRange * height;
            
            // Glow effect
            ctx.save();
            ctx.shadowColor = CONFIG.COLORS.PRICE_LINE_GLOW;
            ctx.shadowBlur = 8;
            ctx.strokeStyle = CONFIG.COLORS.PRICE_LINE;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 3]);
            ctx.beginPath();
            ctx.moveTo(0, priceY);
            ctx.lineTo(width, priceY);
            ctx.stroke();
            ctx.restore();

            // Price label on right
            const priceText = orderBook.midPrice.toFixed(this._getPriceDecimals(orderBook.midPrice));
            ctx.font = `bold ${CONFIG.UI.FONT_SIZE}px ${CONFIG.UI.FONT_FAMILY}`;
            const textW = ctx.measureText(priceText).width + 12;
            ctx.fillStyle = CONFIG.COLORS.PRICE_LINE;
            ctx.fillRect(width - textW, priceY - 9, textW, 18);
            ctx.fillStyle = '#000';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(priceText, width - 6, priceY);
        }

        // ── Draw historical best bid/ask lines ─────────────
        this._drawHistoricalPriceLines(ctx, priceTop, priceRange, width, height, columns);

        // ── Draw overlays ──────────────────────────────────
        if (orderBook.valueArea && orderBook.valueArea.poc) {
            this._drawGlobalPOC(ctx, priceTop, priceRange, width, height, orderBook.valueArea.poc);
        }

        if (orderBook.spoofEvents) {
            this._drawSpoofing(ctx, priceTop, priceRange, width, height, columns, orderBook);
        }

        if (tradeFlow) {
            this._drawVWAP(ctx, priceTop, priceRange, width, height, tradeFlow);
            this._drawCVD(ctx, width, height, columns, tradeFlow);
            this._drawBubbles(ctx, orderBook, priceTop, priceRange, width, height, columns);
            this._drawLiquidations(ctx, priceTop, priceRange, width, height, columns, tradeFlow);
            this._drawAbsorptions(ctx, priceTop, priceRange, width, height, columns, tradeFlow);
            this._drawDivergences(ctx, priceTop, priceRange, width, height, columns, tradeFlow);
        }

        // ── Micro OFI Bar ──────────────────────────────────
        if (orderBook.midPrice >= priceBottom && orderBook.midPrice <= priceTop) {
            const priceY = (priceTop - orderBook.midPrice) / priceRange * height;
            this._drawOFIBar(ctx, priceY, width, orderBook);
        }

        // ── Grid lines ─────────────────────────────────────
        this._drawGrid(ctx, priceTop, priceBottom, priceRange, tickSize, width, height);

        // ── Crosshair ──────────────────────────────────────
        if (this.showCrosshair && this.mouseX >= 0 && this.mouseY >= 0) {
            this._drawCrosshair(ctx, priceTop, priceRange, orderBook, width, height);
        }

        // Store for external use
        this._lastPriceTop = priceTop;
        this._lastPriceBottom = priceBottom;
        this._lastPriceRange = priceRange;
    }

    _drawPriceLine(ctx, price, priceTop, priceRange, w, h, color, label) {
        if (!price || price < (priceTop - priceRange) || price > priceTop) return;
        const y = (priceTop - price) / priceRange * h;
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    _drawHistoricalPriceLines(ctx, priceTop, priceRange, w, h, columns) {
        if (columns.length < 2) return;

        const colWidth = this.zoomX;
        const newestTime = columns[columns.length - 1].time;
        const oldestTime = columns[0].time;
        const timeSpan = newestTime - oldestTime || 1;

        ctx.save();
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.6; // slightly transparent so heatmap remains visible

        // ── Best Bid Line (Green) ──
        ctx.strokeStyle = CONFIG.COLORS.BID;
        ctx.beginPath();
        let firstBid = true;
        for (let i = 0; i < columns.length; i++) {
            const col = columns[i];
            if (!col || !col.bestBid) continue;
            
            const timeRatio = (col.time - oldestTime) / timeSpan;
            const x = timeRatio * (w - colWidth);
            const y = (priceTop - col.bestBid) / priceRange * h;
            
            if (firstBid) {
                ctx.moveTo(x, y);
                firstBid = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // ── Best Ask Line (Red) ──
        ctx.strokeStyle = CONFIG.COLORS.ASK;
        ctx.beginPath();
        let firstAsk = true;
        for (let i = 0; i < columns.length; i++) {
            const col = columns[i];
            if (!col || !col.bestAsk) continue;
            
            const timeRatio = (col.time - oldestTime) / timeSpan;
            const x = timeRatio * (w - colWidth);
            const y = (priceTop - col.bestAsk) / priceRange * h;
            
            if (firstAsk) {
                ctx.moveTo(x, y);
                firstAsk = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    _drawBubbles(ctx, orderBook, priceTop, priceRange, w, h, columns) {
        if (!window._tradeFlow) return;
        const bubbles = window._tradeFlow.activeBubbles;
        if (bubbles.length === 0 || columns.length === 0) return;

        // Calculate time→X mapping from the heatmap columns
        const colWidth = this.zoomX;
        const newestTime = columns[columns.length - 1].time;
        const oldestTime = columns[0].time;
        const timeSpan = newestTime - oldestTime || 1;

        // Batch: set font once for whale labels
        ctx.save();
        ctx.font = `bold ${CONFIG.UI.FONT_SIZE_SMALL}px ${CONFIG.UI.FONT_FAMILY}`;

        for (const bubble of bubbles) {
            // ── Y position: price ──────────────────────────
            if (bubble.price < (priceTop - priceRange) || bubble.price > priceTop) continue;
            const y = (priceTop - bubble.price) / priceRange * h;

            // ── X position: timestamp aligned with heatmap scroll ──
            const timeRatio = (bubble.timestamp - oldestTime) / timeSpan;
            const x = timeRatio * (w - colWidth);
            if (x < -40 || x > w + 40) continue;

            // ── Size based on USD value ────────────────────
            const size = Math.min(CONFIG.BUBBLES.MAX_SIZE,
                CONFIG.BUBBLES.MIN_SIZE + Math.sqrt(bubble.usdValue / 10000) * 3);

            const colorOuter = bubble.isBuy ? CONFIG.COLORS.BUBBLE_BUY : CONFIG.COLORS.BUBBLE_SELL;
            const colorInner = bubble.isBuy ? CONFIG.COLORS.BID : CONFIG.COLORS.ASK;

            // ── Glow via radial gradient (much faster than shadowBlur) ──
            const glowR = size * 2;
            const grad = ctx.createRadialGradient(x, y, size * 0.2, x, y, glowR);
            grad.addColorStop(0, colorOuter);
            grad.addColorStop(0.45, colorOuter);
            grad.addColorStop(1, 'rgba(0,0,0,0)');

            ctx.globalAlpha = 0.55;
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, glowR, 0, Math.PI * 2);
            ctx.fill();

            // ── Solid core circle ──────────────────────────
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = colorOuter;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();

            // ── Bright center dot ──────────────────────────
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = colorInner;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(1.5, size * 0.3), 0, Math.PI * 2);
            ctx.fill();

            // ── Label for whale trades ─────────────────────
            if (bubble.usdValue >= CONFIG.ORDER_FLOW.WHALE_THRESHOLD_USD) {
                ctx.globalAlpha = 0.95;
                ctx.fillStyle = colorInner;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                const label = `$${(bubble.usdValue / 1000).toFixed(0)}K`;
                ctx.fillText(label, x, y - size - 3);
            }
        }

        ctx.restore();
    }

    _drawLiquidations(ctx, priceTop, priceRange, w, h, columns, tradeFlow) {
        if (!tradeFlow.liquidations || tradeFlow.liquidations.length === 0) return;
        
        const colWidth = this.zoomX;
        const timeSpan = columns.length * CONFIG.HEATMAP.COLUMN_INTERVAL_MS;
        const oldestTime = columns[columns.length - 1].time;
        const newestTime = columns[0].time;

        for (const liq of tradeFlow.liquidations) {
            if (liq.timestamp < oldestTime || liq.timestamp > newestTime) continue;
            if (liq.price < (priceTop - priceRange) || liq.price > priceTop) continue;

            const timeRatio = (liq.timestamp - oldestTime) / timeSpan;
            const x = timeRatio * (w - colWidth);
            const y = (priceTop - liq.price) / priceRange * h;

            // Pulse animation based on animationStart
            const elapsed = performance.now() - (liq.animationStart || liq.timestamp);
            let radius = Math.min(25, 6 + Math.sqrt(liq.usdValue) / 50);
            
            if (elapsed < 500) {
                radius += (500 - elapsed) / 20; // Explosion pulse effect
            }

            ctx.save();
            ctx.strokeStyle = liq.isLongLiquidation ? '#ff1744' : '#00e676';
            ctx.lineWidth = 2;
            ctx.shadowColor = ctx.strokeStyle;
            ctx.shadowBlur = 10;
            
            // Draw Target/Cross
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(x, y, radius * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = liq.isLongLiquidation ? 'rgba(255,23,68,0.7)' : 'rgba(0,230,118,0.7)';
            ctx.fill();
            
            // X mark
            ctx.beginPath();
            ctx.moveTo(x - radius * 0.7, y - radius * 0.7);
            ctx.lineTo(x + radius * 0.7, y + radius * 0.7);
            ctx.moveTo(x + radius * 0.7, y - radius * 0.7);
            ctx.lineTo(x - radius * 0.7, y + radius * 0.7);
            ctx.stroke();

            // Rekt value label
            if (liq.usdValue >= 10000) {
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.font = `bold ${CONFIG.UI.FONT_SIZE_SMALL}px ${CONFIG.UI.FONT_FAMILY}`;
                ctx.fillText(`$${(liq.usdValue / 1000).toFixed(0)}K`, x, y - radius - 2);
            }
            ctx.restore();
        }
    }

    _drawCVD(ctx, w, h, columns, tradeFlow) {
        if (!tradeFlow.cumulativeDeltaHistory || tradeFlow.cumulativeDeltaHistory.length < 2) return;
        
        const colWidth = this.zoomX;
        const timeSpan = columns.length * CONFIG.HEATMAP.COLUMN_INTERVAL_MS;
        const oldestTime = columns[columns.length - 1].time;
        const newestTime = columns[0].time;
        
        const history = tradeFlow.cumulativeDeltaHistory.filter(d => d.time >= oldestTime && d.time <= newestTime);
        if (history.length < 2) return;
        
        // Find min/max delta in this window
        let minCvd = history[0].delta;
        let maxCvd = history[0].delta;
        for (const d of history) {
            if (d.delta < minCvd) minCvd = d.delta;
            if (d.delta > maxCvd) maxCvd = d.delta;
        }
        
        const cvdRange = maxCvd - minCvd;
        if (cvdRange === 0) return;
        
        const cvdHeight = h * 0.25; // Use bottom 25% of the screen
        const bottomOffset = h;
        
        ctx.save();
        ctx.beginPath();
        
        let first = true;
        for (const d of history) {
            const timeRatio = (d.time - oldestTime) / timeSpan;
            const x = timeRatio * (w - colWidth);
            
            // Normalize CVD to Y scale
            const normalizedY = (maxCvd - d.delta) / cvdRange * cvdHeight;
            const y = bottomOffset - cvdHeight + normalizedY - 30; // 30px padding from bottom
            
            if (first) {
                ctx.moveTo(x, y);
                first = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)'; // Cyan
        ctx.shadowColor = 'rgba(0, 229, 255, 0.5)';
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.restore();
    }

    _drawGrid(ctx, priceTop, priceBottom, priceRange, tickSize, w, h) {
        // ── Horizontal grid (price levels) ─────────────────
        const gridStep = this._calcGridStep(priceRange, h, tickSize);
        const startPrice = Math.ceil(priceBottom / gridStep) * gridStep;

        ctx.font = `${CONFIG.UI.FONT_SIZE_SMALL}px ${CONFIG.UI.FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        for (let p = startPrice; p <= priceTop; p += gridStep) {
            const y = (priceTop - p) / priceRange * h;
            ctx.strokeStyle = CONFIG.COLORS.GRID;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();

            // Price label
            ctx.fillStyle = CONFIG.COLORS.TEXT;
            const decimals = this._getPriceDecimals(p);
            ctx.fillText(p.toFixed(decimals), 4, y - 2);
        }

        // ── Time labels at bottom ──────────────────────────
        // (minimal - just show relative time)
        ctx.fillStyle = CONFIG.COLORS.TEXT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const intervals = [0, 60, 120, 180, 240, 300];
        for (const sec of intervals) {
            const x = w - (sec / 0.1 * this.zoomX);
            if (x < 40 || x > w - 10) continue;
            const label = sec === 0 ? 'Now' : `-${sec}s`;
            ctx.fillText(label, x, h - 3);
        }
    }

    _drawCrosshair(ctx, priceTop, priceRange, orderBook, w, h) {
        const mx = this.mouseX;
        const my = this.mouseY;

        // Crosshair lines
        ctx.strokeStyle = CONFIG.COLORS.CROSSHAIR;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(mx, 0);
        ctx.lineTo(mx, h);
        ctx.moveTo(0, my);
        ctx.lineTo(w, my);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price label
        const price = priceTop - (my / h) * priceRange;
        const decimals = this._getPriceDecimals(price);
        const priceText = price.toFixed(decimals);
        ctx.font = `${CONFIG.UI.FONT_SIZE}px ${CONFIG.UI.FONT_FAMILY}`;
        const tw = ctx.measureText(priceText).width + 10;

        ctx.fillStyle = CONFIG.COLORS.CROSSHAIR_LABEL_BG;
        ctx.fillRect(0, my - 10, tw, 20);
        ctx.fillStyle = CONFIG.COLORS.TEXT_BRIGHT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(priceText, 5, my);
    }

    _drawOFIBar(ctx, priceY, w, orderBook) {
        const bidVol = orderBook.bestBidVolume || 0;
        const askVol = orderBook.bestAskVolume || 0;
        const totalVol = bidVol + askVol;
        if (totalVol === 0) return;

        const maxBarWidth = 70;
        const bidRatio = bidVol / totalVol;
        const askRatio = askVol / totalVol;

        const bidWidth = maxBarWidth * bidRatio;
        const askWidth = maxBarWidth * askRatio;

        // Position it right next to the price label which is at w - textW
        const startX = w - 100 - maxBarWidth;

        // Draw background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(startX, priceY - 2, maxBarWidth, 4);

        // Draw Bid bar (green)
        ctx.fillStyle = CONFIG.COLORS.BID;
        ctx.fillRect(startX, priceY - 2, bidWidth, 4);

        // Draw Ask bar (red)
        ctx.fillStyle = CONFIG.COLORS.ASK;
        ctx.fillRect(startX + bidWidth, priceY - 2, askWidth, 4);
    }

    _drawSpoofing(ctx, priceTop, priceRange, w, h, columns, orderBook) {
        if (!orderBook.spoofEvents || orderBook.spoofEvents.length === 0 || columns.length === 0) return;

        const colWidth = this.zoomX;
        const newestTime = columns[columns.length - 1].time;
        const oldestTime = columns[0].time;
        const timeSpan = newestTime - oldestTime || 1;

        ctx.save();
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.setLineDash([8, 12]); // Dashed "ghost" stroke

        for (const spoof of orderBook.spoofEvents) {
            if (spoof.price < (priceTop - priceRange) || spoof.price > priceTop) continue;

            const timeRatio = (spoof.timestamp - oldestTime) / timeSpan;
            const x = timeRatio * (w - colWidth);
            const y = (priceTop - spoof.price) / priceRange * h;

            // Ghost stroke fading out
            const gradient = ctx.createLinearGradient(x, y, x + 80, y);
            if (spoof.isBid) {
                gradient.addColorStop(0, 'rgba(0, 230, 118, 0.8)');
                gradient.addColorStop(1, 'rgba(0, 230, 118, 0)');
            } else {
                gradient.addColorStop(0, 'rgba(255, 23, 68, 0.8)');
                gradient.addColorStop(1, 'rgba(255, 23, 68, 0)');
            }

            ctx.strokeStyle = gradient;
            ctx.shadowColor = spoof.isBid ? 'rgba(0,230,118,0.5)' : 'rgba(255,23,68,0.5)';
            ctx.shadowBlur = 6;

            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 80, y);
            ctx.stroke();

            // Emoji
            ctx.font = `12px Arial`;
            ctx.globalAlpha = 0.8;
            ctx.fillText('👻', x + 5, y - 5);
            ctx.globalAlpha = 1.0;
        }
        ctx.restore();
    }

    _drawAbsorptions(ctx, priceTop, priceRange, w, h, columns, tradeFlow) {
        if (!tradeFlow.absorptions || tradeFlow.absorptions.length === 0 || columns.length === 0) return;

        const colWidth = this.zoomX;
        const newestTime = columns[columns.length - 1].time;
        const oldestTime = columns[0].time;
        const timeSpan = newestTime - oldestTime || 1;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const abs of tradeFlow.absorptions) {
            if (abs.price < (priceTop - priceRange) || abs.price > priceTop) continue;

            const timeRatio = (abs.timestamp - oldestTime) / timeSpan;
            const x = timeRatio * (w - colWidth);
            const y = (priceTop - abs.price) / priceRange * h;

            // Pulsing effect
            const elapsed = performance.now() - abs.timestamp;
            const scale = 1 + Math.sin(elapsed * 0.005) * 0.2; // slight pulse
            const fontSize = Math.max(16, Math.min(32, 16 + (abs.usdValue / 200000) * 4));

            ctx.font = `${fontSize * scale}px Arial`;
            
            // Draw Shield
            ctx.shadowColor = abs.isBuy ? 'rgba(255,23,68,0.8)' : 'rgba(0,230,118,0.8)';
            ctx.shadowBlur = 15;
            ctx.fillText('🛡️', x, y);
        }
        ctx.restore();
    }

    _drawDivergences(ctx, priceTop, priceRange, w, h, columns, tradeFlow) {
        if (!tradeFlow.divergences || tradeFlow.divergences.length === 0 || columns.length === 0) return;

        const colWidth = this.zoomX;
        const newestTime = columns[columns.length - 1].time;
        const oldestTime = columns[0].time;
        const timeSpan = newestTime - oldestTime || 1;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const div of tradeFlow.divergences) {
            if (div.price < (priceTop - priceRange) || div.price > priceTop) continue;

            const timeRatio = (div.timestamp - oldestTime) / timeSpan;
            const x = timeRatio * (w - colWidth);
            const y = (priceTop - div.price) / priceRange * h;

            const isBear = div.type === 'bear'; // Bear div = Price up, CVD down = sell signal
            
            ctx.font = `bold 12px ${CONFIG.UI.FONT_FAMILY}`;
            
            // Badge Background
            ctx.fillStyle = isBear ? 'rgba(255, 23, 68, 0.8)' : 'rgba(0, 230, 118, 0.8)';
            ctx.shadowColor = ctx.fillStyle;
            ctx.shadowBlur = 10;
            ctx.fillRect(x - 40, y - 25, 80, 18);
            
            // Text
            ctx.fillStyle = '#fff';
            ctx.shadowBlur = 0;
            const text = window.i18n ? window.i18n.t('canvasReversal') : '⚠️ REVERSAL';
            ctx.fillText(text, x, y - 16);
        }
        ctx.restore();
    }

    _drawGlobalPOC(ctx, priceTop, priceRange, w, h, poc) {
        if (poc < (priceTop - priceRange) || poc > priceTop) return;
        
        const y = (priceTop - poc) / priceRange * h;
        
        ctx.save();
        ctx.strokeStyle = CONFIG.COLORS.VP_POC; // High-viz yellow/gold
        ctx.lineWidth = 2;
        ctx.shadowColor = CONFIG.COLORS.VP_POC;
        ctx.shadowBlur = 12;
        
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();

        // POC Label
        ctx.font = `bold 12px ${CONFIG.UI.FONT_FAMILY}`;
        ctx.fillStyle = '#000';
        ctx.fillRect(5, y - 9, 36, 18);
        ctx.fillStyle = CONFIG.COLORS.VP_POC;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const text = window.i18n ? window.i18n.t('canvasPoc') : 'POC';
        ctx.fillText(text, 8, y);
        ctx.restore();
    }

    _drawVWAP(ctx, priceTop, priceRange, w, h, tradeFlow) {
        if (!tradeFlow || !tradeFlow.vwap || tradeFlow.vwapVolume === 0) return;
        
        const vwap = tradeFlow.vwap;
        const sd = tradeFlow.vwapStdDev;
        
        const drawBand = (price, color, isDashed, lineWidth = 1) => {
            if (price < (priceTop - priceRange) || price > priceTop) return;
            const y = (priceTop - price) / priceRange * h;
            
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            if (isDashed) {
                ctx.setLineDash([5, 5]);
            } else {
                ctx.setLineDash([]);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        };

        ctx.save();
        ctx.shadowColor = 'rgba(68, 138, 255, 0.8)';
        ctx.shadowBlur = 8;
        
        // VWAP Center Line
        drawBand(vwap, 'rgba(68, 138, 255, 0.9)', false, 2);
        
        // +/- 1 Standard Deviation
        ctx.shadowBlur = 4;
        drawBand(vwap + sd, 'rgba(68, 138, 255, 0.5)', true, 1);
        drawBand(vwap - sd, 'rgba(68, 138, 255, 0.5)', true, 1);
        
        // +/- 2 Standard Deviation
        drawBand(vwap + 2*sd, 'rgba(68, 138, 255, 0.2)', true, 1);
        drawBand(vwap - 2*sd, 'rgba(68, 138, 255, 0.2)', true, 1);
        
        ctx.restore();
    }

    _calcGridStep(priceRange, h, tickSize) {
        const minPixelsBetween = 50;
        const levelsInView = priceRange / tickSize;
        const pixelsPerLevel = h / levelsInView;
        let step = tickSize;
        const multipliers = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
        for (const m of multipliers) {
            step = tickSize * m;
            if ((step / priceRange) * h >= minPixelsBetween) break;
        }
        return step;
    }

    _getPriceDecimals(price) {
        if (price >= 10000) return 1;
        if (price >= 100) return 2;
        if (price >= 1) return 3;
        return 4;
    }

    // ── Mouse / interaction ────────────────────────────────
    setMouse(x, y) {
        this.mouseX = x;
        this.mouseY = y;
    }

    getPriceAtY(y) {
        if (!this._lastPriceTop || !this._lastPriceRange) return 0;
        return this._lastPriceTop - (y / this.height) * this._lastPriceRange;
    }
}
