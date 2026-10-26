const axios = require('axios');
const fs = require('fs');

function loadTickers() {
  try {
    if (fs.existsSync('./tickers_full.json')) {
      return JSON.parse(fs.readFileSync('./tickers_full.json', 'utf8'));
    }
    return JSON.parse(fs.readFileSync('./tickers.json', 'utf8'));
  } catch (e) {
    return ["BBCA", "BBRI", "BMRI", "BBNI", "ASII", "TLKM", "AMMN", "TPIA", "BREN", "ADRO"];
  }
}

async function getStockAnalysis(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker.toUpperCase()}.JK?range=1mo&interval=1d`;
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 10000
    });

    const result = res.data?.chart?.result?.[0];
    if (!result || !result.timestamp) return null;

    const quotes = result.indicators.quote[0];
    const timestamps = result.timestamp;
    const len = timestamps.length;
    if (len < 5) return null;

    const currentPrice = quotes.close[len - 1] || quotes.close[len - 2];
    const prevPrice = quotes.close[len - 2] || currentPrice;
    const currentVolume = quotes.volume[len - 1] || 0;
    const changePct = (((currentPrice - prevPrice) / prevPrice) * 100).toFixed(2);

    const validVolumes = quotes.volume.slice(Math.max(0, len - 21), len - 1).filter(v => v !== null && v > 0);
    const avgVolume = validVolumes.length > 0 
      ? validVolumes.reduce((a, b) => a + b, 0) / validVolumes.length 
      : currentVolume;

    const volumeRatio = avgVolume > 0 ? (currentVolume / avgVolume).toFixed(2) : '1.00';
    const spikeScore = (parseFloat(volumeRatio) * (1 + Math.abs(parseFloat(changePct)) / 100)).toFixed(2);
    const isSpike = parseFloat(volumeRatio) >= 1.5 && currentVolume >= 500000;

    const candles = [];
    const candleSliceStart = Math.max(0, len - 14);
    for (let i = candleSliceStart; i < len; i++) {
      if (quotes.open[i] && quotes.close[i]) {
        candles.push({
          o: quotes.open[i],
          h: quotes.high[i],
          l: quotes.low[i],
          c: quotes.close[i]
        });
      }
    }

    return {
      ticker: ticker.toUpperCase(),
      price: currentPrice,
      changePct: parseFloat(changePct),
      volume: currentVolume,
      avgVolume: Math.round(avgVolume),
      volumeRatio: parseFloat(volumeRatio),
      spikeScore: parseFloat(spikeScore),
      isSpike,
      candles
    };
  } catch (err) {
    return null;
  }
}

async function runFullScan() {
  const tickers = loadTickers();
  console.log(`[SCREENER] Memulai pemindaian ${tickers.length} saham...`);
  const results = [];

  for (let i = 0; i < tickers.length; i += 10) {
    const batch = tickers.slice(i, i + 10);
    const batchPromises = batch.map(t => getStockAnalysis(t));
    const batchResults = await Promise.all(batchPromises);

    batchResults.forEach(r => {
      if (r) results.push(r);
    });

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  results.sort((a, b) => b.spikeScore - a.spikeScore);
  console.log(`[SCREENER] Selesai memindai. ${results.length} saham berhasil dianalisis.`);
  return results;
}

module.exports = { getStockAnalysis, runFullScan };