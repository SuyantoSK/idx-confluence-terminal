require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const fsPromises = require('fs').promises;

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error('[BOT ERROR] BOT_TOKEN tidak ditemukan di file .env');
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

// Logging Middleware
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

// Whitelist Middleware
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

async function fetchStockHistory(code) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.JK?interval=1d&range=3mo`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4500 });
    const result = res.data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const quotes = result.indicators?.quote?.[0];
    const closes = quotes?.close?.filter(c => c !== null) || [];
    const volumes = quotes?.volume?.filter(v => v !== null) || [];

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

    const prevVols5 = volumes.slice(-6, -1);
    const avgVol5 = prevVols5.reduce((a, b) => a + b, 0) / (prevVols5.length || 1);
    const turnover = currentPrice * currentVol;

    return { code, currentPrice, changeToday, currentVol, avgVol5, turnover, closes };
  } catch (e) {
    return null;
  }
}

bot.start((ctx) => {
  ctx.reply("🤖 *IDX Confluence Bot Live!*\nKetik /cek <KODE> untuk analisis cepat.", { parse_mode: 'Markdown' });
});

bot.command('cek', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('Format: `/cek BBRI`', { parse_mode: 'Markdown' });
  const code = args[1].toUpperCase().replace('.JK', '');
  const data = await fetchStockHistory(code);
  if (!data) return ctx.reply(`❌ Data emiten ${code} tidak ditemukan.`);

  const ma20 = calculateSMA(data.closes, 20);
  const ma50 = calculateSMA(data.closes, 50);
  const rsi = calculateRSI(data.closes, 14);
  const volRatio5 = data.avgVol5 > 0 ? (data.currentVol / data.avgVol5).toFixed(2) : '0.00';

  let signal = '⏳ WAIT / NETRAL';
  if (data.currentPrice > (ma20 || 0) && data.currentPrice > (ma50 || 0)) {
    signal = volRatio5 >= 1.5 ? '🟢 STRONG BUY (Breakout + Vol)' : '🟢 BUY ON WEAKNESS';
  } else if (data.currentPrice < (ma20 || 0) && data.currentPrice < (ma50 || 0)) {
    signal = '🔴 SELL / AVOID';
  }

  ctx.reply(
    `📊 *${code}* | Rp ${Math.round(data.currentPrice).toLocaleString('id-ID')} (${data.changeToday >= 0 ? '+' : ''}${data.changeToday.toFixed(2)}%)\n` +
    `• VPA Spike: \`${volRatio5}x\` | RSI: \`${rsi.toFixed(1)}\`\n` +
    `• Sinyal: *${signal}*`,
    { parse_mode: 'Markdown' }
  );
});

bot.launch().then(() => console.log('🚀 [TELEGRAM BOT ACTIVE] Terhubung mandiri ke Telegram.')).catch(console.error);
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
