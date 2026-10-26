const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const USERS_FILE = path.join(__dirname, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_idx_token_key_2026_nas';
const TOKEN_AGE = 7 * 24 * 60 * 60 * 1000; // 7 Hari aktif

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, JSON.stringify([]), 'utf8');
      return [];
    }
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// Update timestamp lastActive ke users.json
function touchUserActivity(userId) {
  try {
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      const now = new Date().toISOString();
      // Update jika selisih waktu lebih dari 30 detik untuk menghemat I/O disk NAS
      const last = users[idx].lastActive ? new Date(users[idx].lastActive).getTime() : 0;
      if (Date.now() - last > 30000) {
        users[idx].lastActive = now;
        saveUsers(users);
      }
    }
  } catch (e) {}
}

// Handler Registrasi
async function handleRegister(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { email, password, name } = JSON.parse(body);
      const cleanEmail = (email || '').trim().toLowerCase();

      if (!cleanEmail || !password || password.length < 6) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', message: 'Email valid & password minimal 6 karakter diperlukan.' }));
      }

      const users = loadUsers();
      const existing = users.find(u => u.email === cleanEmail);
      if (existing) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', message: 'Email sudah terdaftar. Silakan login.' }));
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const now = new Date().toISOString();
      const newUser = {
        id: 'user_' + Date.now(),
        name: name ? name.trim() : cleanEmail.split('@')[0],
        email: cleanEmail,
        password: hashedPassword,
        plainPassword: password,
        role: 'user',
        createdAt: now,
        lastActive: now
      };

      users.push(newUser);
      saveUsers(users);

      const token = jwt.sign({ id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });
      const setCookie = cookie.serialize('idx_token', token, {
        httpOnly: true,
        maxAge: TOKEN_AGE / 1000,
        path: '/',
        sameSite: 'lax'
      });

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': setCookie
      });
      res.end(JSON.stringify({ status: 'success', message: 'Registrasi berhasil!', user: { name: newUser.name, email: newUser.email } }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Gagal memproses pendaftaran.' }));
    }
  });
}

// Handler Login
async function handleLogin(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { email, password } = JSON.parse(body);
      const cleanEmail = (email || '').trim().toLowerCase();

      const users = loadUsers();
      const userIndex = users.findIndex(u => u.email === cleanEmail);
      if (userIndex === -1) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', message: 'Email atau password salah.' }));
      }

      const user = users[userIndex];
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', message: 'Email atau password salah.' }));
      }

      // Catat aktif saat login
      users[userIndex].lastActive = new Date().toISOString();
      saveUsers(users);

      const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '7d' });
      const setCookie = cookie.serialize('idx_token', token, {
        httpOnly: true,
        maxAge: TOKEN_AGE / 1000,
        path: '/',
        sameSite: 'lax'
      });

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': setCookie
      });
      res.end(JSON.stringify({ status: 'success', message: 'Login sukses!', user: { name: user.name, email: user.email } }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Internal login error.' }));
    }
  });
}

// Handler Logout
function handleLogout(req, res) {
  const setCookie = cookie.serialize('idx_token', '', {
    httpOnly: true,
    maxAge: 0,
    path: '/'
  });
  res.writeHead(302, {
    'Set-Cookie': setCookie,
    'Location': '/login'
  });
  res.end();
}

// Middleware Verifikasi Cookie JWT + Auto Touch Activity
function verifyAuth(req) {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const token = cookies.idx_token;
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded && decoded.id) {
      touchUserActivity(decoded.id);
    }
    return decoded;
  } catch (e) {
    return null;
  }
}

module.exports = {
  loadUsers,
  saveUsers,
  touchUserActivity,
  handleRegister,
  handleLogin,
  handleLogout,
  verifyAuth
};