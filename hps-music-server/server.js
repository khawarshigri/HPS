// HPS Music Room — school server
// Zero dependencies: run with `node server.js` (Node 18+).
// Serves: the admin dashboard at /admin, the web app at /, and the JSON API at /api.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 30;

/* ---------------- storage (JSON file, written atomically) ---------------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
let db;
function load() {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { db = null; }
  if (!db) db = { users: [], classes: [], progress: {}, sessions: {}, school: 'Habib Public School' };
  db.users ||= []; db.classes ||= []; db.progress ||= {}; db.sessions ||= {};
}
let saveTimer = null;
function save(now) {
  clearTimeout(saveTimer);
  const write = () => { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DB_FILE); };
  if (now) write(); else saveTimer = setTimeout(write, 250);
}
load();

/* ---------------- helpers ---------------- */
const uid = (p) => p + '_' + crypto.randomBytes(6).toString('hex');
function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
}
function checkPw(user, pw) {
  const h = crypto.scryptSync(String(pw), user.salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(user.hash, 'hex'));
}
const cleanUser = (u) => u && ({ id: u.id, role: u.role, name: u.name, username: u.username, classIds: u.classIds || [], createdAt: u.createdAt, lastActive: u.lastActive || null });
const byUsername = (n) => db.users.find((u) => u.username === String(n || '').trim().toLowerCase());
const byId = (id) => db.users.find((u) => u.id === id);
const USER_RX = /^[a-z0-9._-]{3,24}$/;
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c = Array.from(crypto.randomBytes(6), (b) => A[b % A.length]).join(''); } while (db.classes.some((k) => k.code === c));
  return c;
}
function makeUser({ role, name, username, password, classIds }) {
  const un = String(username || '').trim().toLowerCase();
  if (!String(name || '').trim()) throw err(400, 'Please enter a name.');
  if (!USER_RX.test(un)) throw err(400, 'Usernames use 3 to 24 letters or numbers (no spaces).');
  if (byUsername(un)) throw err(409, 'That username is already taken. Try another one.');
  const min = role === 'student' ? 4 : 6;
  if (String(password || '').length < min) throw err(400, `Passwords need at least ${min} characters.`);
  const u = { id: uid(role[0]), role, name: String(name).trim().slice(0, 60), username: un, ...hashPw(password), classIds: classIds || [], createdAt: Date.now() };
  db.users.push(u); save();
  return u;
}
function err(status, message) { const e = new Error(message); e.status = status; return e; }

/* ---------------- seed demo accounts on first run ---------------- */
if (!db.users.length) {
  const admin = makeUser({ role: 'superadmin', name: 'School Admin', username: 'admin', password: 'Admin@123' });
  const t = makeUser({ role: 'teacher', name: 'Ms. Ayesha Khan', username: 'teacher1', password: 'Teacher@123' });
  const cls = { id: uid('c'), name: 'Grade 2 · Music', code: 'HPS2MU', teacherId: t.id, createdAt: Date.now() };
  db.classes.push(cls);
  const s = makeUser({ role: 'student', name: 'Ali Test', username: 'student1', password: 'Student@123', classIds: [cls.id] });
  db.progress[s.id] = { updatedAt: Date.now(), data: {
    'hps-m2-v1': JSON.stringify({ points: 340, stars: { sort: 3, detect: 2, sayit: 3, black: 2, updown: 3, maze: 2, river: 1 } }),
    'm3-music-v2': JSON.stringify({ lessons: { 'violin:first': { score: 900, stars: 3, learned: 1 }, 'piano:twinkle': { score: 1240, stars: 2, learned: 1 } }, tut: { violin: 1, piano: 1 } }),
    'hps-hero-v1': JSON.stringify({ learned: 1, plays: 3, best: { 'piano:lv1:easy': { score: 5200, stars: 3, acc: 94 }, 'piano:lv2:easy': { score: 3900, stars: 2, acc: 81 } } }),
  } };
  s.lastActive = Date.now();
  admin.note = 'seeded'; save(true);
  console.log('Seeded demo accounts: admin / Admin@123, teacher1 / Teacher@123, student1 / Student@123 (class code HPS2MU)');
}

