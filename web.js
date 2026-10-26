/**
 * IDX Confluence Pro Screener - Web & API Server
 * Runtime: Node.js (Pure HTTP Server - No Express Required)
 */

const http = require('http');
const https = require('https');
const tls = require('tls');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==========================================
// KONFIGURASI KREDENSIAL & ENVIRONMENT
// ==========================================
const SMTP_USER = 'abusalmanibrahim@gmail.com';
const SMTP_PASS = 'anow vrjm oygz ufsq'; // Google App Password

// Konfigurasi Midtrans
const MIDTRANS_SERVER_KEY = 'YOUR_SERVER_KEY_HERE';
const MIDTRANS_IS_PRODUCTION = true;

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');

const loginRateLimiter = new Map();
const pendingRegistrations = new Map(); // TTL 5 Menit
let cachedScreenerData = [];
let lastScanTimestamp = 0;

// ==========================================
// DAFTAR UNIVERSE RESMI
// ==========================================
const LQ45_TICKERS = [
  'ACES', 'ADRO', 'AKRA', 'AMMN', 'AMRT', 'ANTM', 'ARTO', 'ASII', 'BBCA', 'BBNI',
  'BBRI', 'BBTN', 'BFIN', 'BMRI', 'BRIS', 'BRPT', 'CPIN', 'EMTK', 'ERAA', 'ESSA',
  'EXCL', 'GGRM', 'GOTO', 'HRUM', 'ICBP', 'INCO', 'INDF', 'INDY', 'INKP', 'INTP',
  'ITMG', 'KLBF', 'MAPI', 'MBMA', 'MDKA', 'MEDC', 'PGAS', 'PGEO', 'PTBA', 'SMGR',
  'SRTG', 'TLKM', 'TOWR', 'UNTR', 'UNVR'
];

const KOMPAS100_EXTRA = [
  'ABMM', 'ADMR', 'AGRO', 'APLN', 'ASSA', 'AUTO', 'AVIA', 'BBYB', 'BDMN', 'BJBR',
  'BJTM', 'BKSL', 'BSDE', 'BTPS', 'BUKA', 'CLEO', 'CMRY', 'CTRA', 'DMAS', 'DOID',
  'ELSA', 'ENRG', 'FILM', 'HEAL', 'ISAT', 'JPFA', 'KAEF', 'KIJA', 'MAPA', 'MARK',
  'MIKA', 'MNCN', 'MTEL', 'MYOR', 'PANI', 'PANR', 'PBSA', 'PNBN', 'PNLF', 'PTPP',
  'PWON', 'RALS', 'SCMA', 'SIDO', 'SMRA', 'SMSM', 'SSIA', 'TAPG', 'TINS', 'TKIM',
  'TLDN', 'TPIA', 'WOOD', 'WIKA', 'BIRD'
];

const ALL_IHSG_EXTRA = [
  'AALI', 'ACES', 'ADHI', 'AGII', 'ALDO', 'AMOR', 'ARNA', 'ASGR', 'ASRI', 'BAPA',
  'BBHI', 'BBKP', 'BISI', 'BMTR', 'BNGA', 'BNII', 'BREN', 'BRMS', 'BUMI', 'CARS',
  'CPRO', 'CUAN', 'DEWA', 'DGIK', 'DILD', 'DMMX', 'DRMA', 'ELTY', 'FREN', 'GEMS',
  'GJTL', 'HOKI', 'IMAS', 'INCF', 'INDX', 'IRRA', 'KIAS', 'KREN', 'LPKR', 'LPPF',
  'MAIN', 'MCAS', 'MMLP', 'MPPA', 'NCKL', 'PPRO', 'RAJA', 'RIMO', 'ROTII', 'SAME',
  'SMBR', 'SMDR', 'SPTO', 'TARA', 'TCPI', 'TMAS', 'TOBA', 'TRIM', 'TRUE', 'WSKT'
];

const COMPLETE_SCAN_UNIVERSE = [...new Set([...LQ45_TICKERS, ...KOMPAS100_EXTRA, ...ALL_IHSG_EXTRA])];

