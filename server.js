const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'skills.db');
const AI_CONFIG_PATH = path.join(__dirname, 'data', 'ai-config.json');

function loadAIConfig() {
  try {
    return JSON.parse(fs.readFileSync(AI_CONFIG_PATH, 'utf-8'));
  } catch {
    return {
      provider: process.env.AI_PROVIDER || 'ollama',
      model: process.env.AI_MODEL || 'llama3',
      endpoint: process.env.AI_ENDPOINT || 'http://localhost:11434',
      openaiKey: process.env.OPENAI_API_KEY || '',
      anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    };
  }
}

function saveAIConfig(config) {
  fs.writeFileSync(AI_CONFIG_PATH, JSON.stringify(config, null, 2));
}

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

function buildSkillContext(skillId) {
  const skill = q('SELECT s.*, c.name AS category_name, c.color AS category_color FROM skills s LEFT JOIN categories c ON s.category_id = c.id WHERE s.id = ?', [skillId]);
  if (!skill.length) return null;
  const s = skill[0];
  s.milestones = q('SELECT * FROM milestones WHERE skill_id = ? ORDER BY created_at', [skillId]);
  s.logs = q('SELECT * FROM logs WHERE skill_id = ? ORDER BY created_at DESC LIMIT 10', [skillId]);
  return s;
}

