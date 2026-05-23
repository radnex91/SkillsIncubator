# AI Chat Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpawa:subagent-driven-development (recommended) or superpawa:executing-plans to implement this plan task-by-task.

**Goal:** Add an AI chat assistant in the skill detail modal that lets users ask questions about their skill in incubation.

**Architecture:** Server-side proxy (`POST /api/skills/:id/chat`) that injects full skill context into a system prompt and forwards to a configurable AI provider (Ollama default, OpenAI or Anthropic optional). Frontend chat UI renders in the detail modal with message history in memory.

**Tech Stack:** Node.js/Express server, vanilla JS frontend, Ollama (default) or OpenAI/Anthropic SDK (optional)

---

### Task 1: Server-side AI config + context builder + provider caller

**Files:**
- Modify: `server.js:6-8`
- Modify: `server.js:33` (after the `run()` function)

**Changes:**
1. Add AI config constants after `DB_PATH` (line 8)
2. Add `buildSkillContext()` and `callAI()` helper functions

- [ ] **Step 1: Add AI config constants after `DB_PATH`**

After line 8 (`const DB_PATH = path.join(__dirname, 'data', 'skills.db');`), insert:

```js
const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama';
const AI_MODEL = process.env.AI_MODEL || 'llama3';
const AI_ENDPOINT = process.env.AI_ENDPOINT || 'http://localhost:11434';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
```

- [ ] **Step 2: Add `buildSkillContext()` and `callAI()` after the `run()` function**

After line 33 (`}`) closing the `run()` function, insert before the `async function init()`:

```js
function buildSkillContext(skillId) {
  const skill = q('SELECT s.*, c.name AS category_name, c.color AS category_color FROM skills s LEFT JOIN categories c ON s.category_id = c.id WHERE s.id = ?', [skillId]);
  if (!skill.length) return null;
  const s = skill[0];
  s.milestones = q('SELECT * FROM milestones WHERE skill_id = ? ORDER BY created_at', [skillId]);
  s.logs = q('SELECT * FROM logs WHERE skill_id = ? ORDER BY created_at DESC LIMIT 10', [skillId]);
  return s;
}

async function callAI(messages, systemPrompt) {
  if (AI_PROVIDER === 'ollama') {
    const res = await fetch(AI_ENDPOINT + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        stream: false,
      }),
    });
    if (!res.ok) throw new Error('Ollama error: ' + res.statusText);
    const data = await res.json();
    return data.message.content;
  } else if (AI_PROVIDER === 'openai') {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    });
    return completion.choices[0].message.content;
  } else if (AI_PROVIDER === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: AI_MODEL,
      system: systemPrompt,
      messages: messages,
      max_tokens: 1024,
    });
    return msg.content[0].text;
  } else {
    throw new Error('Unknown AI provider: ' + AI_PROVIDER);
  }
}
```

- [ ] **Step 3: Verify syntax**

Run: `node -c server.js`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(server): add AI config, skill context builder, and provider caller"
```

---

### Task 2: Server-side chat endpoint

**Files:**
- Modify: `server.js` (add route after export route, after line 178)

- [ ] **Step 1: Add `POST /api/skills/:id/chat` route**

After line 178 (`});` closing the export route), insert:

```js
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

      const content = await callAI(messages, systemPrompt);
      res.json({ content });
    } catch (err) {
      console.error('Chat error:', err);
      res.status(500).json({ error: err.message || 'Erreur du service IA' });
    }
  });
```

- [ ] **Step 2: Verify syntax**

Run: `node -c server.js`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(server): add POST /api/skills/:id/chat endpoint"
```

---

### Task 3: Frontend chat CSS styles

**Files:**
- Modify: `public/index.html` (add CSS in the style section, before `@media`)

- [ ] **Step 1: Add chat CSS styles**

Insert after the `cat-actions` style block (after line 927) and before the `@media` block (line 929):

