const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = () => localStorage.getItem('cp_token');
let user = null, schema = null, loginMode = false;

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/auth')) logout();
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}
function toast(m, bad) {
  const t = document.createElement('div'); t.textContent = m; t.setAttribute('role', 'status');
  t.style.cssText = `position:fixed;top:16px;right:16px;z-index:99;padding:12px 18px;border-radius:10px;color:#fff;font-weight:600;font-size:13px;background:${bad ? 'var(--red)' : 'var(--green)'};box-shadow:var(--shadow)`;
  document.body.append(t); setTimeout(() => t.remove(), 3200);
}
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

// ---------- Auth ----------
const _show = show;
show = id => { if (id === 'dash' && !token()) { toast('Please sign up or log in first', true); id = 'signup'; } _show(id); if (id === 'dash') go(curTab || 'home'); };
function logout() { localStorage.removeItem('cp_token'); user = null; _show('landing'); }

const form = $('#authForm');
function setMode(login) {
  loginMode = login;
  $$('#n,#p', form).forEach(i => { i.closest('.field').hidden = login; i.required = !login && i.id === 'n'; });
  $('h3', form).textContent = login ? 'Welcome back' : 'Create Your Account';
  $('button', form).textContent = login ? 'Log in →' : 'Continue →';
  $('.steps', form).hidden = login;
  $('small', form).innerHTML = `<a href="#" id="swap" style="color:var(--green);font-weight:700">${login ? 'New here? Create an account' : 'Already have an account? Log in'}</a>`;
  $('#swap').onclick = e => { e.preventDefault(); setMode(!loginMode); };
}
setMode(false);
form.addEventListener('submit', guard(async e => {
  e.preventDefault();
  const body = { email: $('#e').value, password: $('#pw').value };
  if (!loginMode) { body.name = $('#n').value; body.phone = $('#p').value; }
  const res = await api(loginMode ? '/auth/login' : '/auth/register', { method: 'POST', body });
  localStorage.setItem('cp_token', res.token); form.reset(); show('dash');
}));
$('.avatar').title = 'Click to log out'; $('.avatar').style.cursor = 'pointer';
$('.avatar').onclick = () => confirm('Log out of CareerPilot AI?') && logout();
if (token()) $$('.nav .btn.primary').forEach(b => b.textContent = 'Open Dashboard');

// ---------- Tabs ----------
let curTab = 'home';
const card = h => `<div class="card" style="padding:20px;margin-bottom:16px">${h}</div>`;
const chip = (t, c = '') => `<span class="chip ${c}">${esc(t)}</span>`;
const pri = p => p === 'High' ? 'bad' : p === 'Medium' ? 'warn' : '';
const bar = v => `<div class="bar"><i style="width:${v}%"></i></div>`;
const head = (t, extra = '') => `<div class="top" style="margin-bottom:12px"><div><h1 style="font-size:22px">${t}</h1></div><div>${extra}</div></div>`;
const TABS = { home, roadmap, skillgap, skills: () => crud('skills', 'Skills', 'Skill'), projects: () => crud('projects', 'Projects', 'Project'),
  experience: () => crud('experience', 'Experience', 'Experience'), certifications: () => crud('certifications', 'Certifications', 'Certification'),
  timeline, interview, aimock };

