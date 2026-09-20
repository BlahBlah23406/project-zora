'use strict';

require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');

const { startOllama, stopOllama }              = require('./ollama-manager');
const { readWhiteboard, setWhiteboard,
        getToday }                             = require('./memory');
const { loadAllTasks,
        addProject, updateProject,
        deleteProject, readNames,
        readProjects, writeProjects, writeNames } = require('./task-loader');
const { checkAndRunDailyReset,
        startDailyResetScheduler,
        taskComplete, taskArchive,
        taskReactivate, taskReset,
        createTask, confirmTask,
        rejectTask }                           = require('./memory-manager');
const { generateDayPlan }                      = require('./planner');
const calendarManager                          = require('./calendar-manager');
const tasksManager                             = require('./tasks-manager');
const emitter                                  = require('./emitter');
const { cleanNameLabels, cleanTypedNames, normalizeNameEntry, setNameEntry } = require('./names-registry');

const app         = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const CONTEXT_DIR = path.join(__dirname, '../context');
const PLANNING_PATH = path.join(CONTEXT_DIR, 'planning.md');
const RULES_PATH = path.join(CONTEXT_DIR, 'rules.md');

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const streamClients = new Set();

function broadcastEvent(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of streamClients) {
    try { res.write(data); } catch { streamClients.delete(res); }
  }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);
  streamClients.add(res);
  req.on('close', () => streamClients.delete(res));
});

emitter.on('ollama:prompt', ({ mode, model, system, prompt, messages }) => {
  broadcastEvent({
    type:   'prompt',
    mode,
    model,
    system: system || '',
    prompt: prompt || (messages ? messages.map((m) => `[${m.role}] ${m.content}`).join('\n') : ''),
    ts:     Date.now(),
  });
});

emitter.on('ollama:response', ({ mode, model, response, thinking, rawResponse }) => {
  broadcastEvent({ type: 'response', mode, model, response, thinking, rawResponse, ts: Date.now() });
});

app.get('/stream', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/stream.html'));
});


app.get('/api/auth-status', (_req, res) => res.json({ authenticated: true }));