```css
  .chat-section {
    border-top: 1px solid var(--border);
    padding-top: 20px;
    margin-top: 20px;
  }
  .chat-messages {
    max-height: 300px;
    overflow-y: auto;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .chat-bubble {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 14px;
    font-size: 13px;
    line-height: 1.6;
    animation: fadeIn .2s;
  }
  .chat-bubble.user {
    align-self: flex-end;
    background: var(--primary);
    color: #fff;
    border-bottom-right-radius: 4px;
  }
  .chat-bubble.assistant {
    align-self: flex-start;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-bottom-left-radius: 4px;
  }
  .chat-bubble.error {
    align-self: flex-start;
    background: rgba(239,68,68,.15);
    border: 1px solid rgba(239,68,68,.2);
    color: var(--red);
  }
  .chat-input {
    display: flex;
    gap: 8px;
  }
  .chat-input input {
    flex: 1;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: rgba(0,0,0,.2);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }
  .chat-input input:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-glow);
  }
  .chat-typing {
    align-self: flex-start;
    padding: 10px 14px;
    border-radius: 14px;
    background: var(--surface2);
    border: 1px solid var(--border);
    font-size: 13px;
    color: var(--text-2);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .chat-typing .dots { display: flex; gap: 3px; }
  .chat-typing .dots span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text-3);
    animation: dotPulse 1.4s infinite ease-in-out;
  }
  .chat-typing .dots span:nth-child(2) { animation-delay: .2s; }
  .chat-typing .dots span:nth-child(3) { animation-delay: .4s; }
  @keyframes dotPulse {
    0%, 80%, 100% { opacity: .3; transform: scale(.8); }
    40% { opacity: 1; transform: scale(1); }
  }
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): add chat CSS styles"
```

---

### Task 4: Frontend chat HTML + JavaScript in detail modal

**Files:**
- Modify: `public/index.html` (add chat section inside `openDetail()` template + add JS functions)

- [ ] **Step 1: Add chat section HTML inside `openDetail()` template**

In the `openDetail(id)` function, insert the chat section HTML **after the export section** (after `</div>` at line 1473) and **before the form-actions** (line 1475):

```js
    <div class="chat-section" id="chatSection">
      <h3 style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--border)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Assistant IA
      </h3>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-input">
        <input id="chatInput" placeholder="Pose une question sur ce skill..." onkeydown="if(event.key==='Enter')sendChatMessage(${id})">
        <button class="btn btn-primary btn-sm" onclick="sendChatMessage(${id})">Envoyer</button>
      </div>
    </div>
```

- [ ] **Step 2: Add chat JS variable and functions after `addLog()`**

After the `addLog()` function (after line 1536), insert:

```js
let chatMessages = [];

async function sendChatMessage(skillId) {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  chatMessages.push({ role: 'user', content: text });
  input.value = '';
  renderChat();

  const chatContainer = document.getElementById('chatMessages');
  const typingDiv = document.createElement('div');
  typingDiv.className = 'chat-typing';
  typingDiv.id = 'chatTyping';
  typingDiv.innerHTML = 'Assistant réfléchit<span class="dots"><span></span><span></span><span></span></span>';
  chatContainer.appendChild(typingDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const res = await api(`/skills/${skillId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ messages: chatMessages }),
    });
    chatMessages.push({ role: 'assistant', content: res.content });
  } catch (err) {
    chatMessages.push({ role: 'assistant', content: 'Désolé, l\'assistant est momentanément indisponible. Vérifie que le service IA est bien lancé.' });
  }

  renderChat();
}

function renderChat() {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const typingEl = document.getElementById('chatTyping');
  container.innerHTML = chatMessages.map(m => `
    <div class="chat-bubble ${m.role}">${esc(m.content)}</div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}
```

- [ ] **Step 3: Reset chat messages when opening detail**

In the `openDetail(id)` function, at the very beginning (after line 1402 `async function openDetail(id) {`), add:

```js
  chatMessages = [];
```

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): add chat assistant UI in skill detail modal"
```

---

### Task 5: Restart server + test

- [ ] **Step 1: Kill old server and restart**

```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
nohup node server.js > /tmp/server.log 2>&1 &
```

- [ ] **Step 2: Test the chat endpoint**

```bash
curl -s -X POST http://localhost:3000/api/skills/1/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Bonjour"}]}'
```

Expected: `{"content":"..."}` with a greeting from the AI (or error if Ollama not running)

- [ ] **Step 3: Verify server is up**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```
Expected: `200`

- [ ] **Step 4: Commit final changes**

```bash
git add -A
git commit -m "feat: AI chat assistant for skill incubation"
```

---

## Self-Review

- Spec coverage: All spec requirements are covered — server endpoint, skill context injection, provider flexibility (Ollama/OpenAI/Anthropic), chat UI with message history, typing indicator, error handling.
- Placeholder scan: No TBD/TODO placeholders. All code is written inline.
- Type consistency: Messages array format matches what the AI providers expect. `chatMessages` stores `{role, content}` objects matching OpenAI/Anthropic message format.
