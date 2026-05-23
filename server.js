const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'skills.db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;

function saveDb() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function q(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  stmt.step();
  stmt.free();
}

async function init() {
  const SQL = await initSqlJs();
  const dbDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

  try {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } catch {
    db = new SQL.Database();
  }

  run('CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, color TEXT DEFAULT \'#6366f1\', created_at TEXT DEFAULT (datetime(\'now\')))');
  run('CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT \'\', category_id INTEGER, status TEXT DEFAULT \'idea\' CHECK(status IN (\'idea\',\'incubating\',\'active\',\'refining\',\'retired\')), progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100), repo_url TEXT DEFAULT \'\', notes TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')), updated_at TEXT DEFAULT (datetime(\'now\')))');
  run('CREATE TABLE IF NOT EXISTS milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, skill_id INTEGER NOT NULL, title TEXT NOT NULL, done INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\')))');
  run('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, skill_id INTEGER NOT NULL, message TEXT NOT NULL, created_at TEXT DEFAULT (datetime(\'now\')))');
  saveDb();

  // ---- Categories ----
  app.get('/api/categories', (req, res) => {
    res.json(q('SELECT * FROM categories ORDER BY name'));
  });

  app.post('/api/categories', (req, res) => {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    run('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)', [name, color || '#6366f1']);
    saveDb();
    res.json(q('SELECT * FROM categories ORDER BY name'));
  });

  app.delete('/api/categories/:id', (req, res) => {
    run('UPDATE skills SET category_id = NULL WHERE category_id = ?', [req.params.id]);
    run('DELETE FROM categories WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ ok: true });
  });

  // ---- Skills ----
  app.get('/api/skills', (req, res) => {
    const { status, category_id } = req.query;
    let sql = 'SELECT s.*, c.name AS category_name, c.color AS category_color FROM skills s LEFT JOIN categories c ON s.category_id = c.id';
    const params = [];
    const where = [];
    if (status) { where.push('s.status = ?'); params.push(status); }
    if (category_id) { where.push('s.category_id = ?'); params.push(parseInt(category_id)); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY s.updated_at DESC';
    res.json(q(sql, params.length ? params : undefined));
  });

  app.get('/api/skills/:id', (req, res) => {
    const rows = q('SELECT s.*, c.name AS category_name, c.color AS category_color FROM skills s LEFT JOIN categories c ON s.category_id = c.id WHERE s.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const skill = rows[0];
    skill.milestones = q('SELECT * FROM milestones WHERE skill_id = ? ORDER BY created_at', [req.params.id]);
    skill.logs = q('SELECT * FROM logs WHERE skill_id = ? ORDER BY created_at DESC', [req.params.id]);
    res.json(skill);
  });

  app.post('/api/skills', (req, res) => {
    const { name, description, category_id, status, progress, repo_url, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    run('INSERT INTO skills (name, description, category_id, status, progress, repo_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?)', [name, description || '', category_id ?? null, status || 'idea', progress ?? 0, repo_url || '', notes || '']);
    saveDb();
    const newId = q('SELECT last_insert_rowid() as id')[0].id;
    const skill = q('SELECT s.*, c.name AS category_name, c.color AS category_color FROM skills s LEFT JOIN categories c ON s.category_id = c.id WHERE s.id = ?', [newId])[0];
    res.status(201).json(skill);
  });

  app.put('/api/skills/:id', (req, res) => {
    const existing = q('SELECT * FROM skills WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    const { name, description, category_id, status, progress, repo_url, notes } = req.body;
    run('UPDATE skills SET name=?, description=?, category_id=?, status=?, progress=?, repo_url=?, notes=?, updated_at=datetime(\'now\') WHERE id=?', [
      name ?? existing[0].name,
      description ?? existing[0].description,
      category_id ?? existing[0].category_id,
      status ?? existing[0].status,
      progress ?? existing[0].progress,
      repo_url ?? existing[0].repo_url,
      notes ?? existing[0].notes,
      req.params.id
    ]);
    saveDb();
    res.json(q('SELECT s.*, c.name AS category_name, c.color AS category_color FROM skills s LEFT JOIN categories c ON s.category_id = c.id WHERE s.id = ?', [req.params.id])[0]);
  });

  app.delete('/api/skills/:id', (req, res) => {
    run('DELETE FROM skills WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ ok: true });
  });

  // ---- Milestones ----
  app.post('/api/skills/:id/milestones', (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    run('INSERT INTO milestones (skill_id, title) VALUES (?, ?)', [req.params.id, title]);
    saveDb();
    res.json(q('SELECT * FROM milestones WHERE skill_id = ? ORDER BY created_at', [req.params.id]));
  });

  app.put('/api/milestones/:id/toggle', (req, res) => {
    run('UPDATE milestones SET done = CASE WHEN done THEN 0 ELSE 1 END WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ ok: true });
  });

  app.delete('/api/milestones/:id', (req, res) => {
    run('DELETE FROM milestones WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ ok: true });
  });

  // ---- Logs ----
  app.post('/api/skills/:id/logs', (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    run('INSERT INTO logs (skill_id, message) VALUES (?, ?)', [req.params.id, message]);
    saveDb();
    res.json(q('SELECT * FROM logs WHERE skill_id = ? ORDER BY created_at DESC', [req.params.id]));
  });

  app.delete('/api/logs/:id', (req, res) => {
    run('DELETE FROM logs WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ ok: true });
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`Incubateur de Skills lancé sur http://localhost:${PORT}`);
  });
}

init().catch(err => { console.error('Init error:', err); process.exit(1); });