async function go(t) {
  curTab = t; $$('.side a').forEach(a => a.classList.toggle('on', a.dataset.tab === t));
  $('#home').hidden = t !== 'home'; $('#tab').hidden = t === 'home';
  if (t !== 'home') $('#tab').innerHTML = card('<p style="color:var(--muted)">Loading…</p>');
  try { await TABS[t](); } catch (e) {
    if (t !== 'home') $('#tab').innerHTML = card(`<p>${esc(e.message)}</p><button class="btn primary" style="margin-top:10px" onclick="go('${t}')">Try again</button>`);
    else toast(e.message, true);
  }
}
$$('.side a[data-tab]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(a.dataset.tab); }));
const setRing = (el, v) => { el.style.setProperty('--p', v); el.dataset.l = v + '%'; };

// ---------- Home (existing dashboard, bound to data) ----------
async function home() {
  const d = await api('/dashboard'); user = d.user; const c = d.counts;
  $('.top h1').textContent = `Hello, ${user.name.split(' ')[0]} 👋`; $('.avatar').textContent = user.name[0].toUpperCase();
  const kb = $$('.kpi b'); [user.role, user.industry || 'Not set', user.company || 'Not set', d.readiness + '%', user.months + ' months'].forEach((v, i) => kb[i].textContent = v);
  setRing($('.kpi .ring'), d.readiness); setRing($('.over .ring'), d.readiness);
  const ns = $$('.node'); ns[0].querySelector('small').textContent = user.role;
  [`${c.skillsHave}/${c.skillsReq}`, `${c.projects}/5`, `${c.experience}/2`, `${c.certs}/2`, `${c.msDone}/${c.msTotal}`, d.readiness + '%'].forEach((v, i) => ns[i + 1].querySelector('small').textContent = v);
  $('.over ul').innerHTML = [['Skills', `${c.skillsHave}/${c.skillsReq}`], ['Projects', `${c.projects}/5`], ['Experience', `${c.experience}/2`], ['Certifications', `${c.certs}/2`]].map(([a, b]) => `<li>${a} <b>${b}</b></li>`).join('');
  $('.next h4').textContent = d.next.title; $('.next p').textContent = d.next.text;
  $('.next .btn').onclick = () => go('roadmap'); $('.mile .btn').onclick = () => go('roadmap');
  $('.mile .item').innerHTML = d.upcoming ? `<span>📌</span><div><b>${esc(d.upcoming.title)}</b><br><small style="color:var(--muted)">Week ${d.upcoming.week ?? '-'}</small></div>` : '<span>📌</span><div><b>No milestones yet</b><br><small style="color:var(--muted)">Generate your roadmap</small></div>';
  $('.road header a').onclick = e => { e.preventDefault(); go('roadmap'); };
  const g = d.gap, cnt = s => g.filter(x => x.status === s).length, top = g.filter(x => x.priority !== 'Low').slice(0, 4);
  $('.row2').innerHTML = `
  <div class="card panel"><h4>Skill Gap Analysis</h4><div style="display:flex;gap:14px;align-items:center;margin-bottom:10px">
    <div class="ring lg" data-l="${d.parts.skills}%" style="--p:${d.parts.skills}"></div>
    <div><small>● Strong ${cnt('Strong')}<br>● Already known ${cnt('Already known')}<br>● Needs improvement ${cnt('Needs improvement')}<br>● Missing ${cnt('Missing')}</small></div></div>
    ${top.map(x => `<div class="gap"><span>${esc(x.skill)}</span>${chip(x.priority + ' Priority', pri(x.priority))}</div>`).join('') || '<p style="color:var(--muted)">No gaps. Nice work.</p>'}</div>
  <div class="card panel"><h4>Tasks</h4>${d.tasks.map(t => `<label class="task"><input type="checkbox" data-ms="${t.id}"> ${esc(t.title)}</label>`).join('') || '<p style="color:var(--muted)">No pending tasks. Generate your roadmap to get some.</p>'}</div>
  <div class="card panel"><h4>Progress</h4><b>Overall Progress ${d.readiness}%</b>${bar(d.readiness)}
    ${Object.entries(d.parts).map(([k, v]) => `<div class="gap"><span style="text-transform:capitalize">${k}</span><b>${v}%</b></div>`).join('')}</div>
  <div class="card panel"><h4>AI Assistant</h4><div class="bubble" id="aiOut">Ask me what to focus on this week.</div>
    <input class="search" id="aiQ" style="width:100%;margin-top:8px" placeholder="Ask Career AI..." aria-label="Ask Career AI"></div>`;
  $$('[data-ms]').forEach(i => i.onchange = guard(async () => { await api('/milestones/' + i.dataset.ms, { method: 'PUT', body: { done: true } }); toast('Milestone completed'); home(); }));
  $('#aiQ').onkeydown = guard(async e => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return; const q = e.target.value; e.target.value = ''; $('#aiOut').textContent = 'Thinking…';
    $('#aiOut').textContent = (await api('/ai/recommend', { method: 'POST', body: { question: q } })).text;
  });
}

