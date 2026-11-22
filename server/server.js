'use strict';
/**
 * 관리자 전용 로컬 서버 (관리자 PC에서만 실행한다. 공개 사이트는 docs/ 의 순수 정적 파일이다.)
 *
 *  - 127.0.0.1 에만 바인딩한다 (외부 접속 불가)
 *  - 비밀번호 로그인 + HttpOnly/SameSite=Strict 쿠키
 *  - 채점 폴더 업로드 → docs/reviews/<id>/ 에 저장, docs/data/index.json 갱신
 *  - "배포" 버튼 → git add/commit/push
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const REVIEWS = path.join(DOCS, 'reviews');
const INDEX_FILE = path.join(DOCS, 'data', 'index.json');
const STAGING = path.join(ROOT, '.staging');
const ADMIN_DIR = path.join(__dirname, 'admin');
const CONFIG_FILE = path.join(ROOT, 'admin.config.json');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

const MAX_FILE = 50 * 1024 * 1024; // 파일 1개
const MAX_FILES = 600; // 채점지 1개당 파일 수
const MAX_TOTAL = 300 * 1024 * 1024; // 채점지 1개당 총 용량
const ALLOWED_EXT = new Set([
  '.html', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.css', '.js', '.json', '.ttf', '.otf', '.woff', '.woff2', '.txt', '.md',
]);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

const FONT_PATCH = '<style data-gr-font>@font-face{font-family:"Pretendard Variable";src:url("../../assets/fonts/PretendardVariable.woff2") format("woff2-variations");font-weight:45 920;font-display:swap}'
  + 'body{font-family:"Pretendard Variable",Pretendard,"Malgun Gothic",system-ui,sans-serif!important}</style>';

/* ---------- 비밀번호 / 세션 ---------- */
function loadPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try {
    const pw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).password;
    if (pw) return String(pw);
  } catch { /* 없으면 새로 만든다 */ }
  const pw = crypto.randomBytes(6).toString('base64url');
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ password: pw }, null, 2) + '\n');
  console.log(`\n  관리자 비밀번호를 새로 만들었다: ${pw}`);
  console.log(`  (${CONFIG_FILE} 에 저장됨. 바꾸려면 이 파일을 고치면 된다.)\n`);
  return pw;
}
const PASSWORD = loadPassword();

const sessions = new Map(); // token -> 만료 시각
const SESSION_MS = 8 * 60 * 60 * 1000;
let failCount = 0;
let lockUntil = 0;

