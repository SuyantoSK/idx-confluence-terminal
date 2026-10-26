const axios = require('axios');
const fs = require('fs');
const path = require('path');

function calculateSMA(data, period) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateDean(vol, freq) {
  if (!freq || freq <= 0 || !vol || vol <= 0) return 0;
  return vol / Math.pow(freq, 3);
}

async function cekSaham(code) {
  const ticker = code.toUpperCase().replace('.JK', '');
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.JK?interval=1d&range=3mo`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
    const result = res.data?.chart?.result?.[0];
    if (!result) return console.log(`❌ Saham ${ticker} tidak ditemukan.`);

    const quotes = result.indicators.quote[0];
    const closes = quotes.close.filter(c => c !== null);
    const vols = quotes.volume.filter(v => v !== null);
    const highs = quotes.high.filter(h => h !== null);
    const lows = quotes.low.filter(l => l !== null);

    const lastC = closes[closes.length - 1];
    const prevC = closes[closes.length - 2];
    const lastV = vols[vols.length - 1];
    const change = ((lastC - prevC) / prevC) * 100;

    const avgV5 = vols.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
    const avgV20 = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    const turnover = (lastC * lastV) / 1000000000;

    const ma20 = calculateSMA(closes, 20);
    const ma50 = calculateSMA(closes, 50);
    const rsi = calculateRSI(closes, 14);

    const freqProxy = Math.max(1, Math.round(Math.sqrt(lastV) / 1.5));
    const dScore = calculateDean(lastV, freqProxy);
    const deanText = dScore < 0.01 ? dScore.toExponential(3) : dScore.toFixed(4);

    const sup = Math.min(...lows.slice(-20));
    const resis = Math.max(...highs.slice(-20));

    console.log(`\n========================================`);
    console.log(`📊 HASIL ANALISIS ${ticker}`);
    console.log(`========================================`);
    console.log(`• Harga           : Rp ${Math.round(lastC).toLocaleString('id-ID')} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`);
    console.log(`• VPA Spike (5D)  : ${(lastV / avgV5).toFixed(2)}x`);
    console.log(`• Freq Spike (20D): ${(lastV / avgV20).toFixed(2)}x`);
    console.log(`• Dean Score      : ${deanText}`);
    console.log(`• Turnover        : Rp ${turnover.toFixed(2)} Miliar`);
    console.log(`• Indikator       : MA20: ${Math.round(ma20 || 0)} | MA50: ${Math.round(ma50 || 0)} | RSI: ${rsi.toFixed(1)}`);
    console.log(`• Level Kunci     : Support: Rp ${Math.round(sup)} | Target: Rp ${Math.round(resis)}`);
    console.log(`========================================\n`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

const action = process.argv[2]?.toLowerCase();
const param = process.argv[3];

if (action === 'cek' && param) {
  cekSaham(param);
} else {
  console.log("Penggunaan: sudo docker exec -it idx_standalone_screener node cli.js cek <KODE>");
}
