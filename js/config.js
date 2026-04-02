// ============================================================
// Bookmap Configuration
// ============================================================

const CONFIG = {
    // ── WebSocket ──────────────────────────────────────────
    WS_BASE_URL: 'wss://fstream.binance.com/stream?streams=',
    DEFAULT_SYMBOL: 'btcusdt',
    DEPTH_LEVELS: 20,
    DEPTH_UPDATE_SPEED: '100ms',

    // ── Heatmap ────────────────────────────────────────────
    HEATMAP: {
        TIME_WINDOW_MS: 5 * 60 * 1000,       // 5 minutes visible
        COLUMN_INTERVAL_MS: 100,               // one column per 100ms
        MAX_COLUMNS: 3000,                     // ring buffer size (5min / 100ms = 3000)
        PRICE_LEVELS: 40,                      // ±20 levels around mid price
        PRICE_GROUPING: null,                  // auto-detect from tick size
        SCROLL_SPEED: 2,
        INTENSITY_CURVE: 0.6,                  // defaults for power curve
    },

    // ── Color Scale (Bookmap-style) ────────────────────────
    COLORS: {
        BACKGROUND: '#0a0a14',
        GRID: 'rgba(255,255,255,0.04)',
        GRID_STRONG: 'rgba(255,255,255,0.08)',
        TEXT: '#8892a4',
        TEXT_BRIGHT: '#c8d0e0',

        // Heatmap gradient stops  [threshold_ratio, r, g, b]
        HEATMAP_SCALE: [
            [0.00,   10,  10,  20],    // empty  → near black
            [0.05,   15,  25,  80],    // tiny   → dark blue
            [0.15,   20,  60, 140],    // low    → blue
            [0.30,   10, 130, 160],    // med    → teal
            [0.50,   20, 180, 100],    // good   → green
            [0.70,  180, 200,  30],    // high   → yellow-green
            [0.85,  240, 180,  20],    // v.high → orange-yellow
            [0.95,  255, 255, 200],    // huge   → bright white-yellow
            [1.00,  255, 255, 255],    // max    → pure white
        ],

        // Trading colors
        BID: '#00e676',
        BID_DIM: 'rgba(0,230,118,0.35)',
        ASK: '#ff1744',
        ASK_DIM: 'rgba(255,23,68,0.35)',

        // Price line
        PRICE_LINE: '#ffab00',
        PRICE_LINE_GLOW: 'rgba(255,171,0,0.3)',

        // Crosshair
        CROSSHAIR: 'rgba(255,255,255,0.25)',
        CROSSHAIR_LABEL_BG: 'rgba(30,30,50,0.9)',

        // Volume profile
        VP_BID: 'rgba(0,230,118,0.6)',
        VP_ASK: 'rgba(255,23,68,0.6)',
        VP_POC: '#ffd740',

        // OrderFlow
        OF_BUY: '#00e676',
        OF_SELL: '#ff1744',
        OF_DELTA_POS: 'rgba(0,230,118,0.8)',
        OF_DELTA_NEG: 'rgba(255,23,68,0.8)',

        // Trade bubbles
        BUBBLE_BUY: 'rgba(0,230,118,0.5)',
        BUBBLE_SELL: 'rgba(255,23,68,0.5)',
    },

    // ── Volume Profile ─────────────────────────────────────
    VOLUME_PROFILE: {
        WIDTH: 160,
        BAR_GAP: 1,
        VALUE_AREA_PCT: 0.70,
    },

    // ── Order Flow ─────────────────────────────────────────
    ORDER_FLOW: {
        WIDTH: 140,
        TIME_BUCKET_MS: 1000,          // 1-second delta buckets
        WHALE_THRESHOLD_USD: 100000,   // $100k+ = whale trade
        MAX_BUCKETS: 300,              // 5 min of 1s buckets
    },

    // ── Trade Bubbles ──────────────────────────────────────
    BUBBLES: {
        MIN_SIZE: 3,
        MAX_SIZE: 30,
        MIN_QTY_USD: 5000,
        LIFETIME_MS: 8000,
    },

    // ── UI ──────────────────────────────────────────────────
    UI: {
        FPS_UPDATE_INTERVAL: 500,
        FONT_FAMILY: "'Inter', sans-serif",
        FONT_SIZE: 11,
        FONT_SIZE_SMALL: 9,
        TOOLTIP_OFFSET: 12,
    },

    // ── Popular Symbols ────────────────────────────────────
    SYMBOLS: [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
        'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
        'MATICUSDT', 'LTCUSDT', 'ARBUSDT', 'OPUSDT', 'APTUSDT',
    ],
};

// Pre-compute the LUT (Look-Up Table) for heatmap colors (256 entries)
CONFIG.COLORS._HEATMAP_LUT = new Uint8ClampedArray(256 * 4);
(function buildLUT() {
    const stops = CONFIG.COLORS.HEATMAP_SCALE;
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        // find surrounding stops
        let lo = 0, hi = stops.length - 1;
        for (let s = 0; s < stops.length - 1; s++) {
            if (t >= stops[s][0] && t <= stops[s + 1][0]) {
                lo = s; hi = s + 1; break;
            }
        }
        const range = stops[hi][0] - stops[lo][0] || 1;
        const f = (t - stops[lo][0]) / range;
        const idx = i * 4;
        CONFIG.COLORS._HEATMAP_LUT[idx]     = stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f; // R
        CONFIG.COLORS._HEATMAP_LUT[idx + 1] = stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f; // G
        CONFIG.COLORS._HEATMAP_LUT[idx + 2] = stops[lo][3] + (stops[hi][3] - stops[lo][3]) * f; // B
        CONFIG.COLORS._HEATMAP_LUT[idx + 3] = 255; // A
    }
})();