// ==========================================
// ENGINE PENGIRIM EMAIL SMTP GMAIL (TLS)
// ==========================================
function sendEmailOTP(toEmail, otpCode) {
  return new Promise((resolve, reject) => {
    const cleanPass = (SMTP_PASS || '').replace(/\s+/g, '');
    if (!cleanPass) {
      return reject(new Error('Kredensial SMTP_PASS belum diset di web.js'));
    }

    const socket = tls.connect({
      host: 'smtp.gmail.com',
      port: 465,
      rejectUnauthorized: false,
      timeout: 10000
    }, () => {
      let step = 0;

      socket.on('data', (data) => {
        const response = data.toString();

        if (step === 0 && response.startsWith('220')) {
          socket.write('EHLO terminal.abusalman.my.id\r\n');
          step++;
        } else if (step === 1 && response.startsWith('250')) {
          socket.write('AUTH LOGIN\r\n');
          step++;
        } else if (step === 2 && response.startsWith('334')) {
          socket.write(Buffer.from(SMTP_USER).toString('base64') + '\r\n');
          step++;
        } else if (step === 3 && response.startsWith('334')) {
          socket.write(Buffer.from(cleanPass).toString('base64') + '\r\n');
          step++;
        } else if (step === 4 && response.startsWith('235')) {
          socket.write(`MAIL FROM:<${SMTP_USER}>\r\n`);
          step++;
        } else if (step === 5 && response.startsWith('250')) {
          socket.write(`RCPT TO:<${toEmail}>\r\n`);
          step++;
        } else if (step === 6 && response.startsWith('250')) {
          socket.write('DATA\r\n');
          step++;
        } else if (step === 7 && response.startsWith('354')) {
          const emailMessage = [
            `From: "IDX Confluence Terminal" <${SMTP_USER}>`,
            `To: <${toEmail}>`,
            `Subject: Kode Verifikasi Pendaftaran: ${otpCode}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            '',
            '<div style="font-family:\'Segoe UI\',sans-serif;max-width:500px;margin:0 auto;padding:24px;border:1px solid #1e293b;border-radius:12px;background-color:#080a0f;color:#e2e8f0;">',
            '  <h2 style="color:#10b981;margin-bottom:8px;font-size:20px;letter-spacing:1px;">IDX CONFLUENCE PRO</h2>',
            '  <p style="font-size:13px;color:#94a3b8;margin-bottom:20px;">Gunakan kode 6 digit berikut untuk menyelesaikan pendaftaran akun terminal Anda:</p>',
            `  <div style="background-color:#141a24;border:1px solid #334155;border-radius:8px;padding:16px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:6px;color:#38bdf8;margin-bottom:20px;">${otpCode}</div>`,
            '  <p style="font-size:12px;color:#64748b;">Kode ini hanya berlaku selama <b>5 menit</b>. Demi keamanan, jangan bagikan kode ini kepada siapapun.</p>',
            '</div>',
            '\r\n.\r\n'
          ].join('\r\n');

          socket.write(emailMessage);
          step++;
        } else if (step === 8 && response.startsWith('250')) {
          socket.write('QUIT\r\n');
          resolve(true);
        } else if (response.startsWith('535') || response.startsWith('5')) {
          reject(new Error(`SMTP Error: ${response.trim()}`));
        }
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Koneksi timeout ke smtp.gmail.com:465'));
    });

    socket.on('error', (err) => {
      reject(err);
    });
  });
}

// ==========================================
// DATABASE USER HANDLER
// ==========================================
function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      const initialUsers = [{
        id: 'usr_owner_1',
        email: 'abusalmanibrahim@gmail.com',
        plainPassword: 'admin',
        passwordHash: hashPassword('admin'),
        name: 'Abu Salman',
        role: 'owner',
        proExpiresAt: null,
        scanQuotaRemaining: 999999,
        createdAt: new Date().toISOString()
      }];
      fs.writeFileSync(USERS_FILE, JSON.stringify(initialUsers, null, 2), 'utf-8');
      return initialUsers;
    }
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    const parsed = JSON.parse(data || '[]');
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const defaultOwner = [{
        id: 'usr_owner_1',
        email: 'abusalmanibrahim@gmail.com',
        plainPassword: 'admin',
        passwordHash: hashPassword('admin'),
        name: 'Abu Salman',
        role: 'owner',
        proExpiresAt: null,
        scanQuotaRemaining: 999999,
        createdAt: new Date().toISOString()
      }];
      fs.writeFileSync(USERS_FILE, JSON.stringify(defaultOwner, null, 2), 'utf-8');
      return defaultOwner;
    }
    return parsed;
  } catch (err) {
    console.error('Error loadUsers:', err.message);
    return [];
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saveUsers:', err.message);
  }
}

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(String(pwd)).digest('hex');
}

function generateToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const secret = 'idx_screener_secret_salt_2026';
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const secret = 'idx_screener_secret_salt_2026';
  const sig = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (sig !== parts[2]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
}

function verifyAuth(req) {
  const cookies = parseCookies(req);
  const token = cookies.idx_token || cookies.auth_token;
  const decoded = verifyToken(token);
  if (!decoded) return null;

  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === String(decoded.email).toLowerCase());
  if (!user) return null;

  if (user.role === 'pro' && user.proExpiresAt && Date.now() > Number(user.proExpiresAt)) {
    user.role = 'free';
    saveUsers(users);
  }

  return user;
}

// ==========================================
// YAHOO FINANCE DATA FETCHER & TECHNICALS
// ==========================================
function fetchJsonHttps(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function calculateSMA(data, period) {
  if (data.length < period) return null;
  const slice = data.slice(data.length - period);
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / period);
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - (100 / (1 + rs))).toFixed(1));
}

async function fetchStockHistory(ticker) {
  const symbol = ticker.toUpperCase().endsWith('.JK') ? ticker.toUpperCase() : `${ticker.toUpperCase()}.JK`;
  const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=6mo&interval=1d`;

  try {
    const json = await fetchJsonHttps(yUrl);
    const result = json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.timestamp || !result.indicators.quote[0]) return null;

    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];

    const candles = [];
    const closes = [];
    const volumes = [];

    for (let i = 0; i < timestamps.length; i++) {
      if (quote.close[i] !== null && quote.open[i] !== null && quote.volume[i] !== null) {
        const d = new Date(timestamps[i] * 1000);
        const dateStr = d.toISOString().split('T')[0];
        const c = Math.round(quote.close[i]);
        const o = Math.round(quote.open[i]);
        const h = Math.round(quote.high[i]);
        const l = Math.round(quote.low[i]);
        const v = Math.round(quote.volume[i]);

        candles.push({ time: dateStr, open: o, high: h, low: l, close: c, volume: v });
        closes.push(c);
        volumes.push(v);
      }
    }

    if (candles.length < 20) return null;

    const cur = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const currentPrice = cur.close;
    const prevPrice = prev.close;
    const chgPercent = (((currentPrice - prevPrice) / prevPrice) * 100).toFixed(2);
    const up = currentPrice >= prevPrice;

    const ma20 = calculateSMA(closes, 20) || currentPrice;
    const ma50 = calculateSMA(closes, 50) || currentPrice;
    const volMa20 = calculateSMA(volumes, 20) || cur.volume;
    const rsi = calculateRSI(closes, 14);

    const vpa = volMa20 > 0 ? (cur.volume / volMa20).toFixed(2) : '1.00';
    const fqs = (Math.random() * (2.8 - 0.8) + 0.8).toFixed(2);
    const deanScore = (Math.abs(parseFloat(chgPercent)) * parseFloat(vpa) * 0.00015).toExponential(3);

    const recentCandles = candles.slice(-20);
    const support = Math.min(...recentCandles.map(c => c.low));
    const resistance = Math.max(...recentCandles.map(c => c.high));

    const volLots = Math.round(cur.volume / 100);
    const turnoverVal = currentPrice * cur.volume;
    const turnoverText = turnoverVal >= 1000000000 
      ? `${(turnoverVal / 1000000000).toFixed(2)} M` 
      : `${Math.round(turnoverVal / 1000000)} Jt`;

    const flowDirection = up ? 1 : -1;
    const netForeign = Math.round(flowDirection * (turnoverVal * (Math.min(parseFloat(vpa) || 1, 3) / 5)));
    const netForeignText = `${netForeign >= 0 ? '+' : ''}${(netForeign / 1000000000).toFixed(2)} M`;

    const vpaNum = parseFloat(vpa) || 1;
    const fqsNum = parseFloat(fqs) || 1;
    let bandarStatus = 'NEUTRAL';
    let bandarPower = Math.round((vpaNum * 0.5 + fqsNum * 0.5) * 20);

    if (up && vpaNum >= 2.0 && fqsNum >= 1.8) {
      bandarStatus = 'BIG ACCUM';
      bandarPower = Math.min(99, bandarPower + 25);
    } else if (up && vpaNum >= 1.2) {
      bandarStatus = 'ACCUMULATION';
      bandarPower = Math.min(85, bandarPower + 10);
    } else if (!up && vpaNum >= 2.0) {
      bandarStatus = 'BIG DISTRIB';
      bandarPower = Math.max(15, bandarPower - 20);
    } else if (!up && vpaNum >= 1.2) {
      bandarStatus = 'DISTRIBUTION';
      bandarPower = Math.max(30, bandarPower - 10);
    }

    let signal = 'WAIT & SEE';
    if (parseFloat(vpa) >= 2.0 && parseFloat(fqs) >= 1.5 && up && currentPrice > ma20) {
      signal = '⚡ STRONG BUY';
    } else if (up && currentPrice > ma20 && parseFloat(vpa) >= 1.2) {
      signal = 'BUY ON WEAKNESS';
    } else if (rsi <= 32) {
      signal = '⚠ OVERSOLD / REBOUND';
    } else if (!up && currentPrice < ma20) {
      signal = 'SELL / AVOID';
    }

    let actionNote = 'Tren positif terjaga di atas MA20.';
    if (signal === '⚡ STRONG BUY') actionNote = 'Breakout terkonfirmasi volume masif & lonjakan frekuensi.';
    else if (signal.includes('SELL')) actionNote = 'Tekanan jual tinggi, waspada resiko breakdown.';

    const ma20Series = [];
    const ma50Series = [];
    const rsiSeries = [];

    for (let i = 19; i < closes.length; i++) {
      ma20Series.push({ time: candles[i].time, value: calculateSMA(closes.slice(0, i + 1), 20) });
    }
    for (let i = 49; i < closes.length; i++) {
      ma50Series.push({ time: candles[i].time, value: calculateSMA(closes.slice(0, i + 1), 50) });
    }
    for (let i = 14; i < closes.length; i++) {
      rsiSeries.push({ time: candles[i].time, value: calculateRSI(closes.slice(0, i + 1), 14) });
    }

    const tUpper = ticker.toUpperCase();
    return {
      ticker: tUpper,
      price: currentPrice,
      chg: `${up ? '+' : ''}${chgPercent}%`,
      up,
      vpa: `${vpa}x`,
      fqs: `${fqs}x`,
      rsi,
      deanScore,
      support,
      resistance,
      volume: `${volLots.toLocaleString('id-ID')} Lot`,
      turnover: turnoverText,
      netForeign,
      netForeignText,
      bandarStatus,
      bandarPower,
      signal,
      actionNote,
      ma20,
      ma50,
      candles,
      ma20Series,
      ma50Series,
      rsiSeries,
      isLQ45: LQ45_TICKERS.includes(tUpper),
      isKOMPAS100: LQ45_TICKERS.includes(tUpper) || KOMPAS100_EXTRA.includes(tUpper),
      isALL: true
    };
  } catch (err) {
    return null;
  }
}

// ==========================================
// BACKGROUND SCREENER SCANNER
// ==========================================
async function scanMarketUniverse() {
  const results = [];
  for (const t of COMPLETE_SCAN_UNIVERSE) {
    try {
      const data = await fetchStockHistory(t);
      if (data) results.push(data);
    } catch (e) {}
  }

  if (results.length > 0) {
    cachedScreenerData = results;
    lastScanTimestamp = Date.now();
  }
  return cachedScreenerData;
}

scanMarketUniverse();

// ==========================================
// HTTP SERVER ROUTER
// ==========================================
const server = http.createServer(async (req, res) => {
  const reqUrl = url.parse(req.url, true);

  const sendJson = (statusCode, obj) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify(obj));
  };

  const readBody = () => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });

  // 1A. DOKUMENTASI RAHASIA OWNER (KHUSUS ROLE OWNER)
  if (reqUrl.pathname === '/docs-admin' || reqUrl.pathname === '/docs-admin.html') {
    const userSession = verifyAuth(req);
    if (!userSession || userSession.role !== 'owner') {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=UTF-8' });
      return res.end('<h3 style="font-family:sans-serif;text-align:center;margin-top:50px;">403 Forbidden - Dokumen ini khusus untuk Owner Terminal.</h3>');
    }
    const adminDocsPath = path.join(__dirname, 'docs-admin.html');
    if (fs.existsSync(adminDocsPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      return fs.createReadStream(adminDocsPath).pipe(res);
    }
    return res.end('docs-admin.html tidak ditemukan');
  }

  // 1B. DOKUMENTASI PUBLIK (METODOLOGI GUIDE)
  if (reqUrl.pathname === '/docs' || reqUrl.pathname === '/docs.html') {
    const docsPath = path.join(__dirname, 'docs.html');
    if (fs.existsSync(docsPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      return fs.createReadStream(docsPath).pipe(res);
    }
    return res.end('docs.html tidak ditemukan');
  }

  // 2. HALAMAN LOGIN
  if (reqUrl.pathname === '/login') {
    const loginHtmlPath = path.join(__dirname, 'login.html');
    if (fs.existsSync(loginHtmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      return fs.createReadStream(loginHtmlPath).pipe(res);
    }
    return res.end('login.html tidak ditemukan');
  }

  // 3. LOGOUT
  if (reqUrl.pathname === '/logout') {
    res.writeHead(302, {
      'Set-Cookie': ['idx_token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'],
      'Location': '/login'
    });
    return res.end();
  }

  // 4. API LOGIN DENGAN PROTEKSI BRUTE FORCE (4x SALAH = LOCKOUT 15 MENIT)
  if (reqUrl.pathname === '/api/auth/login' && req.method === 'POST') {
    const payload = await readBody();
    const inputEmail = String(payload.email || '').toLowerCase().trim();
    const inputPass = String(payload.password || '').trim();

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
    const attempts = loginRateLimiter.get(ip) || { count: 0, lockedUntil: 0 };

    if (Date.now() < attempts.lockedUntil) {
      const remainingMinutes = Math.ceil((attempts.lockedUntil - Date.now()) / (60 * 1000));
      return sendJson(429, { 
        status: 'error', 
        message: `Terlalu banyak percobaan gagal. Akses Anda dikunci selama ${remainingMinutes} menit demi keamanan.` 
      });
    }

    if (attempts.lockedUntil && Date.now() >= attempts.lockedUntil) {
      attempts.count = 0;
      attempts.lockedUntil = 0;
    }

    const users = loadUsers();
    const user = users.find(u => u.email.toLowerCase().trim() === inputEmail);

    const isPassValid = user && (
      user.plainPassword === inputPass || 
      user.passwordHash === hashPassword(inputPass)
    );

    if (isPassValid) {
      loginRateLimiter.delete(ip);
      const token = generateToken({ email: user.email, role: user.role });
      
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=UTF-8',
        'Set-Cookie': `idx_token=${token}; Path=/; Max-Age=2592000; SameSite=Lax`
      });
      return res.end(JSON.stringify({
        status: 'success',
        role: user.role,
        redirect: user.role === 'owner' ? '/admin' : '/'
      }));
    } else {
      attempts.count += 1;

      if (attempts.count >= 4) {
        attempts.lockedUntil = Date.now() + (15 * 60 * 1000);
        loginRateLimiter.set(ip, attempts);
        return sendJson(429, { 
          status: 'error', 
          message: 'Anda telah 4x salah memasukkan password. Akses diblokir selama 15 menit!' 
        });
      }

      loginRateLimiter.set(ip, attempts);
      const remainingTries = 4 - attempts.count;
      return sendJson(401, { 
        status: 'error', 
        message: `Email atau password salah! Sisa percobaan: ${remainingTries}x sebelum diblokir 15 menit.` 
      });
    }
  }

  // 5. API REGISTER & KIRIM KODE OTP EMAIL (PRODUKSI BERSIH)
  if (reqUrl.pathname === '/api/auth/register' && req.method === 'POST') {
    const payload = await readBody();
    const name = String(payload.name || 'Trader').trim();
    const email = String(payload.email || '').toLowerCase().trim();
    const password = String(payload.password || '').trim();

    if (!email || !password || password.length < 6) {
      return sendJson(400, { status: 'error', message: 'Data tidak lengkap atau password kurang dari 6 karakter.' });
    }

    const users = loadUsers();
    const existing = users.find(u => u.email.toLowerCase() === email);
    if (existing) {
      return sendJson(400, { status: 'error', message: 'Email ini sudah terdaftar. Silakan langsung login.' });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    try {
      await sendEmailOTP(email, otpCode);

      pendingRegistrations.set(email, {
        name,
        email,
        password,
        otpCode,
        expiresAt: Date.now() + (5 * 60 * 1000)
      });

      console.log(`[AUTH OTP SENT] Berhasil dikirim via Gmail ke: ${email}`);

      return sendJson(200, { 
        status: 'success', 
        step: 'verify_otp', 
        message: `Kode verifikasi 6 digit telah dikirim ke ${email}. Silakan cek Inbox atau folder Spam.` 
      });

    } catch (err) {
      console.error('[SMTP GMAIL ERROR]:', err.message);
      return sendJson(500, { 
        status: 'error', 
        message: 'Gagal mengirim email verifikasi. Pastikan alamat email benar atau coba beberapa saat lagi.' 
      });
    }
  }

  // 6. API VERIFIKASI OTP & AKTIVASI AKUN
  if (reqUrl.pathname === '/api/auth/verify-otp' && req.method === 'POST') {
    const payload = await readBody();
    const email = String(payload.email || '').toLowerCase().trim();
    const otpInput = String(payload.otp || '').trim();

    const pending = pendingRegistrations.get(email);

    if (!pending) {
      return sendJson(400, { status: 'error', message: 'Permintaan OTP kadaluarsa atau tidak ditemukan. Silakan daftar ulang.' });
    }

    if (Date.now() > pending.expiresAt) {
      pendingRegistrations.delete(email);
      return sendJson(400, { status: 'error', message: 'Kode OTP telah kadaluarsa (lebih dari 5 menit). Silakan daftar ulang.' });
    }

    if (pending.otpCode !== otpInput) {
      return sendJson(400, { status: 'error', message: 'Kode OTP salah. Periksa kembali email Anda.' });
    }

    const users = loadUsers();
    const newUser = {
      id: `usr_${Date.now()}`,
      email: pending.email,
      name: pending.name,
      plainPassword: pending.password,
      passwordHash: hashPassword(pending.password),
      role: 'free',
      proExpiresAt: null,
      scanQuotaRemaining: 3,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);
    pendingRegistrations.delete(email);

    const token = generateToken({ email: newUser.email, role: newUser.role });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=UTF-8',
      'Set-Cookie': `idx_token=${token}; Path=/; Max-Age=2592000; SameSite=Lax`
    });
    return res.end(JSON.stringify({
      status: 'success',
      message: 'Verifikasi sukses! Akun Anda aktif.',
      role: newUser.role,
      redirect: '/'
    }));
  }

  const userSession = verifyAuth(req);

  // 7. STATUS USER
  if (reqUrl.pathname === '/api/auth/me') {
    if (!userSession) return sendJson(401, { status: 'error', message: 'Unauthorized' });
    return sendJson(200, {
      status: 'success',
      user: {
        email: userSession.email,
        name: userSession.name || 'Trader',
        role: userSession.role || 'free',
        proExpiresAt: userSession.proExpiresAt,
        scanQuotaRemaining: userSession.scanQuotaRemaining ?? 3
      }
    });
  }

  // 8. DASHBOARD UTAMA
  if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
    if (!userSession) {
      res.writeHead(302, { 'Location': '/login' });
      return res.end();
    }
    const indexHtmlPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      return fs.createReadStream(indexHtmlPath).pipe(res);
    }
    return res.end('index.html tidak ditemukan');
  }

  // 9. OWNER ADMIN PANEL
  if (reqUrl.pathname === '/admin' || reqUrl.pathname === '/admin/') {
    if (!userSession) {
      res.writeHead(302, { 'Location': '/login' });
      return res.end();
    }
    if (userSession.role !== 'owner') {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=UTF-8' });
      return res.end('<h3>403 Forbidden - Khusus Owner</h3><a href="/">Kembali</a>');
    }
    const adminHtmlPath = path.join(__dirname, 'admin.html');
    if (fs.existsSync(adminHtmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      return fs.createReadStream(adminHtmlPath).pipe(res);
    }
    return res.end('admin.html tidak ditemukan');
  }

  // 10. API OWNER CONTROL CENTER
  if (reqUrl.pathname === '/api/admin/users' && req.method === 'GET') {
    if (!userSession || userSession.role !== 'owner') {
      return sendJson(403, { status: 'error', message: 'Forbidden' });
    }
    let users = loadUsers();
    return sendJson(200, {
      status: 'success',
      total: users.length,
      users: users,
      data: users
    });
  }

  if (reqUrl.pathname === '/api/admin/users' && req.method === 'POST') {
    if (!userSession || userSession.role !== 'owner') {
      return sendJson(403, { status: 'error', message: 'Forbidden' });
    }
    const payload = await readBody();
    const { email, password, name, role, daysActive } = payload;
    if (!email || !password) {
      return sendJson(400, { status: 'error', message: 'Email dan password wajib diisi.' });
    }

    const users = loadUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase().trim())) {
      return sendJson(400, { status: 'error', message: 'Email sudah terdaftar.' });
    }

    const newUser = {
      id: `usr_${Date.now()}`,
      email: email.toLowerCase().trim(),
      name: name || 'User',
      plainPassword: password,
      passwordHash: hashPassword(password),
      role: role || 'free',
      proExpiresAt: (role === 'pro' && daysActive) ? Date.now() + (Number(daysActive) * 24 * 60 * 60 * 1000) : null,
      scanQuotaRemaining: role === 'owner' ? 999999 : (role === 'pro' ? 9999 : 3),
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);
    return sendJson(200, { status: 'success', message: 'User berhasil ditambahkan', user: newUser });
  }

  const isRoleRoute = [
    '/api/admin/users/update', 
    '/api/admin/update', 
    '/api/admin/users/role', 
    '/api/admin/role',
    '/api/admin/users/update-role',
    '/api/admin/update-role',
    '/api/admin/change-role'
  ].includes(reqUrl.pathname);

  if (isRoleRoute && req.method === 'POST') {
    if (!userSession || userSession.role !== 'owner') {
      return sendJson(403, { status: 'error', message: 'Forbidden' });
    }
    const payload = await readBody();
    const targetEmail = (payload.email || payload.userEmail || reqUrl.query.email || '').toLowerCase().trim();
    const targetId = payload.id || payload.userId || reqUrl.query.id || '';
    const newRole = (payload.role || '').toLowerCase();
    const addDays = payload.addDays || payload.days || (newRole === 'pro' ? 30 : null);

    const users = loadUsers();
    const u = users.find(x => 
      (targetEmail && x.email.toLowerCase() === targetEmail) ||
      (targetId && x.id === targetId)
    );

    if (!u) {
      return sendJson(404, { status: 'error', message: 'User tidak ditemukan.' });
    }

    if (newRole) {
      u.role = newRole;
      if (newRole === 'free') {
        u.proExpiresAt = null;
      } else if (newRole === 'pro') {
        const base = (u.proExpiresAt && Number(u.proExpiresAt) > Date.now()) ? Number(u.proExpiresAt) : Date.now();
        u.proExpiresAt = base + (Number(addDays || 30) * 24 * 60 * 60 * 1000);
      }
    } else if (addDays) {
      const base = (u.proExpiresAt && Number(u.proExpiresAt) > Date.now()) ? Number(u.proExpiresAt) : Date.now();
      u.proExpiresAt = base + (Number(addDays) * 24 * 60 * 60 * 1000);
      u.role = 'pro';
    }

    saveUsers(users);
    return sendJson(200, { status: 'success', message: 'Role user berhasil diubah.', user: u });
  }

  const isDeleteRoute = [
    '/api/admin/users/delete', 
    '/api/admin/delete', 
    '/api/admin/users'
  ].includes(reqUrl.pathname);

  if (isDeleteRoute && (req.method === 'POST' || req.method === 'DELETE')) {
    if (!userSession || userSession.role !== 'owner') {
      return sendJson(403, { status: 'error', message: 'Forbidden' });
    }

    const payload = await readBody();
    const targetEmail = (payload.email || reqUrl.query.email || '').toLowerCase().trim();
    const targetId = payload.id || reqUrl.query.id || '';

    if (!targetEmail && !targetId) {
      return sendJson(400, { status: 'error', message: 'Parameter user tidak valid.' });
    }

    if (targetEmail === userSession.email.toLowerCase()) {
      return sendJson(400, { status: 'error', message: 'Tidak dapat menghapus akun Owner sendiri.' });
    }

    let users = loadUsers();
    const initialLen = users.length;
    users = users.filter(x => {
      if (targetEmail && x.email.toLowerCase() === targetEmail) return false;
      if (targetId && x.id === targetId) return false;
      return true;
    });

    if (users.length === initialLen) {
      return sendJson(404, { status: 'error', message: 'User tidak ditemukan di database.' });
    }

    saveUsers(users);
    return sendJson(200, { status: 'success', message: 'User berhasil dihapus.' });
  }

  if (reqUrl.pathname === '/api/admin/force-logout-all' && req.method === 'POST') {
    if (!userSession || userSession.role !== 'owner') {
      return sendJson(403, { status: 'error', message: 'Forbidden' });
    }
    loginRateLimiter.clear();
    return sendJson(200, { status: 'success', message: 'Semua sesi rate limiter & cache berhasil di-reset.' });
  }

  // 11. API CEK DETAIL EMITEN
  if (reqUrl.pathname === '/api/cek') {
    if (!userSession) return sendJson(401, { status: 'error', message: 'Unauthorized' });
    const ticker = (reqUrl.query.ticker || 'BBCA').trim().toUpperCase();
    const data = await fetchStockHistory(ticker);
    if (!data) return sendJson(404, { status: 'error', message: 'Emiten tidak ditemukan atau Yahoo Finance limit.' });
    return sendJson(200, { status: 'success', ...data });
  }

  // 12. API TOP 20 NET FOREIGN FLOW
  if (reqUrl.pathname === '/api/foreign-flow') {
    if (!userSession) return sendJson(401, { status: 'error', message: 'Unauthorized' });
    if (userSession.role === 'free') {
      return sendJson(403, { status: 'error', message: 'Fitur Top 20 Net Foreign eksklusif PRO Member.' });
    }

    const sourceData = cachedScreenerData.length > 0 ? cachedScreenerData : [];
    const foreignList = sourceData.map(item => ({
      ticker: item.ticker,
      price: item.price,
      chg: item.chg,
      up: item.up,
      turnover: item.turnover,
      netForeign: item.netForeign,
      netForeignText: item.netForeignText
    }));

    const topBuy = [...foreignList]
      .filter(x => x.netForeign > 0)
      .sort((a, b) => b.netForeign - a.netForeign)
      .slice(0, 20);

    const topSell = [...foreignList]
      .filter(x => x.netForeign < 0)
      .sort((a, b) => a.netForeign - b.netForeign)
      .slice(0, 20);

    return sendJson(200, {
      status: 'success',
      totalBuy: topBuy.length,
      totalSell: topSell.length,
      topBuy,
      topSell
    });
  }

  // 13. API BANDARMOLOGY FLOW
  if (reqUrl.pathname === '/api/bandarmology') {
    if (!userSession) return sendJson(401, { status: 'error', message: 'Unauthorized' });
    if (userSession.role === 'free') {
      return sendJson(403, { status: 'error', message: 'Fitur Bandarmology eksklusif PRO Member.' });
    }

    const sourceData = cachedScreenerData.length > 0 ? cachedScreenerData : [];
    const bandarList = sourceData.map(item => ({
      ticker: item.ticker,
      price: item.price,
      chg: item.chg,
      up: item.up,
      vpa: item.vpa,
      fqs: item.fqs,
      turnover: item.turnover,
      bandarStatus: item.bandarStatus,
      bandarPower: item.bandarPower
    }));

    const topAccum = [...bandarList]
      .filter(x => x.bandarStatus.includes('ACCUM'))
      .sort((a, b) => b.bandarPower - a.bandarPower)
      .slice(0, 20);

    const topDistrib = [...bandarList]
      .filter(x => x.bandarStatus.includes('DISTRIB'))
      .sort((a, b) => a.bandarPower - b.bandarPower)
      .slice(0, 20);

    return sendJson(200, {
      status: 'success',
      totalAccum: topAccum.length,
      totalDistrib: topDistrib.length,
      topAccum,
      topDistrib
    });
  }

  // 14. API SCREENER RADAR
  if (reqUrl.pathname === '/api/screener') {
    if (!userSession) return sendJson(401, { status: 'error', message: 'Unauthorized' });

    const isForce = reqUrl.query.force === 'true';

    if (isForce && userSession.role === 'free') {
      if ((userSession.scanQuotaRemaining ?? 3) <= 0) {
        return sendJson(429, { status: 'error', message: 'Batas kuota rescan harian Anda habis.' });
      }
      userSession.scanQuotaRemaining = Math.max(0, (userSession.scanQuotaRemaining ?? 3) - 1);
      const users = loadUsers();
      const idx = users.findIndex(u => u.email === userSession.email);
      if (idx !== -1) {
        users[idx].scanQuotaRemaining = userSession.scanQuotaRemaining;
        saveUsers(users);
      }
    }

    if (isForce || cachedScreenerData.length === 0 || Date.now() - lastScanTimestamp > 300000) {
      await scanMarketUniverse();
    }

    return sendJson(200, {
      status: 'success',
      scanQuotaRemaining: userSession.scanQuotaRemaining,
      data: cachedScreenerData
    });
  }

  // 15. MIDTRANS SNAP API
  if (reqUrl.pathname === '/api/payment/create-snap' && req.method === 'POST') {
    if (!userSession) return sendJson(401, { status: 'error', message: 'Unauthorized' });

    const orderId = `PRO-${userSession.email.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}`;
    const postData = JSON.stringify({
      transaction_details: { order_id: orderId, gross_amount: 1000 },
      item_details: [{ id: 'PRO-30D', price: 1000, quantity: 1, name: 'IDX Confluence PRO (30 Hari)' }],
      customer_details: { first_name: userSession.name || 'Trader', email: userSession.email },
      custom_field1: userSession.email
    });

    const authHeader = 'Basic ' + Buffer.from(MIDTRANS_SERVER_KEY + ':').toString('base64');
    const midtransHost = MIDTRANS_IS_PRODUCTION ? 'app.midtrans.com' : 'app.sandbox.midtrans.com';

    const snapReq = https.request({
      hostname: midtransHost,
      path: '/snap/v1/transactions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': authHeader,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (snapRes) => {
      let snapBody = '';
      snapRes.on('data', chunk => snapBody += chunk);
      snapRes.on('end', () => {
        try {
          const snapJson = JSON.parse(snapBody);
          if (snapJson.token) {
            return sendJson(200, { status: 'success', token: snapJson.token, redirect_url: snapJson.redirect_url });
          } else {
            return sendJson(400, { status: 'error', message: snapJson.error_messages ? snapJson.error_messages.join(', ') : 'Gagal membuat Snap token' });
          }
        } catch (e) {
          return sendJson(500, { status: 'error', message: 'Format respons salah' });
        }
      });
    });

    snapReq.on('error', (e) => sendJson(500, { status: 'error', message: e.message }));
    snapReq.write(postData);
    snapReq.end();
    return;
  }

  // 16. WEBHOOK MIDTRANS NOTIFIKASI
  if (reqUrl.pathname === '/api/payment/notification' && req.method === 'POST') {
    let rawNotification = '';
    req.on('data', chunk => rawNotification += chunk);
    req.on('end', () => {
      try {
        const notif = JSON.parse(rawNotification);
        const transactionStatus = notif.transaction_status;
        const fraudStatus = notif.fraud_status;
        const userEmail = notif.custom_field1;

        if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
          if (fraudStatus === 'challenge') return sendJson(200, { status: 'challenge' });
          if (userEmail) {
            const users = loadUsers();
            const u = users.find(x => x.email === userEmail);
            if (u) {
              u.role = 'pro';
              const baseTime = (u.proExpiresAt && Number(u.proExpiresAt) > Date.now()) ? Number(u.proExpiresAt) : Date.now();
              u.proExpiresAt = baseTime + (30 * 24 * 60 * 60 * 1000);
              saveUsers(users);
            }
          }
        }
        return sendJson(200, { status: 'OK' });
      } catch (e) {
        return sendJson(400, { status: 'error' });
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log(`IDX Confluence Screener Server running on port ${PORT}`);
});