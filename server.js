require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const E = process.env;
if (!E.ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
const db = new Database(E.DB_PATH || 'crm.db');
const STS = ['New', 'Contacted', 'Qualified', 'Follow-up', 'Won', 'Lost'];
const SRC = ['Meta Ads', 'WhatsApp', 'Website', 'Manual'];

db.exec(`CREATE TABLE IF NOT EXISTS leads(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ext TEXT UNIQUE,
  name TEXT,
  phone TEXT,
  email TEXT,
  source TEXT,
  status TEXT DEFAULT 'New',
  note TEXT DEFAULT '',
  created TEXT,
  log TEXT DEFAULT '[]'
)`);

const clients = new Set();
const uid = (r) => 'LD-' + r.created.slice(2, 10).replace(/-/g, '') + '-' + String(r.id).padStart(4, '0');
const fmt = (r) => ({ ...r, uid: uid(r), log: JSON.parse(r.log) });
const get = (id) => db.prepare('SELECT * FROM leads WHERE id=?').get(id);

function push(msg) {
  const d = JSON.stringify({ msg });
  clients.forEach((c) => c.write(`data: ${d}\n\n`));
  if (E.TELEGRAM_TOKEN && E.TELEGRAM_CHAT_ID) {
    fetch(`https://api.telegram.org/bot${E.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: E.TELEGRAM_CHAT_ID, text: msg }),
    }).catch(() => {});
  }
}

function log(id, m) {
  const r = get(id);
  const l = JSON.parse(r.log);
  l.push({ t: new Date().toISOString(), m });
  db.prepare('UPDATE leads SET log=? WHERE id=?').run(JSON.stringify(l), id);
}

function create(o) {
  if (o.ext && db.prepare('SELECT 1 FROM leads WHERE ext=?').get(o.ext)) return;
  const i = db.prepare(
    'INSERT INTO leads(ext,name,phone,email,source,note,created) VALUES(?,?,?,?,?,?,?)'
  ).run(
    o.ext || null,
    o.name || 'Unknown',
    o.phone || '',
    o.email || '',
    o.source,
    o.note || '',
    new Date().toISOString()
  ).lastInsertRowid;
  log(i, 'Lead created from ' + o.source);
  const r = fmt(get(i));
  push(`New ${o.source} lead: ${r.name} (${r.uid}) ${r.phone}`);
  return r;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

app.use(express.json({ verify: (q, s, b) => { q.raw = b; } }));

app.get('/health', (_q, s) => s.json({ ok: true }));

app.use('/api/leads/website', (q, s, n) => {
  s.set({
    'Access-Control-Allow-Origin': E.WEBSITE_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST',
  });
  q.method === 'OPTIONS' ? s.sendStatus(204) : n();
});

app.post('/api/leads/website', (q, s) => {
  const b = q.body || {};
  if (b.company) return s.json({ ok: true });
  if (!b.name || !(b.phone || b.email)) {
    return s.status(400).json({ error: 'name and phone/email required' });
  }
  create({ source: 'Website', name: b.name, phone: b.phone, email: b.email, note: b.message });
  s.json({ ok: true });
});

app.get('/webhooks/meta', (q, s) =>
  q.query['hub.mode'] === 'subscribe' && q.query['hub.verify_token'] === E.META_VERIFY_TOKEN
    ? s.send(q.query['hub.challenge'])
    : s.sendStatus(403)
);

app.post('/webhooks/meta', async (q, s) => {
  const sig = q.get('x-hub-signature-256') || '';
  const exp = 'sha256=' + crypto.createHmac('sha256', E.META_APP_SECRET || '').update(q.raw || '').digest('hex');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) {
    return s.sendStatus(403);
  }
  s.sendStatus(200);
  try {
    for (const en of q.body.entry || []) {
      for (const c of en.changes || []) {
        const v = c.value || {};
        if (c.field === 'leadgen') {
          const r = await fetch(`https://graph.facebook.com/v21.0/${v.leadgen_id}?access_token=${E.META_PAGE_TOKEN}`);
          const j = await r.json();
          const d = {};
          (j.field_data || []).forEach((f) => { d[f.name] = (f.values || [])[0]; });
          create({
            ext: 'meta:' + v.leadgen_id,
            source: 'Meta Ads',
            name: d.full_name || [d.first_name, d.last_name].filter(Boolean).join(' '),
            phone: d.phone_number || d.phone,
            email: d.email,
            note: `Form ${v.form_id || '-'} / Ad ${v.ad_id || '-'}`,
          });
        }
        if (c.field === 'messages') {
          for (const m of v.messages || []) {
            const phone = '+' + m.from;
            const name = (v.contacts && v.contacts[0] && v.contacts[0].profile && v.contacts[0].profile.name) || phone;
            const txt = (m.text && m.text.body) || '[' + m.type + ']';
            const ex = db.prepare('SELECT * FROM leads WHERE phone=?').get(phone);
            if (ex) {
              log(ex.id, 'WhatsApp message: ' + txt);
              push(`${uid(ex)} (${ex.name}) sent a WhatsApp message`);
            } else {
              create({ ext: 'wa:' + m.id, source: 'WhatsApp', name, phone, note: txt });
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('webhook error', e);
  }
});

app.use((q, s, n) => {
  const [t, b] = (q.headers.authorization || '').split(' ');
  const p = Buffer.from(b || '', 'base64').toString().split(':').slice(1).join(':');
  if (t === 'Basic' && p === E.ADMIN_PASSWORD) return n();
  s.set('WWW-Authenticate', 'Basic realm="CRM"').sendStatus(401);
});

app.get('/api/leads', (_q, s) =>
  s.json(db.prepare('SELECT * FROM leads ORDER BY id DESC').all().map(fmt))
);

app.post('/api/leads', (q, s) => {
  const b = q.body || {};
  if (!b.name || !(b.phone || b.email)) {
    return s.status(400).json({ error: 'name and phone/email required' });
  }
  const source = SRC.includes(b.source) ? b.source : 'Manual';
  s.json(create({ source, name: b.name, phone: b.phone, email: b.email, note: b.note }));
});

app.get('/api/leads.csv', (_q, s) => {
  const rows = db.prepare('SELECT * FROM leads ORDER BY id DESC').all().map(fmt);
  const head = ['uid', 'name', 'phone', 'email', 'source', 'status', 'note', 'created'];
  const body = rows.map((r) => head.map((k) => csvCell(r[k])).join(',')).join('\n');
  s.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="leads.csv"',
  });
  s.send(head.join(',') + '\n' + body);
});

app.patch('/api/leads/:id', (q, s) => {
  const r = get(q.params.id);
  if (!r) return s.sendStatus(404);
  const b = q.body || {};
  for (const k of ['name', 'phone', 'email', 'note']) {
    if (typeof b[k] === 'string' && b[k] !== r[k]) {
      db.prepare(`UPDATE leads SET ${k}=? WHERE id=?`).run(b[k], r.id);
      log(r.id, k + ' updated');
    }
  }
  if (STS.includes(b.status) && b.status !== r.status) {
    db.prepare('UPDATE leads SET status=? WHERE id=?').run(b.status, r.id);
    log(r.id, `Status: ${r.status} → ${b.status}`);
    push(`${uid(r)} (${r.name}) moved to ${b.status}`);
  }
  s.json(fmt(get(r.id)));
});

app.get('/api/stream', (q, s) => {
  s.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  s.flushHeaders();
  clients.add(s);
  q.on('close', () => clients.delete(s));
});

setInterval(() => clients.forEach((c) => c.write(': ping\n\n')), 25000);

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_q, s) => s.sendFile(path.join(__dirname, 'public', 'index.html')));

const port = E.PORT || 3000;
app.listen(port, () => console.log('Lead CRM running on port ' + port));
