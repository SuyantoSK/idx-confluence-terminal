const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'idx_confluence_super_secret_jwt_2026';
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const OWNER_EMAIL = 'abusalmanibrahim@gmail.com';

const USERS_FILE = path.join(__dirname, 'users.json');

// Tracker Memory Real-Time (Bebas dari masalah selisih jam server/UTC)
const onlineTracker = new Map(); // key: email lowercase, value: Date.now()

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors());

function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, '[]', 'utf8');
      return [];
    }
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    return [];
  }
}

function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {}
}

function markUserOnline(identifier) {
  if (!identifier) return;
  const key = String(identifier).trim().toLowerCase();
  onlineTracker.set(key, Date.now());
}

// Middleware Auth Umum
function authenticateUser(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) return res.redirect('/login');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    markUserOnline(decoded.email);
    if (decoded.id) markUserOnline(decoded.id);
    next();
  } catch (err) {
    res.clearCookie('auth_token');
    return res.redirect('/login');
  }
}

// Middleware Khusus Owner
function requireOwner(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ status: 'error', message: 'Silakan login.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'owner' && decoded.email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
      return res.status(403).json({ status: 'error', message: 'Akses khusus Owner.' });
    }
    req.user = decoded;
    markUserOnline(decoded.email);
    if (decoded.id) markUserOnline(decoded.id);
    next();
  } catch (err) {
    res.clearCookie('auth_token');
    return res.status(401).json({ status: 'error', message: 'Sesi kedaluwarsa.' });
  }
}

// Routes Web Pages
app.get('/', authenticateUser, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', authenticateUser, (req, res) => {
  if (req.user.role !== 'owner' && req.user.email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/login', (req, res) => {
  const token = req.cookies.auth_token;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return res.redirect('/');
    } catch (e) {}
  }
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/logout', (req, res) => {
  if (req.user && req.user.email) {
    onlineTracker.delete(req.user.email.toLowerCase());
  }
  res.clearCookie('auth_token');
  res.redirect('/login');
});

// APIs
app.get('/api/auth/config', (req, res) => {
  res.json({ siteKey: TURNSTILE_SITE_KEY });
});

app.get('/api/auth/me', authenticateUser, (req, res) => {
  res.json({ status: 'success', user: req.user });
});

// Heartbeat Endpoint
app.post('/api/heartbeat', authenticateUser, (req, res) => {
  markUserOnline(req.user.email);
  if (req.user.id) markUserOnline(req.user.id);
  res.json({ status: 'success' });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const users = readUsers();

    const userIndex = users.findIndex(u => u.email.toLowerCase() === cleanEmail);
    if (userIndex === -1) {
      return res.status(401).json({ status: 'error', message: 'Email atau password salah.' });
    }

    const user = users[userIndex];
    const match = await bcrypt.compare(password, user.password);
    if (!match && password !== user.plainPassword) {
      return res.status(401).json({ status: 'error', message: 'Email atau password salah.' });
    }

    if (cleanEmail === OWNER_EMAIL.toLowerCase() && user.role !== 'owner') {
      user.role = 'owner';
      writeUsers(users);
    }

    markUserOnline(user.email);
    markUserOnline(user.id);

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({ status: 'success', role: user.role });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Gagal login.' });
  }
});

// API Owner: Ambil Daftar Seluruh Pengguna & Status Online Real-Time
app.get('/api/admin/users', requireOwner, (req, res) => {
  markUserOnline(req.user.email);
  if (req.user.id) markUserOnline(req.user.id);

  const users = readUsers();
  const now = Date.now();
  const THRESHOLD = 3 * 60 * 1000; // 3 Menit aktif

  const list = users.map(u => {
    const userEmailKey = (u.email || '').toLowerCase();
    const userIdKey = (u.id || '').toLowerCase();
    
    const lastActiveTime = onlineTracker.get(userEmailKey) || onlineTracker.get(userIdKey) || 0;
    const isOnline = (now - lastActiveTime) < THRESHOLD;

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      plainPassword: u.plainPassword || '(Versi lama hash)',
      role: u.role,
      createdAt: u.createdAt,
      isOnline: isOnline // Nilai boolean pasti dari server
    };
  });

  res.json({ status: 'success', data: list });
});

// API Owner: Tambah User
app.post('/api/admin/users', requireOwner, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ status: 'error', message: 'Data tidak lengkap.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const users = readUsers();
    if (users.find(u => u.email.toLowerCase() === cleanEmail)) {
      return res.status(400).json({ status: 'error', message: 'Email sudah terdaftar.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: 'usr_' + Date.now(),
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword,
      plainPassword: password,
      role: role || 'user',
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    writeUsers(users);
    res.json({ status: 'success', message: 'User berhasil ditambahkan.' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Gagal menambah user.' });
  }
});

// API Owner: Edit User
app.put('/api/admin/users/:id', requireOwner, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const users = readUsers();
    const target = users.find(u => u.id === req.params.id);
    if (!target) {
      return res.status(404).json({ status: 'error', message: 'User tidak ditemukan.' });
    }

    if (name) target.name = name.trim();
    if (email) target.email = email.trim().toLowerCase();
    if (role) target.role = role;
    if (password && password.trim().length > 0) {
      target.password = await bcrypt.hash(password, 10);
      target.plainPassword = password;
    }

    writeUsers(users);
    res.json({ status: 'success', message: 'Data user berhasil diperbarui.' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Gagal mengubah data user.' });
  }
});

// API Owner: Hapus User
app.delete('/api/admin/users/:id', requireOwner, (req, res) => {
  let users = readUsers();
  const target = users.find(u => u.id === req.params.id);
  if (target && target.email.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
    return res.status(400).json({ status: 'error', message: 'Akun Owner tidak bisa dihapus.' });
  }
  users = users.filter(u => u.id !== req.params.id);
  writeUsers(users);
  res.json({ status: 'success', message: 'User berhasil dihapus.' });
});

// Load Screener Engine
try {
  const screenerModule = require('./screener');
  if (typeof screenerModule === 'function') screenerModule(app);
} catch (e) {}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});