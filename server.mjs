import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const dataFile = path.join(dataDir, 'campus-planner.json');
const port = Number(process.env.PORT || 4173);
const sessions = new Map();
const sessionTtl = 7 * 24 * 60 * 60 * 1000;

await mkdir(dataDir, { recursive: true });
if (!existsSync(dataFile)) await writeFile(dataFile, JSON.stringify({ users: [], events: [] }, null, 2));

async function readDb() {
  return JSON.parse(await readFile(dataFile, 'utf8'));
}
async function writeDb(db) {
  const temp = `${dataFile}.tmp`;
  await writeFile(temp, JSON.stringify(db, null, 2), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(temp, dataFile);
}
function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}
function cookieValue(req, name) {
  const item = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}
function currentUser(req) {
  const key = cookieValue(req, 'cp_session');
  const session = sessions.get(key);
  if (!session || session.expires < Date.now()) { if (key) sessions.delete(key); return null; }
  session.expires = Date.now() + sessionTtl;
  return session.userId;
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 32_000) throw new Error('요청이 너무 큽니다.'); }
  return raw ? JSON.parse(raw) : {};
}
function cleanText(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
const validTypes = ['과제', '시험', '강의'];
const validPriorities = ['높음', '보통', '낮음'];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'GET' && url.pathname === '/api/me') {
        const userId = currentUser(req);
        if (!userId) return send(res, 200, { user: null });
        const db = await readDb();
        const user = db.users.find(item => item.id === userId);
        return send(res, 200, { user: user ? { id: user.id, email: user.email } : null });
      }
      if (req.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(url.pathname)) {
        const input = await body(req);
        const email = cleanText(input.email, 254).toLowerCase();
        const password = typeof input.password === 'string' ? input.password : '';
        if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: '올바른 이메일 주소를 입력해 주세요.' });
        const db = await readDb();
        let user = db.users.find(item => item.email === email);
        if (url.pathname.endsWith('/register')) {
          if (password.length < 8 || password.length > 64) return send(res, 400, { error: '비밀번호는 8~64자로 입력해 주세요.' });
          if (input.confirmPassword !== password) return send(res, 400, { error: '비밀번호가 일치하지 않습니다.' });
          if (user) return send(res, 409, { error: '이미 가입된 이메일입니다.' });
          const salt = randomBytes(16).toString('hex');
          const hash = (await scrypt(password, salt, 64)).toString('hex');
          user = { id: randomBytes(16).toString('hex'), email, salt, passwordHash: hash, createdAt: new Date().toISOString() };
          db.users.push(user);
          await writeDb(db);
        } else {
          if (!user) return send(res, 401, { error: '이메일 또는 비밀번호를 확인해 주세요.' });
          const hash = await scrypt(password, user.salt, 64);
          const expected = Buffer.from(user.passwordHash, 'hex');
          if (hash.length !== expected.length || !timingSafeEqual(hash, expected)) return send(res, 401, { error: '이메일 또는 비밀번호를 확인해 주세요.' });
        }
        const token = randomBytes(32).toString('base64url');
        sessions.set(token, { userId: user.id, expires: Date.now() + sessionTtl });
        return send(res, 200, { user: { id: user.id, email: user.email } }, { 'set-cookie': `cp_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionTtl / 1000}` });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        sessions.delete(cookieValue(req, 'cp_session'));
        return send(res, 200, { ok: true }, { 'set-cookie': 'cp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      }
      const userId = currentUser(req);
      if (!userId) return send(res, 401, { error: '로그인이 필요합니다.' });
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const db = await readDb();
        return send(res, 200, { events: db.events.filter(item => item.userId === userId) });
      }
      if (req.method === 'POST' && url.pathname === '/api/events') {
        const input = await body(req);
        const subject = cleanText(input.subject, 31), title = cleanText(input.title, 61), date = cleanText(input.date, 10);
        if (!subject) return send(res, 400, { error: '과목명을 입력해 주세요.' });
        if (subject.length > 30) return send(res, 400, { error: '과목명은 30자 이하로 입력해 주세요.' });
        if (!title) return send(res, 400, { error: '일정 제목을 입력해 주세요.' });
        if (title.length > 60) return send(res, 400, { error: '일정 제목은 60자 이하로 입력해 주세요.' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`))) return send(res, 400, { error: '올바른 날짜를 선택해 주세요.' });
        if (!validTypes.includes(input.type) || !validPriorities.includes(input.priority)) return send(res, 400, { error: '일정 종류와 중요도를 확인해 주세요.' });
        const event = { id: randomBytes(12).toString('hex'), userId, subject, title, type: input.type, date, priority: input.priority, completed: false, createdAt: new Date().toISOString() };
        const db = await readDb(); db.events.push(event); await writeDb(db);
        return send(res, 201, { event });
      }
      const match = url.pathname.match(/^\/api\/events\/([a-f0-9]+)$/);
      if (match) {
        const db = await readDb();
        const event = db.events.find(item => item.id === match[1] && item.userId === userId);
        if (!event) return send(res, 404, { error: '해당 일정에 접근할 권한이 없습니다.' });
        if (req.method === 'PATCH') {
          const input = await body(req);
          if (typeof input.completed === 'boolean' && Object.keys(input).length === 1) event.completed = input.completed;
          else {
            const subject = cleanText(input.subject, 31), title = cleanText(input.title, 61), date = cleanText(input.date, 10);
            if (!subject) return send(res, 400, { error: '과목명을 입력해 주세요.' });
            if (subject.length > 30) return send(res, 400, { error: '과목명은 30자 이하로 입력해 주세요.' });
            if (!title) return send(res, 400, { error: '일정 제목을 입력해 주세요.' });
            if (title.length > 60) return send(res, 400, { error: '일정 제목은 60자 이하로 입력해 주세요.' });
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`))) return send(res, 400, { error: '올바른 날짜를 선택해 주세요.' });
            if (!validTypes.includes(input.type) || !validPriorities.includes(input.priority)) return send(res, 400, { error: '일정 종류와 중요도를 확인해 주세요.' });
            Object.assign(event, { subject, title, date, type: input.type, priority: input.priority });
          }
          await writeDb(db); return send(res, 200, { event });
        }
        if (req.method === 'DELETE') {
          db.events = db.events.filter(item => item.id !== event.id); await writeDb(db); return send(res, 200, { ok: true });
        }
      }
      return send(res, 404, { error: '요청을 찾을 수 없습니다.' });
    }
    const target = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!['/index.html', '/styles.css', '/app.js'].includes(target)) { res.writeHead(404); return res.end(); }
    const file = path.resolve(root, `.${target}`);
    if (!file.startsWith(`${root}${path.sep}`)) { res.writeHead(403); return res.end(); }
    const content = await readFile(file);
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }); res.end(content);
  } catch (error) {
    if (error instanceof SyntaxError) return send(res, 400, { error: '요청 형식을 확인해 주세요.' });
    console.error(error);
    return send(res, 500, { error: '요청을 처리하지 못했습니다. 다시 시도해 주세요.' });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Campus Planner is ready at http://127.0.0.1:${port}`));