/* ---------------- sessions & rate limit ---------------- */
function newSession(u) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { uid: u.id, exp: Date.now() + SESSION_DAYS * 864e5 };
  u.lastActive = Date.now(); save();
  return token;
}
function auth(req) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  const s = tok && db.sessions[tok];
  if (!s || s.exp < Date.now()) return null;
  const u = byId(s.uid); if (!u) return null;
  return { user: u, token: tok };
}
const hits = new Map();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr); return arr.length > 15;
}
setInterval(() => { const now = Date.now(); for (const [k, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[k]; }, 3600e3).unref();

/* ---------------- permissions ---------------- */
const isSuper = (u) => u.role === 'superadmin';
const isStaff = (u) => u.role === 'teacher' || u.role === 'superadmin';
function classesFor(u) { return isSuper(u) ? db.classes : db.classes.filter((c) => c.teacherId === u.id); }
function canSeeClass(u, c) { return c && (isSuper(u) || c.teacherId === u.id); }
function canSeeStudent(u, s) {
  if (!s || s.role !== 'student') return false;
  if (isSuper(u)) return true;
  const mine = new Set(classesFor(u).map((c) => c.id));
  return (s.classIds || []).some((id) => mine.has(id));
}
function studentOut(s) {
  const p = db.progress[s.id] || {};
  return { ...cleanUser(s), progress: p.data || {}, progressAt: p.updatedAt || null };
}
function classOut(c) {
  const t = byId(c.teacherId);
  return { ...c, teacherName: t ? t.name : '—', teacherUsername: t ? t.username : '', studentCount: db.users.filter((u) => u.role === 'student' && (u.classIds || []).includes(c.id)).length };
}

/* ---------------- API routes ---------------- */
const routes = [];
const route = (m, p, fn) => routes.push({ m, rx: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
const need = (ctx, test) => { if (!ctx.me) throw err(401, 'Please log in again.'); if (test && !test(ctx.me.user)) throw err(403, 'You do not have access to this.'); return ctx.me.user; };

route('GET', '/api/health', () => ({ ok: true, school: db.school }));
route('GET', '/api/catalog', () => JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')));

route('POST', '/api/auth/login', (ctx) => {
  if (limited(ctx.ip)) throw err(429, 'Too many tries. Please wait a minute.');
  const { username, password, role } = ctx.body;
  const u = byUsername(username);
  if (!u || !checkPw(u, password)) throw err(401, 'Wrong username or password.');
  if (role === 'staff' && !isStaff(u)) throw err(403, 'This login is for teachers and admins. Students log in on the app.');
  if (role === 'student' && u.role !== 'student') throw err(403, 'This is a teacher account. Please use the teacher dashboard.');
  return { token: newSession(u), user: cleanUser(u), progress: u.role === 'student' ? (db.progress[u.id] || {}).data || {} : undefined };
});
route('POST', '/api/auth/signup', (ctx) => {
  if (limited(ctx.ip)) throw err(429, 'Too many tries. Please wait a minute.');
  const { name, username, password, classCode } = ctx.body;
  const code = String(classCode || '').trim().toUpperCase();
  const cls = db.classes.find((c) => c.code === code);
  if (!cls) throw err(404, 'We could not find that class code. Please check it with your teacher.');
  const u = makeUser({ role: 'student', name, username, password, classIds: [cls.id] });
  return { token: newSession(u), user: cleanUser(u), className: cls.name, progress: {} };
});
route('POST', '/api/auth/logout', (ctx) => { if (ctx.me) delete db.sessions[ctx.me.token]; save(); return { ok: true }; });
route('GET', '/api/me', (ctx) => { const u = need(ctx); return { user: cleanUser(u), classes: db.classes.filter((c) => (u.classIds || []).includes(c.id)).map((c) => ({ id: c.id, name: c.name, code: c.code })) }; });
route('POST', '/api/me/password', (ctx) => {
  const u = need(ctx); const { oldPassword, newPassword } = ctx.body;
  if (!checkPw(u, oldPassword)) throw err(401, 'Your current password is not right.');
  if (String(newPassword || '').length < (u.role === 'student' ? 4 : 6)) throw err(400, 'That new password is too short.');
  Object.assign(u, hashPw(newPassword)); save(); return { ok: true };
});

// student progress sync
const PROGRESS_KEYS = ['hps-m2-v1', 'm3-music-v2', 'hps-hero-v1', 'hps-lyrics-v1', 'hps-badges-v1'];
route('GET', '/api/progress', (ctx) => { const u = need(ctx, (x) => x.role === 'student'); return (db.progress[u.id] || {}).data || {}; });
route('PUT', '/api/progress', (ctx) => {
  const u = need(ctx, (x) => x.role === 'student');
  const data = {}; for (const k of PROGRESS_KEYS) if (typeof ctx.body[k] === 'string' && ctx.body[k].length < 400000) data[k] = ctx.body[k];
  db.progress[u.id] = { data: { ...((db.progress[u.id] || {}).data || {}), ...data }, updatedAt: Date.now() };
  u.lastActive = Date.now(); save(); return { ok: true, at: db.progress[u.id].updatedAt };
});
route('POST', '/api/student/join', (ctx) => {
  const u = need(ctx, (x) => x.role === 'student');
  const cls = db.classes.find((c) => c.code === String(ctx.body.classCode || '').trim().toUpperCase());
  if (!cls) throw err(404, 'We could not find that class code.');
  u.classIds = [...new Set([...(u.classIds || []), cls.id])]; save(); return { ok: true, className: cls.name };
});

// staff: overview
route('GET', '/api/overview', (ctx) => {
  const u = need(ctx, isStaff);
  const classes = classesFor(u).map(classOut);
  const ids = new Set(classes.map((c) => c.id));
  const students = db.users.filter((s) => s.role === 'student' && (isSuper(u) || (s.classIds || []).some((id) => ids.has(id)))).map(studentOut);
  const teachers = isSuper(u) ? db.users.filter((t) => t.role === 'teacher').map(cleanUser) : undefined;
  return { me: cleanUser(u), school: db.school, classes, students, teachers };
});

// staff: teachers (super admin only)
route('GET', '/api/teachers', (ctx) => { need(ctx, isSuper); return db.users.filter((t) => t.role === 'teacher').map((t) => ({ ...cleanUser(t), classCount: db.classes.filter((c) => c.teacherId === t.id).length })); });
route('POST', '/api/teachers', (ctx) => { need(ctx, isSuper); return cleanUser(makeUser({ role: 'teacher', ...ctx.body })); });
route('PATCH', '/api/teachers/:id', (ctx) => {
  need(ctx, isSuper); const t = byId(ctx.params.id); if (!t || t.role !== 'teacher') throw err(404, 'Teacher not found.');
  if (ctx.body.name) t.name = String(ctx.body.name).trim().slice(0, 60);
  save(); return cleanUser(t);
});
route('DELETE', '/api/teachers/:id', (ctx) => {
  need(ctx, isSuper); const t = byId(ctx.params.id); if (!t || t.role !== 'teacher') throw err(404, 'Teacher not found.');
  const reassign = ctx.query.get('to');
  if (db.classes.some((c) => c.teacherId === t.id)) {
    if (!reassign || !byId(reassign) || byId(reassign).role !== 'teacher') throw err(400, 'Move this teacher\'s classes to another teacher first.');
    db.classes.forEach((c) => { if (c.teacherId === t.id) c.teacherId = reassign; });
  }
  db.users = db.users.filter((x) => x.id !== t.id);
  for (const [k, s] of Object.entries(db.sessions)) if (s.uid === t.id) delete db.sessions[k];
  save(); return { ok: true };
});

// staff: classes
route('GET', '/api/classes', (ctx) => { const u = need(ctx, isStaff); return classesFor(u).map(classOut); });
route('POST', '/api/classes', (ctx) => {
  const u = need(ctx, isStaff); const name = String(ctx.body.name || '').trim();
  if (!name) throw err(400, 'Please give the class a name.');
  let teacherId = u.id;
  if (isSuper(u)) { const t = byId(ctx.body.teacherId); if (!t || t.role !== 'teacher') throw err(400, 'Please choose a teacher for this class.'); teacherId = t.id; }
  const c = { id: uid('c'), name: name.slice(0, 60), code: newCode(), teacherId, createdAt: Date.now() };
  db.classes.push(c); save(); return classOut(c);
});
route('PATCH', '/api/classes/:id', (ctx) => {
  const u = need(ctx, isStaff); const c = db.classes.find((x) => x.id === ctx.params.id); if (!canSeeClass(u, c)) throw err(404, 'Class not found.');
  if (ctx.body.name) c.name = String(ctx.body.name).trim().slice(0, 60);
  if (ctx.body.newCode) c.code = newCode();
  if (isSuper(u) && ctx.body.teacherId) { const t = byId(ctx.body.teacherId); if (t && t.role === 'teacher') c.teacherId = t.id; }
  save(); return classOut(c);
});
route('DELETE', '/api/classes/:id', (ctx) => {
  const u = need(ctx, isStaff); const c = db.classes.find((x) => x.id === ctx.params.id); if (!canSeeClass(u, c)) throw err(404, 'Class not found.');
  db.classes = db.classes.filter((x) => x.id !== c.id);
  db.users.forEach((s) => { if (s.classIds) s.classIds = s.classIds.filter((id) => id !== c.id); });
  save(); return { ok: true };
});
route('GET', '/api/classes/:id/students', (ctx) => {
  const u = need(ctx, isStaff); const c = db.classes.find((x) => x.id === ctx.params.id); if (!canSeeClass(u, c)) throw err(404, 'Class not found.');
  return db.users.filter((s) => s.role === 'student' && (s.classIds || []).includes(c.id)).map(studentOut);
});
route('POST', '/api/classes/:id/students', (ctx) => {
  const u = need(ctx, isStaff); const c = db.classes.find((x) => x.id === ctx.params.id); if (!canSeeClass(u, c)) throw err(404, 'Class not found.');
  if (ctx.body.existing) {
    const s = byUsername(ctx.body.username); if (!s || s.role !== 'student') throw err(404, 'No student has that username.');
    s.classIds = [...new Set([...(s.classIds || []), c.id])]; save(); return studentOut(s);
  }
  return studentOut(makeUser({ role: 'student', name: ctx.body.name, username: ctx.body.username, password: ctx.body.password, classIds: [c.id] }));
});
route('DELETE', '/api/classes/:id/students/:sid', (ctx) => {
  const u = need(ctx, isStaff); const c = db.classes.find((x) => x.id === ctx.params.id); if (!canSeeClass(u, c)) throw err(404, 'Class not found.');
  const s = byId(ctx.params.sid); if (!s) throw err(404, 'Student not found.');
  s.classIds = (s.classIds || []).filter((id) => id !== c.id); save(); return { ok: true };
});

// staff: students
route('GET', '/api/students/:id', (ctx) => { const u = need(ctx, isStaff); const s = byId(ctx.params.id); if (!canSeeStudent(u, s)) throw err(404, 'Student not found.'); return studentOut(s); });
route('PATCH', '/api/students/:id', (ctx) => {
  const u = need(ctx, isStaff); const s = byId(ctx.params.id); if (!canSeeStudent(u, s)) throw err(404, 'Student not found.');
  if (ctx.body.name) s.name = String(ctx.body.name).trim().slice(0, 60);
  save(); return studentOut(s);
});
route('POST', '/api/students', (ctx) => {
  const u = need(ctx, isStaff); const c = db.classes.find((x) => x.id === ctx.body.classId);
  if (!canSeeClass(u, c)) throw err(400, 'Please choose one of your classes for this student.');
  return studentOut(makeUser({ role: 'student', name: ctx.body.name, username: ctx.body.username, password: ctx.body.password, classIds: [c.id] }));
});
route('DELETE', '/api/students/:id', (ctx) => {
  const u = need(ctx, isStaff); const s = byId(ctx.params.id); if (!s || s.role !== 'student' || !canSeeStudent(u, s)) throw err(404, 'Student not found.');
  db.users = db.users.filter((x) => x.id !== s.id); delete db.progress[s.id];
  for (const [k, v] of Object.entries(db.sessions)) if (v.uid === s.id) delete db.sessions[k];
  save(); return { ok: true };
});
route('POST', '/api/users/:id/password', (ctx) => {
  const u = need(ctx, isStaff); const t = byId(ctx.params.id); if (!t) throw err(404, 'User not found.');
  if (!(isSuper(u) || canSeeStudent(u, t))) throw err(403, 'You can only reset passwords for your own students.');
  if (t.role === 'superadmin' && t.id !== u.id) throw err(403, 'You cannot reset another admin\'s password.');
  const pw = String(ctx.body.password || '');
  if (pw.length < (t.role === 'student' ? 4 : 6)) throw err(400, 'That password is too short.');
  Object.assign(t, hashPw(pw));
  for (const [k, v] of Object.entries(db.sessions)) if (v.uid === t.id) delete db.sessions[k];
  save(); return { ok: true };
});

/* ---------------- HTTP server ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body);
}
function serveFile(res, file) {
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(buf);
  });
}
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
    req.on('end', () => {
      const r = routes.find((x) => x.m === req.method && x.rx.test(url.pathname));
      if (!r) return send(res, 404, { error: 'Not found' });
      let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (e) { return send(res, 400, { error: 'Bad request' }); }
      const ctx = { body, params: url.pathname.match(r.rx).groups || {}, query: url.searchParams, me: auth(req), ip: req.socket.remoteAddress };
      try { send(res, 200, r.fn(ctx)); } catch (e) { send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server.' }); if (!e.status) console.error(e); }
    });
    return;
  }
  if (url.pathname === '/admin' || url.pathname === '/admin/') return serveFile(res, path.join(__dirname, 'admin.html'));
  let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  serveFile(res, file);
}).listen(PORT, () => console.log(`HPS Music Room server: http://localhost:${PORT}  ·  dashboard: http://localhost:${PORT}/admin`));
process.on('SIGINT', () => { save(true); process.exit(0); });
process.on('SIGTERM', () => { save(true); process.exit(0); });
