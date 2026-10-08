const express = require('express'), Database = require('better-sqlite3'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production');

// ---------- Database ----------
const db = new Database(process.env.DB_FILE || 'careerpilot.db');
db.pragma('foreign_keys=ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT, pass TEXT NOT NULL,
  role TEXT DEFAULT 'Full Stack Developer', industry TEXT DEFAULT '', company TEXT DEFAULT '', months INTEGER DEFAULT 6, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, data TEXT NOT NULL, done INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_items ON items(user_id, kind);`);

// ---------- Field specs: [name, type, required] ----------
const SPEC = {
  projects: [['title','text',1],['description','long'],['technologies','text'],['link','url'],['role','text'],['start','date'],['end','date']],
  certifications: [['name','text',1],['issuer','text',1],['issued','date'],['credentialId','text'],['url','url']],
  experience: [['company','text',1],['role','text',1],['location','text'],['start','date'],['end','date'],['description','long'],['technologies','text']],
  skills: [['name','text',1],['level','num',1]],
  milestones: [['title','text',1],['description','long'],['week','num']],
};
const LIM = { text: 200, long: 2000, date: 10, url: 500 };
const ROLES = {
  'Full Stack Developer': ['React','Node.js','SQL','Git','REST APIs','System Design','DSA'],
  'Backend Developer': ['Node.js','SQL','REST APIs','Docker','System Design','DSA','Git'],
  'Frontend Developer': ['HTML/CSS','JavaScript','React','Git','Testing','Accessibility'],
  'Data Analyst': ['SQL','Python','Excel','Statistics','Data Visualization','Data Cleaning'],
  'ML Engineer': ['Python','Statistics','Machine Learning','Deep Learning','SQL','MLOps'],
};
function clean(kind, b) {
  const d = {};
  for (const [f, t, req] of SPEC[kind]) {
    let v = b[f]; if (v == null || v === '') v = undefined;
    if (v === undefined) { if (req) return { err: `${f} is required` }; continue; }
    if (t === 'num') {
      const lo = f === 'level' ? 1 : 0, hi = f === 'level' ? 5 : 52; v = Number(v);
      if (!Number.isInteger(v) || v < lo || v > hi) return { err: `${f} must be a whole number from ${lo} to ${hi}` };
    } else {
      if (typeof v !== 'string') return { err: `${f} must be text` };
      v = v.trim(); if (v.length > LIM[t]) return { err: `${f} is too long` };
      if (t === 'url' && !/^https?:\/\/\S+$/.test(v)) return { err: `${f} must be a valid http(s) link` };
      if (t === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { err: `${f} must be a valid date` };
    }
    d[f] = v;
  }
  return { d };
}

// ---------- Helpers ----------
const row = r => ({ id: r.id, done: !!r.done, ...JSON.parse(r.data) });
const list = (uid, kind) => db.prepare('SELECT * FROM items WHERE user_id=? AND kind=? ORDER BY id').all(uid, kind).map(row);
const getUser = uid => db.prepare('SELECT * FROM users WHERE id=?').get(uid);
const pub = ({ pass, ...u }) => u;
const bad = (r, m, c = 400) => r.status(c).json({ error: m });
const sign = u => jwt.sign({ uid: u.id }, SECRET, { expiresIn: '7d' });
const wrap = fn => (q, r, n) => Promise.resolve(fn(q, r, n)).catch(e => { console.error(e); bad(r, 'Server error', 500); });

function auth(q, r, n) {
  try {
    q.uid = jwt.verify((q.headers.authorization || '').slice(7), SECRET).uid;
    if (!getUser(q.uid)) throw 0; n();
  } catch { bad(r, 'Please log in again', 401); }
}

// ---------- Skill gap, progress ----------
function gap(uid) {
  const u = getUser(uid), have = {};
  for (const s of list(uid, 'skills')) have[s.name.toLowerCase()] = Math.max(have[s.name.toLowerCase()] || 0, s.level);
  const rank = { High: 0, Medium: 1, Low: 2 };
  return (ROLES[u.role] || ROLES['Full Stack Developer']).map(skill => {
    const l = have[skill.toLowerCase()] || 0;
    return { skill, level: l, status: l >= 4 ? 'Strong' : l === 3 ? 'Already known' : l ? 'Needs improvement' : 'Missing', priority: !l ? 'High' : l < 3 ? 'Medium' : 'Low' };
  }).sort((a, b) => rank[a.priority] - rank[b.priority]);
}
function progress(uid) {
  const g = gap(uid), ms = list(uid, 'milestones');
  const c = { skillsReq: g.length, skillsHave: g.filter(x => x.level >= 3).length, projects: list(uid, 'projects').length,
    certs: list(uid, 'certifications').length, experience: list(uid, 'experience').length, msDone: ms.filter(m => m.done).length, msTotal: ms.length };
  const parts = {
    skills: Math.round(g.reduce((a, x) => a + Math.min(x.level, 3) / 3, 0) / g.length * 100),
    projects: Math.round(Math.min(c.projects / 5, 1) * 100), certifications: Math.round(Math.min(c.certs / 2, 1) * 100),
    experience: Math.round(Math.min(c.experience / 2, 1) * 100), milestones: c.msTotal ? Math.round(c.msDone / c.msTotal * 100) : 0,
  };
  const readiness = Math.round(parts.skills * .35 + parts.projects * .2 + parts.certifications * .1 + parts.experience * .15 + parts.milestones * .2);
  return { g, ms, c, parts, readiness };
}

// ---------- AI (Anthropic API when key is set, rule-based fallback otherwise) ----------
async function callAI(system, messages) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-sonnet-4-6', max_tokens: 800, system, messages }),
    });
    if (!r.ok) return null;
    return (await r.json()).content.map(c => c.text || '').join('');
  } catch { return null; }
}
function context(uid) {
  const u = getUser(uid), p = progress(uid);
  return JSON.stringify({ targetRole: u.role, industry: u.industry, company: u.company, timelineMonths: u.months, readiness: p.readiness,
    skills: list(uid, 'skills').map(s => `${s.name} (${s.level}/5)`), projects: list(uid, 'projects').map(x => x.title),
    certifications: list(uid, 'certifications').map(x => x.name), experience: list(uid, 'experience').map(x => `${x.role} @ ${x.company}`),
    skillGaps: p.g.filter(x => x.priority !== 'Low').map(x => `${x.skill}: ${x.status}`), pendingMilestones: p.ms.filter(m => !m.done).map(m => m.title) });
}
const QBANK = skill => [`Explain the core concepts of ${skill} and where you have used it.`, `What common mistakes do people make with ${skill}, and how do you avoid them?`];
const HR = ['Tell me about yourself and why you want this role.', 'Describe a project you are proud of and your part in it.', 'Tell me about a time you had to learn something quickly.'];

// ---------- App ----------
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use((q, r, n) => { r.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' }); n(); });
app.use(express.static('public'));

app.post('/api/auth/register', (q, r) => {
  const { name, email, phone, password } = q.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 100) return bad(r, 'Enter your full name');
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) return bad(r, 'Enter a valid email address');
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) return bad(r, 'Password must be at least 8 characters');
  try {
    const i = db.prepare('INSERT INTO users(name,email,phone,pass) VALUES(?,?,?,?)').run(name.trim(), email.toLowerCase(), String(phone || '').slice(0, 20), bcrypt.hashSync(password, 10));
    const u = getUser(i.lastInsertRowid); r.status(201).json({ token: sign(u), user: pub(u) });
  } catch { bad(r, 'An account with this email already exists', 409); }
});
app.post('/api/auth/login', (q, r) => {
  const { email, password } = q.body || {};
  const u = typeof email === 'string' && typeof password === 'string' && db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.pass)) return bad(r, 'Incorrect email or password', 401);
  r.json({ token: sign(u), user: pub(u) });
});

app.get('/api/roles', (q, r) => r.json(Object.keys(ROLES)));
app.get('/api/schema', (q, r) => r.json(SPEC));
app.get('/api/me', auth, (q, r) => r.json(pub(getUser(q.uid))));
app.put('/api/me', auth, (q, r) => {
  const b = q.body || {}, u = getUser(q.uid), o = {};
  o.role = b.role ?? u.role; if (!ROLES[o.role]) return bad(r, 'Choose a role from the list');
  for (const f of ['name', 'industry', 'company', 'phone']) { o[f] = String(b[f] ?? u[f] ?? '').trim().slice(0, 100); }
  if (!o.name) return bad(r, 'Name is required');
  o.months = Number(b.months ?? u.months); if (!Number.isInteger(o.months) || o.months < 1 || o.months > 36) return bad(r, 'Timeline must be 1-36 months');
  db.prepare('UPDATE users SET name=?,role=?,industry=?,company=?,phone=?,months=? WHERE id=?').run(o.name, o.role, o.industry, o.company, o.phone, o.months, q.uid);
  r.json(pub(getUser(q.uid)));
});

app.get('/api/dashboard', auth, (q, r) => {
  const p = progress(q.uid), pending = p.ms.filter(m => !m.done), top = p.g.find(x => x.priority !== 'Low');
  const next = pending[0] ? { title: pending[0].title, text: pending[0].description || 'Complete this milestone to move your roadmap forward.' }
    : top ? { title: `Build your ${top.skill} skills`, text: `${top.skill} is a ${top.priority.toLowerCase()}-priority gap for your target role.` }
    : { title: 'Generate or refresh your roadmap', text: 'Add skills and projects, then update your roadmap.' };
  r.json({ user: pub(getUser(q.uid)), readiness: p.readiness, parts: p.parts, counts: p.c, gap: p.g, next, upcoming: pending[0] || null, tasks: pending.slice(0, 4) });
});
app.get('/api/skillgap', auth, (q, r) => { const p = progress(q.uid); r.json({ role: getUser(q.uid).role, match: p.parts.skills, gap: p.g }); });
app.get('/api/progress', auth, (q, r) => { const p = progress(q.uid); r.json({ readiness: p.readiness, parts: p.parts, counts: p.c, milestones: p.ms }); });

app.post('/api/roadmap/generate', auth, (q, r) => {
  const u = getUser(q.uid), p = progress(q.uid), have = new Set(p.ms.map(m => m.title)), add = [];
  p.g.filter(x => x.priority !== 'Low').forEach((x, i) => add.push({ title: `Learn ${x.skill}`, description: `Raise ${x.skill} to level 3+ (currently ${x.level}/5).`, week: Math.min(i * 2 + 1, 52) }));
  if (p.c.projects < 5) add.push({ title: `Build a ${u.role} portfolio project`, description: 'Ship a project that uses your newly learned skills.', week: Math.round(u.months * 2) });
  if (p.c.certs < 2) add.push({ title: 'Earn a role-relevant certification', description: 'Pick one recognised certification for your target role.', week: Math.round(u.months * 3) });
  add.push({ title: 'Practise interviews', description: 'Work through the interview questions and run an AI mock interview.', week: Math.round(u.months * 4) });
  const ins = db.prepare('INSERT INTO items(user_id,kind,data) VALUES(?,?,?)');
  let n = 0; for (const m of add) if (!have.has(m.title)) { ins.run(q.uid, 'milestones', JSON.stringify(m)); n++; }
  r.json({ added: n, milestones: list(q.uid, 'milestones') });
});

app.get('/api/interview/questions', auth, (q, r) => {
  const g = gap(q.uid).filter(x => x.priority !== 'Low').slice(0, 4);
  r.json({ technical: g.flatMap(x => QBANK(x.skill).map(t => ({ skill: x.skill, question: t }))), behavioural: HR });
});
app.post('/api/ai/recommend', auth, wrap(async (q, r) => {
  const question = typeof q.body?.question === 'string' ? q.body.question.slice(0, 500) : '';
  const text = await callAI('You are CareerPilot AI, a concise career coach. Use only this user data to give specific, prioritised advice (max 150 words): ' + context(q.uid),
    [{ role: 'user', content: question || 'Give me my top 3 next actions.' }]);
  if (text) return r.json({ text, source: 'ai' });
  const p = progress(q.uid), top = p.g.filter(x => x.priority !== 'Low').slice(0, 3);
  r.json({ source: 'rules', text: top.length ? `Focus on: ${top.map((x, i) => `${i + 1}. ${x.skill} (${x.status})`).join('  ')}. Then ship one project that uses them.` : 'Your skills cover the target role. Add projects or certifications to raise your readiness.' });
}));
app.post('/api/ai/mock', auth, wrap(async (q, r) => {
  const m = q.body?.messages;
  if (!Array.isArray(m) || m.length > 20 || !m.every(x => ['user', 'assistant'].includes(x?.role) && typeof x.content === 'string' && x.content.length <= 2000) || (m.length && m[m.length - 1].role !== 'user')) return bad(r, 'Invalid messages');
  const msgs = m.length ? m : [{ role: 'user', content: 'Start the interview.' }];
  const text = await callAI('You are a mock interviewer for this candidate. Ask ONE question at a time, give brief feedback on the previous answer, keep replies under 120 words. Candidate data: ' + context(q.uid), msgs);
  if (text) return r.json({ text, source: 'ai' });
  const qs = [...gap(q.uid).filter(x => x.priority !== 'Low').flatMap(x => QBANK(x.skill)), ...HR], i = Math.floor(m.length / 2) % qs.length;
  r.json({ source: 'rules', text: (m.length ? 'Thanks. Next question: ' : 'Let us begin. ') + qs[i] });
}));

// Generic user-scoped CRUD: projects, certifications, experience, skills, milestones
const known = (q, r, n) => SPEC[q.params.kind] ? n() : n('route');
app.get('/api/:kind', auth, known, (q, r) => r.json(list(q.uid, q.params.kind)));
app.get('/api/:kind/:id', auth, known, (q, r) => {
  const x = db.prepare('SELECT * FROM items WHERE id=? AND user_id=? AND kind=?').get(+q.params.id, q.uid, q.params.kind);
  x ? r.json(row(x)) : bad(r, 'Not found', 404);
});
app.post('/api/:kind', auth, known, (q, r) => {
  const { d, err } = clean(q.params.kind, q.body || {}); if (err) return bad(r, err);
  const i = db.prepare('INSERT INTO items(user_id,kind,data) VALUES(?,?,?)').run(q.uid, q.params.kind, JSON.stringify(d));
  r.status(201).json(row(db.prepare('SELECT * FROM items WHERE id=?').get(i.lastInsertRowid)));
});
app.put('/api/:kind/:id', auth, known, (q, r) => {
  const x = db.prepare('SELECT * FROM items WHERE id=? AND user_id=? AND kind=?').get(+q.params.id, q.uid, q.params.kind);
  if (!x) return bad(r, 'Not found', 404);
  const { d, err } = clean(q.params.kind, { ...JSON.parse(x.data), ...(q.body || {}) }); if (err) return bad(r, err);
  const done = q.params.kind === 'milestones' && 'done' in (q.body || {}) ? (q.body.done ? 1 : 0) : x.done;
  db.prepare('UPDATE items SET data=?,done=? WHERE id=? AND user_id=?').run(JSON.stringify(d), done, x.id, q.uid);
  r.json(row(db.prepare('SELECT * FROM items WHERE id=?').get(x.id)));
});
app.delete('/api/:kind/:id', auth, known, (q, r) => {
  const i = db.prepare('DELETE FROM items WHERE id=? AND user_id=? AND kind=?').run(+q.params.id, q.uid, q.params.kind);
  i.changes ? r.json({ ok: true }) : bad(r, 'Not found', 404);
});

app.use('/api', (q, r) => bad(r, 'Not found', 404));
app.use((e, q, r, n) => { console.error(e); bad(r, e.type === 'entity.parse.failed' ? 'Invalid JSON' : 'Server error', e.type === 'entity.parse.failed' ? 400 : 500); });
app.listen(process.env.PORT || 3000, () => console.log('CareerPilot AI on http://localhost:' + (process.env.PORT || 3000)));