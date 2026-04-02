<img width="1919" height="1079" alt="resim" src="https://github.com/user-attachments/assets/03a4358e-19ef-45a9-95da-c4a0e17c55ac" />

# 🔥 HeatFlow — Professional Order Flow & Real-Time Heatmap
![HeatFlow](https://img.shields.io/badge/Status-Active-success.svg) ![Language](https://img.shields.io/badge/Language-JavaScript%20%7C%20HTML5%20%7C%20CSS3-blue.svg) ![License](https://img.shields.io/badge/License-MIT-green.svg)

HeatFlow is an advanced, institutional-grade Order Flow analysis dashboard and Real-Time Order Book Heatmap. It is designed to provide high-frequency trading insights by visualizing market micro-structure, liquidity dynamics, and order book imbalances in real-time.

Inspired by professional institutional methodologies (e.g., Fabio Valantini's flow analysis), HeatFlow decodes the tape and order book to filter out retail noise and identify high-probability trading setups.

---

## ⚡ Core Features

### 1. High-Performance Heatmap Visualization
- **Deep Liquidity Engine:** Renders dynamic limit order walls (bids/asks) in real-time.
- **Dynamic Heat Scaling:** Automatically adjusts the intensity of colors based on relative liquidity depth, preventing visual washout during volatile "whale" prints.
- **Auto-Scroll & Mid-Click Panning:** Seamlessly navigate the order book history with an intuitive UI.

### 2. Institutional Signal Engine v3
A state-of-the-art anomaly and setup detection engine that requires strict **confluence** across multiple data dimensions before firing. The signal state machine utilizes hysteresis (lock-in periods) to prevent signal jitter.

It calculates signals based on **6 High-Probability Components**:
- 🔫 **Liquidity Sweep:** Detects when price runs above/below a rolling extreme, takes out stops, and rapidly reverses alongside a shift in cumulative delta.
- 🔋 **Delta Exhaustion:** Identifies scenarios where cumulative delta reaches an extreme percentile (heavy buying/selling), but price fails to make a new high/low. (Smart money trapping retail).
- 🧲 **Absorption Wall:** Analyzes the Price Impact Ratio (Delta vs. Price Move). High delta with zero price movement indicates a silent institutional limit order wall absorbing aggressive taker flow.
- ⚡ **Volume Aggression:** Tracks sustained, one-sided aggressive taker flow over a rolling window. It incorporates "Whale" trade multiplicators for precise momentum detection.
- 〽️ **VWAP Extension Setup:** Combines standard deviation extension (>1.5σ) from the VWAP with confirming Delta Mean-Reversion flow to catch institutional mean-reversion plays safely.
- 🏛️ **Auction Market Theory (AMT):** Tracks execution inside vs. outside the Value Area (VA ≈ 70% volume). Fires signals based on Value Area High/Low Rejections and Acceptances (Value Shifts).

### 3. Professional Signal HUD
- **Confluence Indicator:** Ensures at least 3 out of 6 components align before exiting a `NEUTRAL` state.
- **Quality Badging [A/B/C]:** Rates the strictness and probability of the active setup.
- **Hysteresis Lock:** Actively locks in a signal for a minimum threshold (e.g., 60 seconds) to ensure trade stability and eliminate noise.
- **Big Alert Toasts:** Full-screen directional warnings triggered upon high-confidence signal shifts.

### 4. Advanced Telemetry Panels
- **Cumulative Delta Graph:** Live line charting of aggressive volume delta.
- **Volume Profile (TPO):** Tracks Point of Control (POC) and relative traded volume per tick level.
- **Multi-Metric Top Bar:** Live calculation of Bid/Ask Depth Imbalance, Real-time Spread, Whale Trade counts, and TPS (Ticks per second).

---

## 🛠️ Technology Stack
- **DOM / Rendering:** Native HTML5 Canvas + highly optimized Vanilla JavaScript.
- **Styling:** Custom CSS3 with dynamic variables, CSS Grid, Flexbox, and complex keyframe animations (No bloated frameworks).
- **Data Flow:** Designed to be easily linked with WebSockets (e.g., Binance Futures, Hyperliquid) for 1ms tick data injection.

---

## 🚀 Installation & Usage

1. **Clone the repository:**
   ```bash
   git clone https://github.com/cagriKarakulak/heatflow.git
   ```
2. **Navigate to the directory:**
   ```bash
   cd heatflow
   ```
3. **Run a local server:**
   Because HeatFlow uses ES6 Modules and Canvas APIs, it must be served over `http://` or `https://` (not `file://`).
   ```bash
   python -m http.server 8045
   # or
   npx serve . -p 8045
   ```
4. **Open in Browser:**
   Navigate to `http://localhost:8045`

---

## 🧠 Philosophy: "Don't Fight the Tape"
> *Retail traders predict. Professional traders react to executed volume.*
HeatFlow doesn't use lagging indicators like RSI or MACD. It uses **Level 2 Order Book Depth** and **Aggressive Taker Trades**. If the institutions are trapping, absorbing, or sweeping, HeatFlow visualizes it mathematically.

---

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