function sameString(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function cookieToken(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function isAuthed(req) {
  const t = cookieToken(req);
  if (!t) return false;
  const exp = sessions.get(t);
  if (!exp || exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}

/* ---------- 유틸 ---------- */
function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, 64 * 1024);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('JSON 형식 오류'), { status: 400 }); }
}
function safeRel(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s) return null;
  const parts = s.split('/');
  if (parts.some((x) => x === '' || x === '.' || x === '..' || /[:*?"<>|\x00-\x1f]/.test(x))) return null;
  return parts.join('/');
}
function inside(base, target) {
  const rel = path.relative(base, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
function readIndex() {
  try {
    const j = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    return { updatedAt: j.updatedAt || null, items: Array.isArray(j.items) ? j.items : [] };
  } catch {
    return { updatedAt: null, items: [] };
  }
}
function writeIndex(idx) {
  idx.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  const tmp = INDEX_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2) + '\n');
  fs.renameSync(tmp, INDEX_FILE);
}
function normName(s) {
  return String(s).normalize('NFC').replace(/\s+/g, '').toLowerCase();
}
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/* review.html 에서 점수 등을 뽑는다 (data-count 순서: 총점, 주관, 객관, 감점) */
function parseReview(html) {
  const nums = [...html.matchAll(/data-count="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
  const [total, subjective, objective, deduction] = nums;
  const pick = (v) => (Number.isFinite(v) ? v : null);
  return {
    total: pick(total), subjective: pick(subjective), objective: pick(objective), deduction: pick(deduction),
    target: (html.match(/대상:\s*<code>([^<]+)<\/code>/) || [])[1] || null,
  };
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  // 다른 사이트에서 오는 요청 차단 (CSRF)
  if (method !== 'GET') {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${HOST}:${PORT}` && origin !== `http://localhost:${PORT}`) {
      return send(res, 403, { error: '허용되지 않은 요청이다.' });
    }
  }

  if (pathname === '/api/login' && method === 'POST') {
    if (Date.now() < lockUntil) return send(res, 429, { error: '잠시 후 다시 시도해 주세요.' });
    const { password } = await readJson(req);
    if (!sameString(password ?? '', PASSWORD)) {
      failCount += 1;
      if (failCount >= 5) { lockUntil = Date.now() + 30 * 1000; failCount = 0; }
      return send(res, 401, { error: '비밀번호가 맞지 않다.' });
    }
    failCount = 0;
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`,
    });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    const t = cookieToken(req);
    if (t) sessions.delete(t);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (!isAuthed(req)) return send(res, 401, { error: '로그인이 필요하다.' });

  if (pathname === '/api/me' && method === 'GET') return send(res, 200, { ok: true });

  if (pathname === '/api/reviews' && method === 'GET') return send(res, 200, readIndex());

  // 업로드 시작
  if (pathname === '/api/upload/begin' && method === 'POST') {
    const id = crypto.randomBytes(6).toString('hex');
    fs.mkdirSync(path.join(STAGING, id), { recursive: true });
    return send(res, 200, { uploadId: id });
  }

  // 파일 1개 업로드: POST /api/upload/<id>/file?path=상대경로 (본문 = 파일 바이트)
  let m = /^\/api\/upload\/([a-f0-9]{12})\/file$/.exec(pathname);
  if (m && method === 'POST') {
    const dir = path.join(STAGING, m[1]);
    if (!fs.existsSync(dir)) return send(res, 404, { error: '업로드 세션이 없다.' });
    const rel = safeRel(url.searchParams.get('path'));
    if (!rel) return send(res, 400, { error: '잘못된 파일 경로다.' });
    if (!ALLOWED_EXT.has(path.extname(rel).toLowerCase())) return send(res, 415, { error: `허용하지 않는 파일 형식이다: ${rel}` });
    const target = path.join(dir, ...rel.split('/'));
    if (!inside(dir, target)) return send(res, 400, { error: '잘못된 파일 경로다.' });
    const { count, bytes } = dirStats(dir);
    if (count >= MAX_FILES) return send(res, 413, { error: `파일이 ${MAX_FILES}개를 넘는다.` });
    const body = await readBody(req, MAX_FILE);
    if (bytes + body.length > MAX_TOTAL) return send(res, 413, { error: '채점지 총 용량이 너무 크다.' });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    return send(res, 200, { ok: true });
  }

  // 업로드 완료: 이름을 받아 docs/reviews 에 반영
  m = /^\/api\/upload\/([a-f0-9]{12})\/commit$/.exec(pathname);
  if (m && method === 'POST') {
    const stage = path.join(STAGING, m[1]);
    if (!fs.existsSync(stage)) return send(res, 404, { error: '업로드 세션이 없다.' });
    const body = await readJson(req);
    const name = String(body.name || '').normalize('NFC').trim();
    if (!name || name.length > 30) return send(res, 400, { error: '이름은 1~30자로 입력해 주세요.' });
    const reviewFile = path.join(stage, 'review.html');
    if (!fs.existsSync(reviewFile)) return send(res, 400, { error: '폴더 맨 위에 review.html 이 있어야 한다.' });

    const idx = readIndex();
    const dup = idx.items.find((x) => normName(x.name) === normName(name));
    if (dup && !body.replace) return send(res, 409, { error: '이미 등록된 이름이다.', exists: true });

    const reviewHtml = fs.readFileSync(reviewFile, 'utf8');
    const { caseErrors, missing } = checkRefs(stage, reviewHtml);
    if (caseErrors.length) {
      return send(res, 422, { error: `파일 이름의 대소문자가 달라서 배포 후 이미지가 깨져요. 고친 뒤 다시 올려 주세요.\n${caseErrors.slice(0, 5).join('\n')}` });
    }
    const parsed = parseReview(reviewHtml);
    // 원본이 가리키는 ../assets/fonts 는 배포본에 없으므로, 사이트와 같은 Pretendard 를 주입한다 (한 번만)
    if (!reviewHtml.includes('data-gr-font')) {
      fs.writeFileSync(reviewFile, reviewHtml.replace(/<\/head>/i, FONT_PATCH + '</head>'));
    }
    const id = m[1];
    fs.mkdirSync(REVIEWS, { recursive: true });
    fs.renameSync(stage, path.join(REVIEWS, id));
    if (dup) {
      rmDir(path.join(REVIEWS, dup.id));
      idx.items = idx.items.filter((x) => x.id !== dup.id);
    }
    const item = { id, name, addedAt: new Date().toISOString(), max: 35, ...parsed };
    idx.items.push(item);
    writeIndex(idx);
    return send(res, 200, { ok: true, item, replaced: Boolean(dup), missing: missing.slice(0, 10), missingCount: missing.length });
  }

  // 업로드 취소
  m = /^\/api\/upload\/([a-f0-9]{12})$/.exec(pathname);
  if (m && method === 'DELETE') {
    rmDir(path.join(STAGING, m[1]));
    return send(res, 200, { ok: true });
  }

  // 채점지 삭제
  m = /^\/api\/reviews\/([a-f0-9]{12})$/.exec(pathname);
  if (m && method === 'DELETE') {
    const idx = readIndex();
    if (!idx.items.some((x) => x.id === m[1])) return send(res, 404, { error: '없는 채점지다.' });
    idx.items = idx.items.filter((x) => x.id !== m[1]);
    writeIndex(idx);
    rmDir(path.join(REVIEWS, m[1]));
    return send(res, 200, { ok: true });
  }

  // GitHub 로 배포 (git add / commit / push)
  if (pathname === '/api/publish' && method === 'POST') {
    try {
      const log = [];
      const git = (args) => new Promise((resolve, reject) => {
        execFile('git', args, { cwd: ROOT, timeout: 120000, windowsHide: true }, (err, stdout, stderr) => {
          const out = `${stdout}${stderr}`.trim();
          if (err) reject(Object.assign(new Error(out || err.message), { out }));
          else resolve(out);
        });
      });
      await git(['add', '-A', 'docs']);
      const status = await git(['status', '--porcelain', 'docs']);
      if (status) {
        log.push(await git(['commit', '-m', '채점 결과 갱신', '--', 'docs']));
      } else {
        log.push('새로 올릴 변경이 없다.');
      }
      log.push(await git(['push', '-u', 'origin', 'HEAD']));
      return send(res, 200, { ok: true, log: log.filter(Boolean).join('\n') });
    } catch (e) {
      return send(res, 500, { error: `배포 실패: ${e.message}` });
    }
  }

  return send(res, 404, { error: '없는 API다.' });
}

/**
 * review.html 이 가리키는 파일이 폴더에 있는지 확인한다.
 * Windows 는 대소문자를 구분하지 않지만 GitHub Pages 는 구분하므로, 대소문자만 다른 참조는 배포 후 깨진다.
 */
function checkRefs(stageDir, html) {
  const exact = new Set();
  const lower = new Map();
  const walk = (d, p) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), p + e.name + '/');
      else { exact.add(p + e.name); lower.set((p + e.name).toLowerCase(), p + e.name); }
    }
  };
  walk(stageDir, '');
  const refs = new Set();
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#?]+)["']/gi)) refs.add(m[1]);
  for (const m of html.matchAll(/url\(\s*["']?([^"')#?]+)["']?\s*\)/gi)) refs.add(m[1]);
  const caseErrors = [];
  const missing = [];
  for (let r of refs) {
    r = r.trim();
    if (!r || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|\.\.)/i.test(r)) continue; // 외부 주소, data:, 절대/상위 경로는 건너뜀
    try { r = decodeURIComponent(r); } catch { /* 그대로 */ }
    r = r.replace(/^\.\//, '');
    if (exact.has(r)) continue;
    const hit = lower.get(r.toLowerCase());
    if (hit) caseErrors.push(`${r} → 실제 파일은 ${hit}`);
    else missing.push(r);
  }
  return { caseErrors, missing };
}

function dirStats(dir) {
  let count = 0;
  let bytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { count += 1; bytes += fs.statSync(p).size; }
    }
  };
  walk(dir);
  return { count, bytes };
}

/* ---------- 정적 파일 ---------- */
function serveStatic(res, base, rel) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return send(res, 400, 'Bad Request'); }
  let target = path.join(base, decoded);
  if (target !== base && !inside(base, target)) return send(res, 403, 'Forbidden');
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    const ext = path.extname(target).toLowerCase();
    const data = fs.readFileSync(target);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch {
    send(res, 404, 'Not Found');
  }
}

/* ---------- 서버 ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/site' ) { res.writeHead(302, { Location: '/site/' }); return res.end(); }
    if (url.pathname.startsWith('/site/')) return serveStatic(res, DOCS, url.pathname.slice('/site/'.length));
    return serveStatic(res, ADMIN_DIR, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : '서버 오류가 났다.' });
    if (!e.status) console.error(e);
  }
});

fs.mkdirSync(REVIEWS, { recursive: true });
rmDir(STAGING); // 이전에 끊긴 업로드 정리
server.listen(PORT, HOST, () => {
  console.log(`관리자 페이지  http://localhost:${PORT}/`);
  console.log(`공개 사이트 미리보기  http://localhost:${PORT}/site/`);
});