async function callAI(messages, systemPrompt, config) {
  const { provider, model, endpoint, openaiKey, anthropicKey } = config;
  if (provider === 'ollama') {
    const res = await fetch((endpoint || 'http://localhost:11434') + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'llama3',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        stream: false,
      }),
    });
    if (!res.ok) throw new Error('Ollama error: ' + res.statusText);
    const data = await res.json();
    return data.message.content;
  } else if (provider === 'openai') {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: openaiKey });
    const completion = await openai.chat.completions.create({
      model: model || 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    });
    return completion.choices[0].message.content;
  } else if (provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const msg = await anthropic.messages.create({
      model: model || 'claude-3-haiku-20240307',
      system: systemPrompt,
      messages: messages,
      max_tokens: 1024,
    });
    return msg.content[0].text;
  } else {
    throw new Error('Unknown AI provider: ' + provider);
  }
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
  run('CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT \'\', category_id INTEGER, status TEXT DEFAULT \'incubating\', progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100), repo_url TEXT DEFAULT \'\', notes TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')), updated_at TEXT DEFAULT (datetime(\'now\')))');

  try {
    run("INSERT INTO skills (name, status) VALUES ('__mig_test__', 'terminer')");
    run("DELETE FROM skills WHERE name = '__mig_test__'");
  } catch {
    db.run("ALTER TABLE skills RENAME TO skills_old");
    db.run("CREATE TABLE skills (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '', category_id INTEGER, status TEXT DEFAULT 'incubating', progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100), repo_url TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))");
    db.run("INSERT INTO skills (id, name, description, category_id, status, progress, repo_url, notes, created_at, updated_at) SELECT id, name, description, category_id, status, progress, repo_url, notes, created_at, updated_at FROM skills_old");
    db.run("DROP TABLE skills_old");
    saveDb();
  }
  run('CREATE TABLE IF NOT EXISTS milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, skill_id INTEGER NOT NULL, title TEXT NOT NULL, done INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\')))');
  run('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, skill_id INTEGER NOT NULL, message TEXT NOT NULL, created_at TEXT DEFAULT (datetime(\'now\')))');
  saveDb();

  // ---- Categories ----
  app.get('/api/categories', (req, res) => {
    res.json(q("SELECT c.*, (SELECT COUNT(*) FROM skills WHERE category_id = c.id) AS skill_count FROM categories c ORDER BY c.name"));
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

  app.put('/api/categories/:id', (req, res) => {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    run('UPDATE categories SET name = ?, color = ? WHERE id = ?', [name, color || '#6366f1', req.params.id]);
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
    run('INSERT INTO skills (name, description, category_id, status, progress, repo_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?)', [name, description || '', category_id ?? null, status || 'incubating', progress ?? 0, repo_url || '', notes || '']);
    saveDb();
    const newId = q('SELECT last_insert_rowid() as id')[0].id;
    res.status(201).json({ id: newId, name });
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

  app.post('/api/skills/:id/export', (req, res) => {
    const { directory } = req.body;
    if (!directory) return res.status(400).json({ error: 'Directory required' });
    const skill = q('SELECT * FROM skills WHERE id = ?', [req.params.id])[0];
    if (!skill) return res.status(404).json({ error: 'Not found' });
    const cat = q('SELECT * FROM categories WHERE id = ?', [skill.category_id])[0];
    const dir = path.resolve(directory.toString());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const skillDir = path.join(dir, skill.name.toLowerCase().replace(/[\s]+/g, '-').replace(/[^a-z0-9-]/g, ''));
    if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
    const milestones = q('SELECT * FROM milestones WHERE skill_id = ? ORDER BY created_at', [skill.id]);
    const content = `---
name: ${skill.name}
description: ${skill.description || ''}
status: terminer
progress: ${skill.progress}
created_at: ${skill.created_at}
completed_at: ${new Date().toISOString()}
---

# ${skill.name}

${skill.description || ''}

${cat ? `**Categorie:** ${cat.name}\n` : ''}
**Progression:** ${skill.progress}%

${skill.notes ? `## Notes\n\n${skill.notes}\n` : ''}

${milestones.length ? `## Jalons\n\n${milestones.map(m => `- [${m.done ? 'x' : ' '}] ${m.title}`).join('\n')}\n` : ''}
`;
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
    run("UPDATE skills SET status = 'terminer', updated_at = datetime('now') WHERE id = ?", [skill.id]);
    saveDb();
    const updated = q('SELECT s.*, c.name AS category_name, c.color AS category_color FROM skills s LEFT JOIN categories c ON s.category_id = c.id WHERE s.id = ?', [skill.id])[0];
    updated.milestones = q('SELECT * FROM milestones WHERE skill_id = ? ORDER BY created_at', [skill.id]);
    updated.logs = q('SELECT * FROM logs WHERE skill_id = ? ORDER BY created_at DESC', [skill.id]);
    res.json({ ok: true, path: path.join(skillDir, 'SKILL.md'), skill: updated });
  });

  app.post('/api/skills/:id/chat', async (req, res) => {
    try {
      const skill = buildSkillContext(req.params.id);
      if (!skill) return res.status(404).json({ error: 'Skill not found' });

      const { messages } = req.body;
      if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages array required' });

      const milestoneLines = (skill.milestones || []).map(m =>
        `[${m.done ? 'x' : ' '}] ${m.title}`
      ).join('\n');
      const recentLogs = (skill.logs || []).map(l =>
        `[${l.created_at}] ${l.message}`
      ).join('\n');

      const systemPrompt = `Tu es un assistant expert en incubation de compétences. Tu aides l'utilisateur à développer son skill "${skill.name}" en mode "${skill.status}" (progression: ${skill.progress}%).

Contexte du skill :
- Description : ${skill.description || 'Non renseignée'}
- Catégorie : ${skill.category_name || 'Aucune'}
${skill.repo_url ? '- Dépôt : ' + skill.repo_url + '\n' : ''}${skill.notes ? '- Notes : ' + skill.notes + '\n' : ''}${milestoneLines ? '- Jalons :\n' + milestoneLines + '\n' : ''}${recentLogs ? '- Logs récents :\n' + recentLogs : ''}
Sois concis, pratique, et orienté action. Réponds en français.`;

      const aiConfig = loadAIConfig();
      const content = await callAI(messages, systemPrompt, aiConfig);
      res.json({ content });
    } catch (err) {
      console.error('Chat error:', err);
      res.status(500).json({ error: err.message || 'Erreur du service IA' });
    }
  });

  app.delete('/api/skills/:id', (req, res) => {
    run('DELETE FROM skills WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ ok: true });
  });

  // ---- AI Config ----
  app.get('/api/ai/config', (req, res) => {
    const config = loadAIConfig();
    const safe = { ...config };
    if (safe.openaiKey) safe.openaiKey = safe.openaiKey.slice(0, 8) + '...' + safe.openaiKey.slice(-4);
    if (safe.anthropicKey) safe.anthropicKey = safe.anthropicKey.slice(0, 8) + '...' + safe.anthropicKey.slice(-4);
    res.json(safe);
  });

  app.post('/api/ai/test', async (req, res) => {
    const config = req.body;
    try {
      const content = await callAI(
        [{ role: 'user', content: 'Dis bonjour en 3 mots.' }],
        'Tu es un assistant. Réponds en français.',
        config
      );
      res.json({ ok: true, content });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erreur de connexion' });
    }
  });

  app.put('/api/ai/config', (req, res) => {
    const current = loadAIConfig();
    const { provider, model, endpoint, openaiKey, anthropicKey } = req.body;
    const config = {
      provider: provider || current.provider,
      model: model || current.model,
      endpoint: endpoint || current.endpoint,
      openaiKey: openaiKey && openaiKey.includes('...') ? current.openaiKey : (openaiKey || ''),
      anthropicKey: anthropicKey && anthropicKey.includes('...') ? current.anthropicKey : (anthropicKey || ''),
    };
    saveAIConfig(config);
    const safe = { ...config };
    if (safe.openaiKey) safe.openaiKey = safe.openaiKey.slice(0, 8) + '...' + safe.openaiKey.slice(-4);
    if (safe.anthropicKey) safe.anthropicKey = safe.anthropicKey.slice(0, 8) + '...' + safe.anthropicKey.slice(-4);
    res.json(safe);
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
