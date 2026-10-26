require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const fsPromises = require('fs').promises;
const http = require('http');

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error('[ERROR] BOT_TOKEN tidak ditemukan di file .env');
  process.exit(1);
}

const bot = new Telegraf(botToken);
const TARGET_CHAT_ID = process.env.AUTO_SEND_CHAT_ID || '@analisajkse';
const TARGET_THREAD_ID = process.env.AUTO_SEND_THREAD_ID ? parseInt(process.env.AUTO_SEND_THREAD_ID, 10) : 299528;
const OWNER_ID = '613057985';

const rawAllowed = process.env.ALLOWED_USERS || '';
const ALLOWED_USERS = rawAllowed.split(',').map(s => s.trim()).filter(Boolean);

const NOT_ALLOWED_VIDEO = path.join(__dirname, 'notallowed.mp4');
const ACTIVITY_LOG_FILE = path.join(__dirname, 'activity_log.txt');
const CACHE_FILE = path.join(__dirname, 'screener_cache.json');

// Middleware Logging & Whitelist Telegram
bot.use(async (ctx, next) => {
  const user = ctx.from;
  if (!user) return next();
  const userId = user.id;
  const username = user.username ? `@${user.username}` : 'NoUsername';
  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  const chatTitle = ctx.chat?.title || ctx.chat?.username || 'Private';
  const threadId = ctx.message?.message_thread_id || ctx.message?.reply_to_message?.message_thread_id || '-';
  const messageText = ctx.message?.text || (ctx.message?.photo ? '[Photo]' : '[Other]');

  const nowWIB = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date());

  const logFileLine = `[${nowWIB}] ID: ${userId} | User: ${username} | Name: ${fullName} | Context: ${chatTitle} (Topic: ${threadId}) | Action: ${messageText}\n`;
  fsPromises.appendFile(ACTIVITY_LOG_FILE, logFileLine).catch(() => {});
  return next();
});

bot.use(async (ctx, next) => {
  if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') return next();
  const userId = String(ctx.from?.id || '');
  if (ALLOWED_USERS.length > 0 && !ALLOWED_USERS.includes(userId)) {
    const captionText = `⛔ *NOT ALLOWED / PRIVATE BOT*\n\nUser ID: \`${userId}\``;
    try {
      if (fs.existsSync(NOT_ALLOWED_VIDEO)) {
        await ctx.replyWithAnimation({ source: NOT_ALLOWED_VIDEO }, { caption: captionText, parse_mode: 'Markdown' });
      } else {
        await ctx.reply(captionText, { parse_mode: 'Markdown' });
      }
    } catch (e) {
      ctx.reply(`⛔ NOT ALLOWED!\nUser ID: ${userId}`);
    }
    return;
  }
  return next();
});

function isOwner(ctx) {
  return String(ctx.from?.id || '') === OWNER_ID;
}

let UNIVERSE_IHSG = [];
try {
  const emitenRaw = fs.readFileSync(path.join(__dirname, 'emiten.json'), 'utf8');
  UNIVERSE_IHSG = JSON.parse(emitenRaw);
} catch (e) {
  UNIVERSE_IHSG = ['BBCA', 'BBRI', 'BMRI', 'BBNI', 'ASII', 'TLKM', 'MEDC', 'BDKR', 'TOOL', 'PRDL', 'KOCI', 'ESIP', 'BRMS', 'TPMA', 'ADRO'];
}

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
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function calculateDeanAnalyzer(volume, frequency) {
  if (!frequency || frequency <= 0 || !volume || volume <= 0) return 0;
  return volume / Math.pow(frequency, 3);
}

function generateVPASignal(currentPrice, ma20, ma50, rsi, volRatio, changePct) {
  let signal = '⏳ WAIT / NETRAL';
  let actionNote = 'Konsolidasi sideways.';
  const isAboveMA20 = ma20 ? currentPrice > ma20 : false;
  const isAboveMA50 = ma50 ? currentPrice > ma50 : false;

  if (isAboveMA20 && isAboveMA50) {
    if (volRatio >= 1.5 && changePct > 0) {
      signal = '🟢 STRONG BUY (Breakout + Vol)';
      actionNote = 'Uptrend kuat didukung volume masif.';
    } else if (rsi < 70) {
      signal = '🟢 BUY ON WEAKNESS';
      actionNote = 'Tren positif terjaga di atas support MA.';
    } else {
      signal = '🟡 TAKE PROFIT SEBAGIAN';
      actionNote = 'Overbought (RSI > 70). Waspada pullback.';
    }
  } else if (!isAboveMA20 && isAboveMA50) {
    signal = '🟡 WAIT & SEE';
    actionNote = 'Tunggu pantulan di area MA50.';
  } else if (!isAboveMA20 && !isAboveMA50) {
    if (rsi < 30) {
      signal = '⚠️ OVERSOLD / REBOUND';
      actionNote = 'Jenuh jual ekstrem. Potensi technical bounce.';
    } else {
      signal = '🔴 SELL / AVOID';
      actionNote = 'Downtrend di bawah MA20 & MA50.';
    }
  }
  return { signal, actionNote };
}

