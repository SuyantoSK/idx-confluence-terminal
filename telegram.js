const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const screener = require('./screener');

function initTelegram(config, getCachedData, triggerScan) {
  const token = config.telegram?.bot_token;
  if (!token || token === "BOT_TOKEN_TELEGRAM_ANDA") {
    console.error("[TELEGRAM] Error: bot_token belum diisi di config.json!");
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });

  function loadHelp() {
    try {
      return fs.readFileSync('./help.txt', 'utf8');
    } catch (e) {
      return " *IDX SCREENER BOT*\n\nPerintah:\n- `/cek <KODE>`: Cek saham & candlestick\n- `/topspike`: Top Spike volume\n- `/help`: Panduan";
    }
  }

  function getActionSignal(data) {
    const isPriceUp = parseFloat(data.changePct) > 0;
    const isPriceDown = parseFloat(data.changePct) < 0;

    if (data.isSpike && isPriceUp) {
      return { 
        buttonText: ' BUY SIGNAL (Klik Info)', 
        code: 'BUY',
        header: ' *REKOMENDASI: BUY*'
      };
    } else if (data.isSpike && isPriceDown) {
      return { 
        buttonText: ' SELL SIGNAL (Klik Info)', 
        code: 'SELL',
        header: ' *REKOMENDASI: SELL*'
      };
    } else {
      return { 
        buttonText: '⚪ NORMAL / WAIT & SEE', 
        code: 'HOLD',
        header: '⚪ *REKOMENDASI: WAIT & SEE*'
      };
    }
  }

  // Builder Static Chart untuk Pratinjau Balon Chat
  function generateCandleChartUrl(ticker, candles) {
    const chartConfig = {
      type: 'candlestick',
      data: {
        datasets: [{
          label: `${ticker} Daily`,
          data: candles
        }]
      },
      options: {
        title: {
          display: true,
          text: `${ticker} - Candlestick (14 Hari)`,
          fontColor: '#ffffff',
          fontSize: 13
        },
        legend: { display: false }
      }
    };
    return `https://quickchart.io/chart?bkg=%23181a20&w=500&h=260&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
  }

  // Command: Help
  bot.onText(/^(\/help|\/start|!help|!menu)/i, (msg) => {
    bot.sendMessage(msg.chat.id, loadHelp(), { parse_mode: 'Markdown' });
  });

  // Command: Cek Saham
  bot.onText(/^(\/cek|!cek)\s*(.*)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const ticker = match[2]?.trim();

    if (!ticker) {
      bot.sendMessage(chatId, 'Format salah. Gunakan: `/cek <KODE>` (contoh: `/cek AUTO`)', { parse_mode: 'Markdown' });
      return;
    }

    let waitMsg = null;
    try {
      waitMsg = await bot.sendMessage(chatId, `⏳ Menganalisis *${ticker.toUpperCase()}*...`, { parse_mode: 'Markdown' });
    } catch (e) {}

    const data = await screener.getStockAnalysis(ticker);

    if (waitMsg) {
      bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    }

    if (!data) {
      bot.sendMessage(chatId, `❌ Saham *${ticker.toUpperCase()}* tidak ditemukan di IDX.`, { parse_mode: 'Markdown' });
      return;
    }

    const signal = getActionSignal(data);

    // URL Widget TradingView Mobile (Mendukung Gestur Pan, Zoom, Indikator)
    const tvWidgetUrl = `https://s.tradingview.com/widgetembed/?symbol=IDX%3A${data.ticker}&interval=D&hidesidetoolbar=1&symboledit=1&saveimage=0&toolbarbg=1e222d&studies=[]&theme=dark&style=1&timezone=Asia%2FJakarta`;

    const caption = ` *ANALISIS TEKNIKAL: ${data.ticker}*\n` +
                    `${signal.header}\n\n` +
                    `• *Harga:* Rp ${data.price.toLocaleString('id-ID')} (${data.changePct > 0 ? '+' : ''}${data.changePct}%)\n` +
                    `• *Volume:* ${data.volume.toLocaleString('id-ID')}\n` +
                    `• *Volume Ratio:* ${data.volumeRatio}x AVG 20D\n` +
                    `• *Spike Score:* ${data.spikeScore}\n` +
                    `• *Status:* ${data.isSpike ? ' Valid Spike' : 'Normal'}`;

    // Tombol Pop-up Floating Sheet
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: signal.buttonText, callback_data: `signal_${data.ticker}_${signal.code}` }
          ],
          [
            { 
              text: ` Buka Floating Interactive Chart`, 
              web_app: { url: tvWidgetUrl } 
            }
          ]
        ]
      }
    };

    if (data.candles && data.candles.length > 0) {
      const chartUrl = generateCandleChartUrl(data.ticker, data.candles);
      bot.sendPhoto(chatId, chartUrl, {
        caption: caption,
        parse_mode: 'Markdown',
        ...keyboard
      }).catch(async () => {
        await bot.sendMessage(chatId, caption, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          ...keyboard
        });
      });
    } else {
      await bot.sendMessage(chatId, caption, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...keyboard
      });
    }
  });

  // Callback Query (Sinyal Info)
  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data && data.startsWith('signal_')) {
      const parts = data.split('_');
      const ticker = parts[1];
      const action = parts[2];

      let note = '';
      if (action === 'BUY') {
        note = ` *Trading Plan ${ticker}*:\n` +
               `Terjadi lonjakan akumulasi volume beli. Pertimbangkan entry di area breakout atau saat retest support dengan *Stop Loss* ketat.`;
      } else if (action === 'SELL') {
        note = `⚠️ *Peringatan ${ticker}*:\n` +
               `Terjadi tekanan distribusi/buang barang besar. Hindari *buy on weakness* sebelum volume mereda.`;
      } else {
        note = `⚪ *Catatan ${ticker}*:\n` +
               `Volume transaksi normal tanpa anomali. Tunggu konfirmasi lonjakan (*Spike Score ≥ 1.0*) sebelum entry.`;
      }

      bot.answerCallbackQuery(query.id);
      bot.sendMessage(query.message.chat.id, note, { parse_mode: 'Markdown' });
    }
  });

  // Command: Top Spike
  bot.onText(/^(\/topspike|!topspike|\/screen|!screen)/i, async (msg) => {
    const chatId = msg.chat.id;
    let data = getCachedData();

    if (data.list.length === 0) {
      bot.sendMessage(chatId, '⏳ Memproses pemindaian pasar IDX, mohon tunggu sebentar...', { parse_mode: 'Markdown' });
      data = await triggerScan();
    }

    const top10 = data.list.slice(0, 10);
    let reply = ` *TOP 10 VOLUME SPIKE IDX (DEAN EARWICKER)*\n`;
    reply += `_Update terakhir: ${data.lastScanTime || 'Baru saja'} WIB_\n\n`;

    top10.forEach((p, idx) => {
      const medal = idx === 0 ? '' : idx === 1 ? '' : idx === 2 ? '' : `${idx + 1}.`;
      const tag = p.isSpike ? ' *SPIKE*' : 'Normal';
      reply += `${medal} *${p.ticker}* (${tag})\n`;
      reply += `   Harga: Rp ${p.price.toLocaleString('id-ID')} (${p.changePct > 0 ? '+' : ''}${p.changePct}%)\n`;
      reply += `   Score: *${p.spikeScore}* | Vol Ratio: ${p.volumeRatio}x\n\n`;
    });

    bot.sendMessage(chatId, reply.trim(), { parse_mode: 'Markdown', disable_web_page_preview: true });
  });

  return bot;
}

module.exports = { initTelegram };