app.get('/api/status', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


// ⚡ Bolt: Cache parsed quotes to prevent synchronous file read and regex parsing on every request
let cachedQuotes = null;
app.get('/api/quotes', (_req, res) => {
  try {
    if (!cachedQuotes) {
      const text   = fs.readFileSync(path.join(__dirname, '../galactic_wisdom.md'), 'utf8');
      const quotes = [];
      const re     = /\*\*"(.+?)"\*\* — \*(.+?)\*/g;
      let m;
      while ((m = re.exec(text)) !== null) quotes.push({ quote: m[1], speaker: m[2] });
      cachedQuotes = quotes;
    }
    res.json(cachedQuotes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/names', (_req, res) => {
  try {
    res.json(cleanNameLabels(readNames()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/names', (req, res) => {
  try {
    const { id, name, type } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });
    const { writeNames } = require('./task-loader');
    const names = readNames();
    setNameEntry(names, id, name, type || null);
    writeNames(names);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/plan', async (req, res) => {
  try {
    const { date } = req.query || {};
    broadcastEvent({ type: 'plan_step', text: 'Plan generation started', ts: Date.now() });
    const plan = await generateDayPlan(
      (label) => broadcastEvent({ type: 'plan_step', text: label, ts: Date.now() }),
      date
    );
    res.json(plan);
  } catch (err) {
    console.error('[server] /api/plan:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/plan/cached', (_req, res) => {
  const board = readWhiteboard();
  if (board.date) return res.json(board);
  res.status(404).json({ error: 'No cached plan' });
});


app.get('/api/today', async (_req, res) => {
  try {
    const today = getToday();
    const plan  = readWhiteboard();

    const [calendarEvents, tasks] = await Promise.all([
      calendarManager.loadTodayEvents(today).catch(() => []),
      Promise.resolve(tasksManager.loadTodayTasks()),
    ]);

    res.json({ plan, calendarEvents, tasks, date: today, names: cleanNameLabels(readNames()) });
  } catch (err) {
    console.error('[server] /api/today:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function sanitizeProject(project) {
  return {
    id: project.id,
    steps: Array.isArray(project.steps) ? project.steps : [],
    current_step: project.current_step ?? 0,
    deadline: project.deadline || null,
    priority_rank: project.priority_rank ?? 99,
    ai_notes: project.ai_notes || '',
    folder: project.folder || 'active',
    status: project.status || 'active',
  };
}

function sanitizeTask(task) {
  return {
    id: task.id,
    desc: task.desc || task.text || '',
    recurring: task.recurring || null,
    deadline: task.deadline || null,
    ai_notes: task.ai_notes || task.note || '',
    completed: Boolean(task.completed),
  };
}

function sanitizeEvent(event) {
  return {
    id:            event.id,
    date:          event.date          || null,
    recurring:     event.recurring     || null,
    time_start:    event.time_start    || null,
    time_end:      event.time_end      || null,
    strict_timing: Boolean(event.strict_timing),
    ai_notes:      event.ai_notes || event.note || '',
    completed:     Boolean(event.completed),
    exceptions:    Array.isArray(event.exceptions) ? event.exceptions : [],
  };
}

function sanitizePlan(plan) {
  const blocks = plan?.blocks || {};
  const normalizeItems = (items) => Array.isArray(items)
    ? items.filter((item) => item?.id).map((item) => ({
        id:         item.id,
        note:       item.note       || '',
        start_time: item.start_time || null,
        end_time:   item.end_time   || null,
      }))
    : [];

  return {
    ...readWhiteboard(),
    date: plan?.date || getToday(),
    blocks: {
      morning: normalizeItems(blocks.morning),
      afternoon: normalizeItems(blocks.afternoon),
      evening: normalizeItems(blocks.evening),
    },
    events: normalizeItems(plan?.events),
    tasks: normalizeItems(plan?.tasks),
  };
}

function applyBulletEdits(filePath, edits) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  let lines = current
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of edits.remove || []) {
    lines = lines.filter((existing) => existing !== line.trim());
  }

  for (const edit of edits.replace || []) {
    if (!edit?.from || !edit?.to) continue;
    lines = lines.map((existing) => existing === edit.from.trim() ? edit.to.trim() : existing);
  }

  for (const line of edits.add || []) {
    const clean = String(line || '').trim();
    if (!clean) continue;
    if (!lines.includes(clean)) lines.push(clean);
  }

  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

/**
 * Returns an array of { text, operation } for any remove/replace.from entries
 * that don't match an existing line in the file exactly.
 */
function verifyEdits(filePath, edits) {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = new Set(content.split('\n').map((l) => l.trim()).filter(Boolean));
  const issues = [];

  for (const line of edits.remove || []) {
    const text = String(line || '').trim();
    if (text && !lines.has(text)) issues.push({ text, operation: 'remove' });
  }

  for (const edit of edits.replace || []) {
    if (!edit?.from) continue;
    const text = String(edit.from).trim();
    if (text && !lines.has(text)) issues.push({ text, operation: 'replace.from' });
  }

  return issues;
}

/**
 * Qwen prompt: extract JSON edits from a natural-language analysis.
 * CRITICAL: remove/replace.from must be copied verbatim from the file contents shown.
 */
function buildQwenEditPrompt(naturalText, planning, rules) {
  return `Extract minimal edits to planning.md and rules.md from this analysis.

Analysis:
${naturalText}

Current planning.md (copy lines VERBATIM for remove/replace.from):
${planning || '(empty)'}

Current rules.md (copy lines VERBATIM for remove/replace.from):
${rules || '(empty)'}

Return JSON only — no markdown, no explanation:
{
  "planning": {
    "add": ["- ..."],
    "remove": ["- ..."],
    "replace": [{ "from": "- ...", "to": "- ..." }]
  },
  "rules": {
    "add": ["- ..."],
    "remove": ["- ..."],
    "replace": [{ "from": "- ...", "to": "- ..." }]
  }
}

Rules:
- Keep edits minimal — only what the analysis explicitly calls for.
- planning.md and rules.md are simple bullet lists only.
- rules.md must only contain planning and generation rules.
- For remove and replace.from: copy the line EXACTLY as it appears in the file above, character for character.
- If you are unsure of the exact wording, use add instead of remove/replace.
- If no edits are needed for a file, use empty arrays.`;
}

/**
 * Run the qwen→verify→deepseek-clarify loop.
 * naturalText: deepseek's natural-language analysis
 * deepseekSourcePrompt: the original prompt given to deepseek (for clarification context)
 * Returns { ok: boolean }
 */
async function applyEditsWithVerification(naturalText, deepseekSourcePrompt) {
  const { generate, extractJSON, OLLAMA_MODEL, OLLAMA_JSON_MODEL } = require('./ollama');
  const MAX_ATTEMPTS = 3;

  let qwenInput = naturalText;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const planning = fs.existsSync(PLANNING_PATH) ? fs.readFileSync(PLANNING_PATH, 'utf8') : '';
    const rules    = fs.existsSync(RULES_PATH)    ? fs.readFileSync(RULES_PATH,    'utf8') : '';

    let parsed = {};
    try {
      const rawEdits = await generate({
        model:   OLLAMA_JSON_MODEL,
        system:  'Output ONLY valid JSON. No markdown fences. No explanation.',
        prompt:  buildQwenEditPrompt(qwenInput, planning, rules),
        options: { temperature: 0.1, num_predict: 900 },
      });
      parsed = extractJSON(rawEdits) || {};
    } catch (err) {
      console.warn(`[editor] qwen extraction failed (attempt ${attempt}):`, err.message);
    }

    const planningEdits = parsed.planning || {};
    const rulesEdits    = parsed.rules    || {};

    const planningIssues = verifyEdits(PLANNING_PATH, planningEdits);
    const rulesIssues    = verifyEdits(RULES_PATH,    rulesEdits);

    if (planningIssues.length === 0 && rulesIssues.length === 0) {
      applyBulletEdits(PLANNING_PATH, planningEdits);
      applyBulletEdits(RULES_PATH,    rulesEdits);
      console.log(`[editor] Edits applied on attempt ${attempt}`);
      return { ok: true };
    }

    if (attempt === MAX_ATTEMPTS) {
      console.warn('[editor] Verification still failing after max attempts — discarding edits');
      return { ok: false };
    }

    // Ask deepseek to clarify which exact existing lines it meant
    const allIssues = [
      ...planningIssues.map((i) => ({ ...i, file: 'planning.md', content: planning })),
      ...rulesIssues.map((i)    => ({ ...i, file: 'rules.md',    content: rules    })),
    ];

    const issueList = allIssues
      .map((i) => `- "${i.text}" (wanted to ${i.operation} in ${i.file})`)
      .join('\n');

    console.log(`[editor] Verification attempt ${attempt} failed — asking deepseek to clarify`);
    const clarification = await generate({
      model:  OLLAMA_MODEL,
      system: 'You clarify which exact existing bullet lines you meant. Be precise. No preamble.',
      prompt: `Your analysis was:
${deepseekSourcePrompt}

You said:
${naturalText}

These lines you referenced don't match any existing bullet in the files:
${issueList}

Current planning.md:
${planning || '(empty)'}

Current rules.md:
${rules || '(empty)'}

For each unmatched line, identify the EXACT existing bullet it corresponds to.
Use the format: meant: "<unmatched>" → exact: "<exact line from file>"
If no existing line matches and the intent is to add something new, write: meant: "<unmatched>" → action: add`,
      options: { temperature: 0.2, num_predict: 600 },
    });

    qwenInput = naturalText + '\n\nClarification of exact lines:\n' + clarification;
  }

  return { ok: false };
}

async function runEditorReflection({ reason, summary, plan, projects, tasks, events }) {
  const { generate, OLLAMA_MODEL } = require('./ollama');
  const planning = fs.existsSync(PLANNING_PATH) ? fs.readFileSync(PLANNING_PATH, 'utf8') : '';
  const rules    = fs.existsSync(RULES_PATH)    ? fs.readFileSync(RULES_PATH,    'utf8') : '';

  const sourcePrompt = `A user edited today's plan.

Edit summary:
${summary || '(none)'}

Reason:
${reason}

Current plan:
${JSON.stringify(plan)}

Projects:
${JSON.stringify(projects).slice(0, 2500)}

Tasks:
${JSON.stringify(tasks).slice(0, 2500)}

Events:
${JSON.stringify(events).slice(0, 2500)}

Current planning.md:
${planning}

Current rules.md:
${rules}

Analyze what the planner should learn from this edit. Describe in natural language what changes, if any, should be made to planning.md or rules.md. Be specific about which existing rules need updating and what new rules or notes to add.`;

  const analysis = await generate({
    model:  OLLAMA_MODEL,
    system: 'You analyze planning edits and describe what the planner should learn. Be specific and concise.',
    prompt: sourcePrompt,
    options: { temperature: 0.3, num_predict: 600 },
  });

  await applyEditsWithVerification(analysis, sourcePrompt);
}

app.get('/api/editor/context', async (req, res) => {
  try {
    const date = req.query.date || getToday();
    const plan = readWhiteboard();
    const names = cleanNameLabels(readNames());
    const projects = readProjects().projects || [];
    const tasks = tasksManager.loadAllTasks();
    const events = calendarManager.loadAllEvents();
    res.json({ date, plan, names, projects, tasks, events });
  } catch (err) {
    console.error('[server] /api/editor/context:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/editor/save', async (req, res) => {
  try {
    const {
      plan,
      projects,
      tasks,
      events,
      names,
      reason,
      summary,
    } = req.body || {};

    const currentNames = readNames();
    for (const [id, value] of Object.entries(cleanTypedNames(names || {}))) {
      const prior = normalizeNameEntry(currentNames[id]);
      const next = normalizeNameEntry(value);
      if (prior.label && prior.type && next.type && prior.type !== next.type) {
        throw new Error(`ID '${id}' already exists as a ${prior.type}, not a ${next.type}`);
      }
    }

    if (plan) setWhiteboard(sanitizePlan(plan));
    if (Array.isArray(projects)) writeProjects({ projects: projects.map(sanitizeProject) });
    if (Array.isArray(tasks)) tasksManager.replaceAllTasks(tasks.map(sanitizeTask));
    if (Array.isArray(events)) calendarManager.replaceAllEvents(events.map(sanitizeEvent));
    if (names && typeof names === 'object') {
      const merged = { ...currentNames };
      for (const [id, value] of Object.entries(cleanTypedNames(names))) {
        const prior = normalizeNameEntry(currentNames[id]);
        const next = normalizeNameEntry(value, prior.type || null);
        merged[id] = {
          label: next.label || prior.label || id,
          type: next.type || prior.type || null,
        };
      }
      writeNames(merged);
    }

    if (reason && String(reason).trim()) {
      Promise.resolve()
        .then(() => runEditorReflection({
          reason: String(reason).trim(),
          summary: summary || '',
          plan: sanitizePlan(plan),
          projects: Array.isArray(projects) ? projects.map(sanitizeProject) : [],
          tasks: Array.isArray(tasks) ? tasks.map(sanitizeTask) : [],
          events: Array.isArray(events) ? events.map(sanitizeEvent) : [],
        }))
        .catch((err) => console.error('[server] editor reflection failed:', err.message));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[server] /api/editor/save:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/tasks', (_req, res) => {
  try { res.json(loadAllTasks()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/task-complete', async (req, res) => {
  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  try {
    const entry = await taskComplete(taskId);
    res.json({ ok: true, task: entry });
  } catch (err) {
    console.error('[server] /api/task-complete:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/task-reset', async (req, res) => {
  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  try {
    const entry = await taskReset(taskId);
    res.json({ ok: true, task: entry });
  } catch (err) {
    console.error('[server] /api/task-reset:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/task-archive', async (req, res) => {
  const { taskId, reason } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  try {
    const entry = await taskArchive(taskId, reason || '');
    res.json({ ok: true, task: entry });
  } catch (err) {
    console.error('[server] /api/task-archive:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/task-reactivate', async (req, res) => {
  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  try {
    const entry = await taskReactivate(taskId);
    res.json({ ok: true, task: entry });
  } catch (err) {
    console.error('[server] /api/task-reactivate:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/new-task', async (req, res) => {
  const { description, name, rank } = req.body || {};
  if (!description && !name) return res.status(400).json({ error: 'description or name required' });
  try {
    const preview = await createTask({ description: description || name, rank });
    res.json(preview);
  } catch (err) {
    console.error('[server] /api/new-task:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/confirm-task', async (req, res) => {
  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  try {
    const entry = await confirmTask(taskId);
    res.json({ ok: true, task: entry });
  } catch (err) {
    console.error('[server] /api/confirm-task:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reject-task', (req, res) => {
  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  try {
    rejectTask(taskId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[server] /api/reject-task:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/add', (req, res) => {
  try {
    const project = addProject(req.body || {});
    res.json({ ok: true, project });
  } catch (err) {
    console.error('[server] /api/projects/add:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/update', (req, res) => {
  const { id, changes } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const project = updateProject(id, changes || {});
    res.json({ ok: true, project });
  } catch (err) {
    console.error('[server] /api/projects/update:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/delete', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const result = deleteProject(id);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[server] /api/projects/delete:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/calendar/add', (req, res) => {
  try {
    const event = calendarManager.addEvent(req.body || {});
    res.json({ ok: true, event });
  } catch (err) {
    console.error('[server] /api/calendar/add:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar/update', (req, res) => {
  const { id, changes } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const event = calendarManager.updateEvent(id, changes || {});
    res.json({ ok: true, event });
  } catch (err) {
    console.error('[server] /api/calendar/update:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar/delete', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const result = calendarManager.deleteEvent(id);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[server] /api/calendar/delete:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar/archive', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const event = calendarManager.archiveEvent(id);
    res.json({ ok: true, event });
  } catch (err) {
    console.error('[server] /api/calendar/archive:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar/exception', (req, res) => {
  const { id, date } = req.body || {};
  if (!id || !date) return res.status(400).json({ error: 'id and date required' });
  try {
    const event = calendarManager.addException(id, date);
    res.json({ ok: true, event });
  } catch (err) {
    console.error('[server] /api/calendar/exception:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar/reorder', (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });
  try {
    calendarManager.reorderEvents(orderedIds);
    res.json({ ok: true });
  } catch (err) {
    console.error('[server] /api/calendar/reorder:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/tasks/add', (req, res) => {
  try {
    const task = tasksManager.addTask(req.body || {});
    res.json({ ok: true, task });
  } catch (err) {
    console.error('[server] /api/tasks/add:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks/complete', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const task = tasksManager.completeTask(id);
    res.json({ ok: true, task });
  } catch (err) {
    console.error('[server] /api/tasks/complete:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks/delete', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const result = tasksManager.deleteTask(id);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[server] /api/tasks/delete:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks/update', (req, res) => {
  const { id, changes } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const task = tasksManager.updateTask(id, changes || {});
    res.json({ ok: true, task });
  } catch (err) {
    console.error('[server] /api/tasks/update:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/close-day', async (_req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const today = getToday();

  try {
    send({ step: 1, label: 'Archiving today\'s plan', status: 'running' });
    try {
      const board = readWhiteboard();
      if (board.date === today) {
        const { generate, OLLAMA_MODEL } = require('./ollama');
        const planningPath = path.join(CONTEXT_DIR, 'planning.md');
        const planning = fs.existsSync(planningPath)
          ? fs.readFileSync(planningPath, 'utf8').slice(-400)
          : '';

        const raw = await generate({
          model:  OLLAMA_MODEL,
          system: 'Write a brief daily summary entry for planning.md. 3-5 bullets. No preamble.',
          prompt: `Date: ${today}
Plan blocks: ${JSON.stringify(board.blocks || {})}
Important events: ${board.important_events || 'none'}
Deadlines: ${board.deadlines || 'none'}
Recent planning context: ${planning}

Summarise today in 3–5 bullets: what was planned, any deadlines met, what carries forward.
Output only bullet points.`,
          options: { temperature: 0.4, num_predict: 300 },
        });

        if (raw && raw.trim()) {
          fs.appendFileSync(planningPath, `\n## Day Log — ${today}\n${raw.trim()}\n`, 'utf8');
        }
        send({ step: 1, label: 'Today\'s plan archived to planning.md', status: 'done' });
      } else {
        send({ step: 1, label: 'No plan for today to archive', status: 'skipped' });
      }
    } catch (err) {
      send({ step: 1, label: `Archive: ${err.message}`, status: 'error' });
    }

    send({ complete: true, message: 'Good night.' });
  } catch (err) {
    console.error('[server] /api/close-day:', err.message);
    send({ complete: true, error: err.message });
  }

  res.end();
});


app.get('/api/context-status', (_req, res) => res.json({ planningReviewPending: false }));


app.post('/api/reset-conversation', (_req, res) => res.json({ ok: true }));


app.post('/api/advance-day', (_req, res) => res.json({ ok: false, message: 'Not implemented' }));


app.post('/api/journal/v2', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const { rating, entry, taskProgress } = req.body || {};

  try {
    send({ step: 1, label: 'Saving journal entry', status: 'running' });

    if (entry || rating || (taskProgress && taskProgress.length)) {
      const today = getToday();
      const lines = [`\n## EOD Journal — ${today}`];
      if (rating)  lines.push(`- Rating: ${rating}/5`);
      if (entry)   lines.push(`- Notes: ${entry}`);
      for (const t of taskProgress || []) {
        lines.push(`- ${t.taskName}: ${t.interpretation} (${t.progressPct}%)`);
      }
      fs.appendFileSync(PLANNING_PATH, lines.join('\n') + '\n', 'utf8');
    }

    send({ step: 1, label: 'Journal saved', status: 'done' });
    send({ complete: true, message: 'Journal processed.' });
  } catch (err) {
    console.error('[server] /api/journal/v2:', err.message);
    send({ complete: true, error: err.message });
  }

  res.end();
});


app.post('/api/message/stream', async (req, res) => {
  const { generateStream, OLLAMA_MODEL } = require('./ollama');

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const send = (obj) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* client gone */ }
  };

  const { message, plan } = req.body || {};
  if (!message) {
    send({ type: 'error', error: 'No message provided.' });
    return res.end();
  }

  const planning = fs.existsSync(PLANNING_PATH) ? fs.readFileSync(PLANNING_PATH, 'utf8') : '';
  const rules    = fs.existsSync(RULES_PATH)    ? fs.readFileSync(RULES_PATH,    'utf8') : '';

  const projects = readProjects().projects || [];
  const allTasks = tasksManager.loadAllTasks();

  const planSummary = plan
    ? `Morning: ${(plan.blocks?.morning || []).map((i) => i.id).join(', ') || '(none)'}
Afternoon: ${(plan.blocks?.afternoon || []).map((i) => i.id).join(', ') || '(none)'}
Evening: ${(plan.blocks?.evening || []).map((i) => i.id).join(', ') || '(none)'}`
    : '(no plan loaded)';

  const systemPrompt = `You are Zora, a personal planning assistant. You speak naturally and concisely. You know the user's schedule, projects, and rules. When the user asks to change planning.md or rules.md, describe the change clearly so it can be applied. Never output raw JSON.`;

  const contextPrompt = `Today's plan:
${planSummary}

Projects (top 5 by priority):
${projects.slice(0, 5).map((p) => `  ${p.id} — rank ${p.priority_rank ?? '?'}${p.deadline ? `, deadline ${p.deadline}` : ''}`).join('\n') || '  (none)'}

Tasks:
${allTasks.slice(0, 8).map((t) => `  ${t.id}${t.deadline ? ` (due ${t.deadline})` : ''}`).join('\n') || '  (none)'}

planning.md:
${planning}

rules.md:
${rules}

User message: ${message}`;

  let fullResponse = '';
  try {
    fullResponse = await generateStream(
      {
        model:   OLLAMA_MODEL,
        system:  systemPrompt,
        prompt:  contextPrompt,
        options: { temperature: 0.6, num_predict: 800 },
      },
      (token) => send({ type: 'token', token }),
    );
  } catch (err) {
    console.error('[server] /api/message/stream generate error:', err.message);
    send({ type: 'error', error: 'Model error: ' + err.message });
    return res.end();
  }

  send({ type: 'done' });
  res.end();

  if (fullResponse.trim()) {
    setImmediate(() => {
      applyEditsWithVerification(fullResponse, contextPrompt).catch((err) =>
        console.warn('[server] message edit apply failed:', err.message)
      );
    });
  }
});


app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});


function startFileWatcher() {
  let chokidar;
  try { chokidar = require('chokidar'); }
  catch { console.warn('[watcher] chokidar not installed — file watching disabled'); return; }

  const watcher = chokidar.watch(CONTEXT_DIR, {
    ignoreInitial: true,
    persistent:    true,
    depth:         1,
  });

  watcher.on('change', (filePath) => {
    const rel = path.relative(CONTEXT_DIR, filePath);
    console.log(`[watcher] Changed: ${rel}`);
    broadcastEvent({ type: 'context_changed', file: rel, ts: Date.now() });
  });

  watcher.on('error', (err) => console.error('[watcher] Error:', err.message));
  console.log(`[watcher] Watching ${CONTEXT_DIR}`);
}


function startServer(preferredPort, maxAttempts = 20) {
  return new Promise((resolve, reject) => {
    const attemptListen = (port, attemptsLeft) => {
      const server = app.listen(port);

      server.once('listening', () => {
        if (port !== preferredPort) {
          console.warn(`[server] Port ${preferredPort} is busy; using ${port} instead`);
        }
        console.log(`\n  Zora  →  http://localhost:${port}\n`);
        resolve(server);
      });

      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attemptsLeft > 1) {
          attemptListen(port + 1, attemptsLeft - 1);
          return;
        }
        reject(err);
      });
    };

    attemptListen(preferredPort, maxAttempts);
  });
}

async function main() {
  try { await startOllama(); }
  catch (err) { console.warn('[server] Ollama warning:', err.message); }

  await startServer(DEFAULT_PORT);

  Promise.resolve()
    .then(() => checkAndRunDailyReset())
    .then(() => startDailyResetScheduler())
    .catch((err) => console.error('[server] Startup task failed:', err.message));

  startFileWatcher();
}

function shutdown(sig) {
  console.log(`\n[server] ${sig} — shutting down`);
  stopOllama();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => { console.error('[server] Fatal:', err); process.exit(1); });