// ---------- Generic CRUD tab ----------
async function crud(kind, title, one) {
  if (!schema) schema = await api('/schema');
  const [items, gp] = await Promise.all([api('/' + kind), kind === 'skills' ? api('/skillgap') : null]);
  const fld = ([k, t]) => {
    const l = k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
    const inp = kind === 'skills' && k === 'level' ? `<select id="f_${k}">${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n} - ${['Beginner', 'Basic', 'Intermediate', 'Advanced', 'Expert'][n - 1]}</option>`).join('')}</select>`
      : t === 'long' ? `<textarea id="f_${k}" rows="3" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;font:inherit"></textarea>`
      : `<input id="f_${k}" type="${t === 'date' ? 'date' : t === 'url' ? 'url' : t === 'num' ? 'number' : 'text'}">`;
    return `<div class="field"><label for="f_${k}">${l}</label>${inp}</div>`;
  };
  let editing = null;
  $('#tab').innerHTML = head(title, `<button class="btn primary" id="addBtn">+ Add ${one}</button>`) +
    `<div class="card" id="cf" hidden style="padding:20px;margin-bottom:16px"><form id="cform"><div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">${schema[kind].map(fld).join('')}</div>
     <div style="display:flex;gap:10px"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" id="cx">Cancel</button></div></form></div>` +
    (gp ? card(`<b>Missing for ${esc(gp.role)}:</b> ${gp.gap.filter(x => !x.level).map(x => `<button class="chip" data-quick="${esc(x.skill)}" style="border:0;cursor:pointer;margin:2px">+ ${esc(x.skill)}</button>`).join('') || 'none'}`) : '') +
    (items.length ? items.map(it => {
      const [k0] = schema[kind][0], sub = schema[kind].slice(1).filter(([k]) => it[k] != null);
      return `<div class="card" style="padding:16px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div><b>${esc(it[k0])}</b> ${kind === 'skills' ? chip('Level ' + it.level + '/5') : ''}</div>
        <div style="display:flex;gap:8px"><button class="btn ghost" style="padding:6px 14px" data-e="${it.id}">Edit</button><button class="btn ghost" style="padding:6px 14px;color:var(--red)" data-d="${it.id}">Delete</button></div></div>
        ${sub.length && kind !== 'skills' ? `<details style="margin-top:8px;font-size:13px"><summary style="cursor:pointer;color:var(--green);font-weight:600">View details</summary>${sub.map(([k]) => `<div style="margin-top:6px"><span style="color:var(--muted)">${esc(k)}:</span> ${/^https?:/.test(it[k]) ? `<a href="${esc(it[k])}" target="_blank" rel="noopener" style="color:var(--green)">${esc(it[k])}</a>` : esc(it[k])}</div>`).join('')}</details>` : ''}</div>`;
    }).join('') : card(`<p style="color:var(--muted)">No ${title.toLowerCase()} yet. Add your first one to build your profile.</p>`));
  const box = $('#cf'); const reset = () => { box.hidden = true; editing = null; $('#cform').reset(); };
  $('#addBtn').onclick = () => { reset(); box.hidden = false; };
  $('#cx').onclick = reset;
  $$('[data-e]').forEach(b => b.onclick = () => { const it = items.find(x => x.id == b.dataset.e); editing = it.id; box.hidden = false; schema[kind].forEach(([k]) => $('#f_' + k).value = it[k] ?? ''); box.scrollIntoView({ behavior: 'smooth' }); });
  $$('[data-d]').forEach(b => b.onclick = guard(async () => { if (!confirm('Delete this item?')) return; await api(`/${kind}/${b.dataset.d}`, { method: 'DELETE' }); toast('Deleted'); crud(kind, title, one); }));
  $$('[data-quick]').forEach(b => b.onclick = guard(async () => { await api('/skills', { method: 'POST', body: { name: b.dataset.quick, level: 1 } }); toast('Skill added'); crud(kind, title, one); }));
  $('#cform').onsubmit = guard(async e => {
    e.preventDefault(); const body = {}; schema[kind].forEach(([k]) => body[k] = $('#f_' + k).value);
    await api(editing ? `/${kind}/${editing}` : '/' + kind, { method: editing ? 'PUT' : 'POST', body }); toast('Saved'); crud(kind, title, one);
  });
}

