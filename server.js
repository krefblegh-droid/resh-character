// Font glyph support site — zero-dependency Node server.
// Run: ADMIN_PASSWORD=yourpassword node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const IMAGE_DIR = path.join(DATA_DIR, 'images');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_BODY = 8 * 1024 * 1024; // 8 MB (base64 image upload)
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 hours

if (!process.env.ADMIN_PASSWORD) {
  console.warn('WARNING: ADMIN_PASSWORD not set, using default "changeme".');
}

fs.mkdirSync(IMAGE_DIR, { recursive: true });

// ---------- Storage ----------
function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { characters: {} };
  }
}
let db = loadDb();
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- Auth ----------
const tokens = new Map(); // token -> expiry
function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL);
  return token;
}
function isAuthorized(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expiry = tokens.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    tokens.delete(token);
    return false;
  }
  return true;
}
function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- Validation ----------
// Accepts "2588", "u+2588", "U+2588"; returns canonical "2588" or null.
function normalizeCode(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/^U\+/, '');
  if (!/^[0-9A-F]{1,6}$/.test(s)) return null;
  const n = parseInt(s, 16);
  if (n > 0x10ffff) return null;
  return n.toString(16).toUpperCase().padStart(4, '0');
}
// Basic Latin printable only, uppercased.
function normalizeName(raw) {
  const s = String(raw || '').toUpperCase().trim().replace(/\s+/g, ' ');
  if (!s || s.length > 200 || !/^[\x20-\x7E]+$/.test(s)) return null;
  return s;
}
function normalizeFont(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > 100) return null;
  return s;
}
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

// ---------- Helpers ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}
function publicCharacter(c) {
  return {
    code: c.code,
    name: c.name,
    forms: Object.values(c.forms || {}).map((f) => ({
      font: f.font,
      image: '/images/' + f.file,
    })),
  };
}
function allFonts() {
  const set = new Set();
  for (const c of Object.values(db.characters)) {
    for (const f of Object.values(c.forms || {})) set.add(f.font);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
function serveFile(res, baseDir, rel, extraHeaders = {}) {
  const filePath = path.normalize(path.join(baseDir, rel));
  if (!filePath.startsWith(baseDir + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      ...extraHeaders,
    });
  });
}

// ---------- Routes ----------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"

  // POST /api/login
  if (parts[0] === 'login' && req.method === 'POST') {
    const body = await readJson(req);
    if (!passwordMatches(body.password)) return json(res, 401, { error: 'Wrong password' });
    return json(res, 200, { token: issueToken() });
  }

  // GET /api/auth — check whether a token is still valid
  if (parts[0] === 'auth' && req.method === 'GET') {
    return json(res, isAuthorized(req) ? 200 : 401, { ok: isAuthorized(req) });
  }

  // GET /api/fonts
  if (parts[0] === 'fonts' && req.method === 'GET') {
    return json(res, 200, allFonts());
  }

  if (parts[0] === 'characters') {
    // GET /api/characters
    if (parts.length === 1 && req.method === 'GET') {
      const list = Object.values(db.characters)
        .map((c) => ({ code: c.code, name: c.name }))
        .sort((a, b) => parseInt(a.code, 16) - parseInt(b.code, 16));
      return json(res, 200, list);
    }

    // POST /api/characters  { code, name }
    if (parts.length === 1 && req.method === 'POST') {
      if (!isAuthorized(req)) return json(res, 401, { error: 'Not authorized' });
      const body = await readJson(req);
      const code = normalizeCode(body.code);
      const name = normalizeName(body.name);
      if (!code) return json(res, 400, { error: 'Invalid code. Use hex, e.g. 2588.' });
      if (!name) return json(res, 400, { error: 'Invalid name. Use Basic Latin characters only.' });
      if (db.characters[code]) return json(res, 409, { error: `U+${code} is already registered.` });
      db.characters[code] = { code, name, forms: {} };
      saveDb();
      return json(res, 201, publicCharacter(db.characters[code]));
    }

    const code = normalizeCode(parts[1]);
    const char = code && db.characters[code];

    // GET /api/characters/:code
    if (parts.length === 2 && req.method === 'GET') {
      if (!char) return json(res, 404, { error: 'Character not registered' });
      return json(res, 200, publicCharacter(char));
    }

    // POST /api/characters/:code/forms  { font, image: dataURL }
    if (parts.length === 3 && parts[2] === 'forms' && req.method === 'POST') {
      if (!isAuthorized(req)) return json(res, 401, { error: 'Not authorized' });
      if (!char) return json(res, 404, { error: 'Character not registered' });
      const body = await readJson(req);
      const font = normalizeFont(body.font);
      if (!font) return json(res, 400, { error: 'Font name is required.' });
      const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(body.image || ''));
      const ext = m && IMAGE_TYPES[m[1]];
      if (!ext) return json(res, 400, { error: 'Upload a PNG, JPEG, GIF, WebP or SVG image.' });

      const key = font.toLowerCase();
      const old = char.forms[key];
      const file = `${code}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(IMAGE_DIR, file), Buffer.from(m[2], 'base64'));
      if (old) fs.rm(path.join(IMAGE_DIR, old.file), () => {});
      char.forms[key] = { font, file };
      saveDb();
      return json(res, 201, publicCharacter(char));
    }
  }

  json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/images/')) {
      // SVG uploads get a strict CSP so they cannot run scripts.
      return serveFile(res, IMAGE_DIR, url.pathname.slice('/images/'.length), {
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'X-Content-Type-Options': 'nosniff',
      });
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    serveFile(res, PUBLIC_DIR, rel);
  } catch (err) {
    json(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
    if (!err.status) console.error(err);
  }
});

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
