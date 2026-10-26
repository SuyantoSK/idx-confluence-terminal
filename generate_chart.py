import sys
import os
import json
import urllib.request
import datetime
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

def calculate_rsi(closes, period=14):
    closes = np.array(closes, dtype=float)
    deltas = np.diff(closes)
    seed = deltas[:period+1]
    up = seed[seed >= 0].sum() / period
    down = -seed[seed < 0].sum() / period
    rs = up / down if down != 0 else 0
    rsi = np.zeros_like(closes)
    rsi[:period] = 100. - 100. / (1. + rs) if down != 0 else 100.

    upval = seed[seed >= 0].sum() / period
    downval = -seed[seed < 0].sum() / period

    for i in range(period, len(closes)):
        delta = deltas[i - 1]
        if delta > 0:
            upval = (upval * (period - 1) + delta) / period
            downval = (downval * (period - 1)) / period
        else:
            upval = (upval * (period - 1)) / period
            downval = (downval * (period - 1) - delta) / period

        rs = upval / downval if downval != 0 else 0
        rsi[i] = 100. - 100. / (1. + rs) if downval != 0 else 100.

    return rsi

def generate_stock_chart(symbol):
    ticker = symbol.upper().replace('.JK', '')
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}.JK?interval=1d&range=6mo"
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching data: {e}")
        sys.exit(1)

    result = data['chart']['result'][0]
    timestamps = result['timestamp']
    quotes = result['indicators']['quote'][0]

    dates = [datetime.date.fromtimestamp(ts) for ts in timestamps]
    opens = np.array(quotes['open'], dtype=float)
    highs = np.array(quotes['high'], dtype=float)
    lows = np.array(quotes['low'], dtype=float)
    closes = np.array(quotes['close'], dtype=float)
    volumes = np.array(quotes['volume'], dtype=float)

    # Filter NaN
    valid_mask = ~np.isnan(closes) & ~np.isnan(opens) & ~np.isnan(highs) & ~np.isnan(lows)
    dates = [d for d, v in zip(dates, valid_mask) if v]
    opens = opens[valid_mask]
    highs = highs[valid_mask]
    lows = lows[valid_mask]
    closes = closes[valid_mask]
    volumes = volumes[valid_mask]

    if len(closes) < 20:
        print("Data tidak cukup")
        sys.exit(1)

    # Hitung Indikator Sebelum Di-slice
    ma20 = np.array([np.mean(closes[i-19:i+1]) if i >= 19 else np.nan for i in range(len(closes))])
    ma50 = np.array([np.mean(closes[i-49:i+1]) if i >= 49 else np.nan for i in range(len(closes))])
    rsi = calculate_rsi(closes, period=14)

    # Ambil 65 candle terakhir
    DISPLAY_PERIOD = min(len(dates), 65)
    dates = dates[-DISPLAY_PERIOD:]
    opens = opens[-DISPLAY_PERIOD:]
    highs = highs[-DISPLAY_PERIOD:]
    lows = lows[-DISPLAY_PERIOD:]
    closes = closes[-DISPLAY_PERIOD:]
    volumes = volumes[-DISPLAY_PERIOD:]
    ma20 = ma20[-DISPLAY_PERIOD:]
    ma50 = ma50[-DISPLAY_PERIOD:]
    rsi = rsi[-DISPLAY_PERIOD:]

    num_days = len(dates)
    x = np.arange(num_days)

    last_o = opens[-1]
    last_h = highs[-1]
    last_l = lows[-1]
    last_c = closes[-1]
    prev_c = closes[-2] if len(closes) > 1 else last_c
    diff_val = last_c - prev_c
    pct_val = (diff_val / prev_c) * 100
    is_today_bull = last_c >= prev_c

    last_ma20 = ma20[-1]
    last_ma50 = ma50[-1]
    last_rsi = rsi[-1]
    last_vol = volumes[-1]

    # TradingView Palette
    BG_COLOR = '#131722'
    GRID_COLOR = '#1f2433'
    TEXT_MUTED = '#787b86'
    COLOR_BULL = '#089981'
    COLOR_BEAR = '#f23645'
    COLOR_MA20 = '#26c6da'     # Cyan
    COLOR_MA50 = '#ab47bc'     # Purple
    COLOR_RSI  = '#2962ff'     # Royal Blue

    plt.style.use('dark_background')
    fig, (ax1, ax3) = plt.subplots(
        2, 1, 
        figsize=(11, 7.8), 
        gridspec_kw={'height_ratios': [5.2, 1.8]}, 
        sharex=True
    )
    fig.patch.set_facecolor(BG_COLOR)

    # ----------------------------------------------------
    # 1. MAIN PANEL (CANDLESTICK + MA + VOLUME)
    # ----------------------------------------------------
    ax1.set_facecolor(BG_COLOR)
    ax1.yaxis.tick_right()
    ax1.yaxis.set_label_position("right")
    ax1.grid(True, linestyle='-', alpha=0.35, color=GRID_COLOR)
    ax1.tick_params(colors=TEXT_MUTED, labelsize=9.5, length=0)

    # Candlestick
    candle_width = 0.65
    for i in range(num_days):
        o, c, h, l = opens[i], closes[i], highs[i], lows[i]
        bull = c >= o
        c_color = COLOR_BULL if bull else COLOR_BEAR
        ax1.plot([x[i], x[i]], [l, h], color=c_color, linewidth=1.1, zorder=3)
        lower = min(o, c)
        height = max(abs(c - o), 0.5)
        rect = Rectangle((x[i] - candle_width/2, lower), candle_width, height, 
                         facecolor=c_color, edgecolor=c_color, zorder=3)
        ax1.add_patch(rect)

    # Plot Garis MA20 & MA50
    ax1.plot(x, ma20, color=COLOR_MA20, linewidth=1.4, label='MA 20', zorder=5)
    ax1.plot(x, ma50, color=COLOR_MA50, linewidth=1.4, label='MA 50', zorder=5)

    # Volume Sub-Overlay di dasar chart
    ax_vol = ax1.twinx()
    ax_vol.yaxis.set_visible(False)
    vol_colors = [COLOR_BULL if closes[i] >= opens[i] else COLOR_BEAR for i in range(num_days)]
    ax_vol.bar(x, volumes, width=candle_width, color=vol_colors, alpha=0.28, zorder=2)
    ax_vol.set_ylim(0, np.max(volumes) * 4.5)

    # Header Baris 1: Symbol & OHLC Stats
    header_color = COLOR_BULL if is_today_bull else COLOR_BEAR
    sign_str = '+' if diff_val >= 0 else ''
    title_text = f"{ticker} · 1D · IDX"
    stats_text = f"  O {int(last_o):,}   H {int(last_h):,}   L {int(last_l):,}   C {int(last_c):,}   {sign_str}{int(diff_val):,} ({sign_str}{pct_val:.2f}%)"
    
    ax1.text(0.012, 0.94, title_text, transform=ax1.transAxes, color='#ffffff', fontsize=11, fontweight='bold')
    ax1.text(0.19, 0.94, stats_text, transform=ax1.transAxes, color=header_color, fontsize=9.2, fontweight='bold')
    
    # Header Baris 2: Volume & MA Legends
    vol_str = f"{last_vol/1000000:.2f}M" if last_vol >= 1000000 else f"{int(last_vol/1000)}K"
    ma20_str = f"{int(last_ma20):,}" if not np.isnan(last_ma20) else "-"
    ma50_str = f"{int(last_ma50):,}" if not np.isnan(last_ma50) else "-"

    ax1.text(0.012, 0.88, f"Vol {vol_str}", transform=ax1.transAxes, color=TEXT_MUTED, fontsize=8.8)
    ax1.text(0.12, 0.88, f"MA 20 {ma20_str}", transform=ax1.transAxes, color=COLOR_MA20, fontsize=8.8, fontweight='bold')
    ax1.text(0.24, 0.88, f"MA 50 {ma50_str}", transform=ax1.transAxes, color=COLOR_MA50, fontsize=8.8, fontweight='bold')

    # Current Price Line & Badge di Kanan
    active_color = COLOR_BULL if is_today_bull else COLOR_BEAR
    ax1.axhline(last_c, color=active_color, linestyle=':', linewidth=1.1, alpha=0.9, zorder=6)
    
    ax1.text(
        x[-1] + 1.2, last_c, f" {int(last_c):,} ", 
        color='#ffffff', fontsize=9.5, fontweight='bold', va='center', ha='left',
        bbox=dict(boxstyle='square,pad=0.25', facecolor=active_color, edgecolor=active_color),
        zorder=10
    )

    min_p, max_p = np.min(lows), np.max(highs)
    p_pad = (max_p - min_p) * 0.08
    ax1.set_ylim(min_p - p_pad, max_p + p_pad)

    # ----------------------------------------------------
    # 2. RSI PANEL
    # ----------------------------------------------------
    ax3.set_facecolor(BG_COLOR)
    ax3.yaxis.tick_right()
    ax3.yaxis.set_label_position("right")
    ax3.grid(True, linestyle='-', alpha=0.35, color=GRID_COLOR)
    ax3.tick_params(colors=TEXT_MUTED, labelsize=9.5, length=0)

    ax3.plot(x, rsi, color=COLOR_RSI, linewidth=1.5, zorder=3)
    ax3.axhline(70, color=COLOR_BEAR, linestyle=':', alpha=0.6, linewidth=1)
    ax3.axhline(50, color=TEXT_MUTED, linestyle='--', alpha=0.3, linewidth=0.8)
    ax3.axhline(30, color=COLOR_BULL, linestyle=':', alpha=0.6, linewidth=1)
    ax3.fill_between(x, rsi, 70, where=(rsi >= 70), color=COLOR_BEAR, alpha=0.2)
    ax3.fill_between(x, rsi, 30, where=(rsi <= 30), color=COLOR_BULL, alpha=0.2)
    
    ax3.set_ylim(10, 95)
    ax3.set_yticks([30, 50, 70])
    ax3.text(0.012, 0.82, f"RSI (14)", transform=ax3.transAxes, color=TEXT_MUTED, fontsize=8.8)

    # Badge Nilai RSI Terakhir
    rsi_badge_c = COLOR_BEAR if last_rsi >= 70 else (COLOR_BULL if last_rsi <= 30 else COLOR_RSI)
    ax3.text(
        x[-1] + 1.2, last_rsi, f" {last_rsi:.1f} ", 
        color='#ffffff', fontsize=9, fontweight='bold', va='center', ha='left',
        bbox=dict(boxstyle='square,pad=0.22', facecolor=rsi_badge_c, edgecolor=rsi_badge_c),
        zorder=10
    )

    # Sumbu X Tanggal
    step = max(1, num_days // 7)
    tick_indices = list(range(0, num_days, step))
    if (num_days - 1) not in tick_indices:
        tick_indices.append(num_days - 1)
        
    ax3.set_xticks(tick_indices)
    ax3.set_xticklabels([dates[i].strftime('%d %b') for i in tick_indices], rotation=0, color=TEXT_MUTED)

    ax1.set_xlim(-1, num_days + 6)
    ax3.set_xlim(-1, num_days + 6)

    plt.tight_layout()
    plt.subplots_adjust(hspace=0.04)

    output_file = f"{ticker}.png"
    plt.savefig(output_file, dpi=150, facecolor=BG_COLOR, edgecolor='none')
    plt.close()
    print(f"Chart saved to {output_file}")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        generate_stock_chart(sys.argv[1])
    else:
        print("Usage: python3 generate_chart.py <KODE_SAHAM>")