async function fetchStockHistory(code) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.JK?interval=1d&range=3mo`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4500 });
    const result = res.data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0];
    const opens = quotes?.open?.filter(o => o !== null) || [];
    const closes = quotes?.close?.filter(c => c !== null) || [];
    const volumes = quotes?.volume?.filter(v => v !== null) || [];
    const highs = quotes?.high?.filter(h => h !== null) || [];
    const lows = quotes?.low?.filter(l => l !== null) || [];

    if (closes.length < 25) return null;

    let currentVol = volumes[volumes.length - 1];
    let currentPrice = meta.regularMarketPrice || closes[closes.length - 1];
    let prevClose = meta.chartPreviousClose || closes[closes.length - 2];

    if (currentVol === 0 && volumes.length >= 2) {
      currentVol = volumes[volumes.length - 2];
      currentPrice = closes[closes.length - 2];
      prevClose = closes[closes.length - 3] || prevClose;
    }

    let changeToday = 0;
    if (typeof meta.regularMarketChangePercent === "number") {
      changeToday = meta.regularMarketChangePercent;
    } else if (prevClose > 0) {
      changeToday = ((currentPrice - prevClose) / prevClose) * 100;
    }
    const price1W = closes[closes.length - 6] || closes[0];
    const price1M = closes[closes.length - 21] || closes[0];
    const return1W = ((currentPrice - price1W) / price1W) * 100;
    const return1M = ((currentPrice - price1M) / price1M) * 100;

    const prevVols20 = volumes.slice(-21, -1);
    const avgVol20 = prevVols20.reduce((a, b) => a + b, 0) / (prevVols20.length || 1);
    const prevVols5 = volumes.slice(-6, -1);
    const avgVol5 = prevVols5.reduce((a, b) => a + b, 0) / (prevVols5.length || 1);
    const turnover = currentPrice * currentVol;

    // Susun candle OHLCV, data MA20, dan MA50 untuk TradingView Chart
    const candles = [];
    const ma20Series = [];
    const ma50Series = [];

    for (let i = 0; i < closes.length; i++) {
      if (timestamps[i] && opens[i] && highs[i] && lows[i] && closes[i]) {
        const d = new Date(timestamps[i] * 1000);
        const timeStr = d.toISOString().split('T')[0];
        
        candles.push({
          time: timeStr,
          open: opens[i],
          high: highs[i],
          low: lows[i],
          close: closes[i],
          volume: volumes[i] || 0
        });

        // Hitung barisan titik MA20
        if (i >= 19) {
          const slice20 = closes.slice(i - 19, i + 1);
          const val20 = slice20.reduce((a, b) => a + b, 0) / 20;
          ma20Series.push({ time: timeStr, value: Math.round(val20) });
        }

        // Hitung barisan titik MA50
        if (i >= 49) {
          const slice50 = closes.slice(i - 49, i + 1);
          const val50 = slice50.reduce((a, b) => a + b, 0) / 50;
          ma50Series.push({ time: timeStr, value: Math.round(val50) });
        }
      }
    }

    return {
      code, currentPrice, changeToday, return1W, return1M,
      currentVol, avgVol20, avgVol5, turnover,
      closes, volumes, highs, lows,
      candles, ma20Series, ma50Series
    };
  } catch (e) {
    return null;
  }
}

async function scanUniverseInBatches(emitenList, fetchFunction, batchSize = 15) {
  const results = [];
  for (let i = 0; i < emitenList.length; i += batchSize) {
    const batch = emitenList.slice(i, i + batchSize);
    const batchPromises = batch.map(code => fetchFunction(code));
    const batchResults = await Promise.all(batchPromises);
    for (const res of batchResults) {
      if (res) results.push(res);
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return results;
}

let cachedScreenerData = [];
let isScanningActive = false;

try {
  if (fs.existsSync(CACHE_FILE)) {
    cachedScreenerData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log(`[API] Loaded ${cachedScreenerData.length} items from disk cache.`);
  }
} catch (e) {}

async function triggerBackgroundScan() {
  if (isScanningActive) return;
  isScanningActive = true;
  console.log('[API] Background scan universe IHSG dimulai...');

  try {
    const allData = await scanUniverseInBatches(UNIVERSE_IHSG, fetchStockHistory, 15);
    const results = [];

    for (const data of allData) {
      if (!data || data.volumes.length < 5) continue;
      const volRatio = data.avgVol5 > 0 ? (data.currentVol / data.avgVol5) : 0;
      const freqRatio = data.avgVol20 > 0 ? (data.currentVol / data.avgVol20) : 0;
      const isLiquid = data.turnover >= 500000000;

      if (isLiquid && (volRatio >= 1.2 || freqRatio >= 1.2)) {
        const ma20 = calculateSMA(data.closes, 20);
        const ma50 = calculateSMA(data.closes, 50);
        const rsi = calculateRSI(data.closes, 14);
        const { signal } = generateVPASignal(data.currentPrice, ma20, ma50, rsi, volRatio, data.changeToday);

        const freqProxy = Math.max(1, Math.round(Math.sqrt(data.currentVol) / 1.5));
        const deanScore = calculateDeanAnalyzer(data.currentVol, freqProxy);

        results.push({
          ticker: data.code,
          price: Math.round(data.currentPrice),
          chg: `${data.changeToday >= 0 ? '+' : ''}${data.changeToday.toFixed(2)}%`,
          vpa: `${volRatio.toFixed(2)}x`,
          fqs: `${freqRatio.toFixed(2)}x`,
          dean: deanScore < 0.01 ? deanScore.toExponential(2) : deanScore.toFixed(3),
          rsi: rsi.toFixed(1),
          signal,
          turnover: `${(data.turnover / 1000000000).toFixed(2)} M`,
          up: data.changeToday >= 0
        });
      }
    }

    if (results.length > 0) {
      results.sort((a, b) => parseFloat(b.vpa) - parseFloat(a.vpa));
      cachedScreenerData = results;
      fs.writeFileSync(CACHE_FILE, JSON.stringify(results), 'utf8');
      console.log(`[API] Scan selesai: ${results.length} saham tersimpan di cache.`);
    }
  } catch (err) {
    console.error('[API ERROR]', err.message);
  } finally {
    isScanningActive = false;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      fs.createReadStream(htmlPath).pipe(res);
      return;
    }
  }

  if (reqUrl.pathname === '/api/screener') {
    res.setHeader('Content-Type', 'application/json');
    const force = reqUrl.searchParams.get('force') === 'true';
    if (force || cachedScreenerData.length === 0) {
      triggerBackgroundScan();
    }
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'success',
      isScanning: isScanningActive,
      total: cachedScreenerData.length,
      data: cachedScreenerData
    }));
    return;
  }

  if (reqUrl.pathname === '/api/cek') {
    res.setHeader('Content-Type', 'application/json');
    const ticker = reqUrl.searchParams.get('ticker')?.toUpperCase();
    if (!ticker) {
      res.writeHead(400);
      res.end(JSON.stringify({ status: 'error', message: 'Parameter ticker diperlukan' }));
      return;
    }

    try {
      const data = await fetchStockHistory(ticker);
      if (!data) {
        res.writeHead(404);
        res.end(JSON.stringify({ status: 'error', message: 'Ticker tidak ditemukan' }));
        return;
      }

      const ma20 = calculateSMA(data.closes, 20);
      const ma50 = calculateSMA(data.closes, 50);
      const rsi = calculateRSI(data.closes, 14);
      const volRatio5 = data.avgVol5 > 0 ? (data.currentVol / data.avgVol5).toFixed(2) : '0.00';
      const freqRatio20 = data.avgVol20 > 0 ? (data.currentVol / data.avgVol20) : 0;
      const { signal, actionNote } = generateVPASignal(data.currentPrice, ma20, ma50, rsi, parseFloat(volRatio5), data.changeToday);

      const freqProxy = Math.max(1, Math.round(Math.sqrt(data.currentVol) / 1.5));
      const deanScore = calculateDeanAnalyzer(data.currentVol, freqProxy);
      const deanText = deanScore < 0.01 ? deanScore.toExponential(3) : deanScore.toFixed(4);

      const recentHighs = data.highs.slice(-20);
      const recentLows = data.lows.slice(-20);
      const resLevel = recentHighs.length ? Math.max(...recentHighs) : data.currentPrice * 1.05;
      const supLevel = recentLows.length ? Math.min(...recentLows) : data.currentPrice * 0.95;

      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'success',
        ticker,
        price: Math.round(data.currentPrice),
        chg: `${data.changeToday >= 0 ? '+' : ''}${data.changeToday.toFixed(2)}%`,
        volume: `${(data.currentVol / 100).toLocaleString('id-ID')} Lot`,
        volRatio: `${volRatio5}x`,
        freqRatio: `${freqRatio20}x`,
        deanScore: deanText,
        rsi: rsi.toFixed(1),
        ma20: Math.round(ma20 || 0),
        ma50: Math.round(ma50 || 0),
        support: Math.round(supLevel),
        resistance: Math.round(resLevel),
        signal,
        actionNote,
        turnover: `${(data.turnover / 1000000000).toFixed(2)} M`,
        candles: data.candles,
        ma20Series: data.ma20Series,
        ma50Series: data.ma50Series
      }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ status: 'error', message: err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'not_found' }));
});

const API_PORT = process.env.PORT || 3000;
server.listen(API_PORT, '0.0.0.0', () => {
  console.log(`📡 [API & WEB READY] Web Terminal aktif di http://0.0.0.0:${API_PORT}`);
});

bot.start((ctx) => {
  ctx.reply("🤖 *IDX Multi-Engine Terminal Live!*\nKetik /buy, /fqs, /vpa, /dean, atau /cek <KODE>", { parse_mode: 'Markdown' });
});

bot.launch().then(() => console.log('🚀 BOT TELEGRAM CONNECTED!')).catch(console.error);
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