// ---------- Roadmap + career goal ----------
async function roadmap() {
  const [ms, roles, me] = await Promise.all([api('/milestones'), api('/roles'), api('/me')]);
  $('#tab').innerHTML = head('Career Roadmap', '<button class="btn primary" id="gen">Generate / refresh roadmap</button>') +
    card(`<form id="goal"><h3 style="margin-bottom:12px">Career goal</h3><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0 14px">
      <div class="field"><label>Target role</label><select id="g_role" style="width:100%;padding:11px;border:1px solid var(--line);border-radius:9px">${roles.map(r => `<option ${r === me.role ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
      <div class="field"><label>Industry</label><input id="g_ind" value="${esc(me.industry)}"></div><div class="field"><label>Target company</label><input id="g_co" value="${esc(me.company)}"></div>
      <div class="field"><label>Timeline (months)</label><input id="g_m" type="number" min="1" max="36" value="${me.months}"></div></div><button class="btn primary" style="width:auto">Save goal</button></form>`) +
    card(`<h3 style="margin-bottom:10px">Milestones</h3>${ms.length ? ms.map(m => `<label class="task"><input type="checkbox" data-m="${m.id}" ${m.done ? 'checked' : ''}> <span style="${m.done ? 'text-decoration:line-through;color:var(--muted)' : ''};margin:0">${esc(m.title)}</span>
      <span style="margin-left:auto">${m.week != null ? 'Week ' + m.week : ''} <button class="btn ghost" style="padding:2px 10px;color:var(--red)" data-x="${m.id}" type="button">✕</button></span></label>`).join('') : '<p style="color:var(--muted)">No milestones yet. Save your goal, then generate your roadmap.</p>'}
      <form id="addm" style="display:flex;gap:8px;margin-top:12px"><input class="search" id="mt" style="flex:1;width:auto" placeholder="Add your own milestone" maxlength="200" aria-label="New milestone"><button class="btn ghost">Add</button></form>`);
  $('#goal').onsubmit = guard(async e => { e.preventDefault(); await api('/me', { method: 'PUT', body: { role: $('#g_role').value, industry: $('#g_ind').value, company: $('#g_co').value, months: $('#g_m').value } }); toast('Goal saved'); roadmap(); });
  $('#gen').onclick = guard(async () => { const r = await api('/roadmap/generate', { method: 'POST' }); toast(r.added ? `${r.added} milestones added` : 'Roadmap is up to date'); roadmap(); });
  $$('[data-m]').forEach(i => i.onchange = guard(async () => { await api('/milestones/' + i.dataset.m, { method: 'PUT', body: { done: i.checked } }); roadmap(); }));
  $$('[data-x]').forEach(b => b.onclick = guard(async e => { e.preventDefault(); await api('/milestones/' + b.dataset.x, { method: 'DELETE' }); roadmap(); }));
  $('#addm').onsubmit = guard(async e => { e.preventDefault(); if (!$('#mt').value.trim()) return; await api('/milestones', { method: 'POST', body: { title: $('#mt').value } }); roadmap(); });
}

// ---------- Skill gap, timeline, interview, mock ----------
async function skillgap() {
  const d = await api('/skillgap');
  $('#tab').innerHTML = head('Skill Gap Analysis', chip(d.match + '% match for ' + d.role)) + card(bar(d.match) +
    d.gap.map(x => `<div class="gap"><span><b>${esc(x.skill)}</b> <small style="color:var(--muted)">${x.level ? 'Level ' + x.level + '/5' : 'Not added'}</small></span><span>${chip(x.status)} ${chip(x.priority, pri(x.priority))}</span></div>`).join('') +
    `<div style="margin-top:14px;display:flex;gap:10px"><button class="btn primary" id="rec">Get AI recommendations</button><button class="btn ghost" onclick="go('skills')">Update my skills</button></div><div class="bubble" id="rout" hidden style="white-space:pre-wrap;margin-top:12px"></div>`);
  $('#rec').onclick = guard(async () => { $('#rout').hidden = false; $('#rout').textContent = 'Thinking…'; $('#rout').textContent = (await api('/ai/recommend', { method: 'POST', body: {} })).text; });
}
async function timeline() {
  const [p] = await Promise.all([api('/progress')]), order = [...p.milestones].sort((a, b) => (a.week ?? 99) - (b.week ?? 99));
  $('#tab').innerHTML = head('Timeline & Progress', chip('Readiness ' + p.readiness + '%')) + card(bar(p.readiness) +
    Object.entries(p.parts).map(([k, v]) => `<div style="margin-top:10px"><div class="gap" style="border:0"><span style="text-transform:capitalize">${k}</span><b>${v}%</b></div>${bar(v)}</div>`).join('')) +
    card('<h3 style="margin-bottom:10px">Milestone timeline</h3>' + (order.map(m => `<div class="task"><span>${m.done ? '✅' : '⏳'}</span> ${esc(m.title)} <span>${m.week != null ? 'Week ' + m.week : ''}</span></div>`).join('') || '<p style="color:var(--muted)">No milestones yet. Generate your roadmap first.</p>'));
}
async function interview() {
  const d = await api('/interview/questions');
  $('#tab').innerHTML = head('Interview Preparation') + card('<h3 style="margin-bottom:8px">Technical (from your skill gaps)</h3>' +
    (d.technical.map(q => `<div class="task">${chip(q.skill)} ${esc(q.question)}</div>`).join('') || '<p style="color:var(--muted)">Add skills and a career goal to get tailored questions.</p>') +
    '<h3 style="margin:16px 0 8px">Behavioural</h3>' + d.behavioural.map(q => `<div class="task">${esc(q)}</div>`).join('') +
    '<button class="btn primary" style="margin-top:14px" onclick="go(\'aimock\')">Start AI mock interview</button>');
}
const chat = [];
async function aimock() {
  const draw = () => $('#log').innerHTML = chat.map(m => `<div class="bubble ${m.role === 'user' ? 'me' : ''}" style="white-space:pre-wrap">${esc(m.content)}</div>`).join('') || '<p style="color:var(--muted)">Press Start to begin your mock interview.</p>';
  $('#tab').innerHTML = head('AI Mock Interview', '<button class="btn ghost" id="rs">Restart</button>') + card('<div id="log" style="min-height:240px;max-height:50vh;overflow:auto"></div><form id="cf2" style="display:flex;gap:8px;margin-top:12px"><input class="search" id="ans" style="flex:1;width:auto" maxlength="2000" placeholder="Type your answer…" aria-label="Your answer"><button class="btn primary" style="padding:10px 18px">Send</button></form>');
  draw();
  const send = guard(async () => { const r = await api('/ai/mock', { method: 'POST', body: { messages: chat } }); chat.push({ role: 'assistant', content: r.text }); draw(); });
  if (!chat.length) await send();
  $('#rs').onclick = () => { chat.length = 0; aimock(); };
  $('#cf2').onsubmit = guard(async e => { e.preventDefault(); const v = $('#ans').value.trim(); if (!v) return; $('#ans').value = ''; chat.push({ role: 'user', content: v }); draw(); try { await send(); } catch { chat.pop(); draw(); } });
}

// ---------- Boot ----------
if (token()) show('dash');