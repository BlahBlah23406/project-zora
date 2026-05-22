'use strict';

const fs   = require('fs');
const path = require('path');

const { readMemoryLog, writeMemoryLog, appendMemoryEntry, getToday } = require('./memory');
const { loadAllTasks }    = require('./task-loader');
const { buildMasterContext } = require('./context-builder');
const { generate, OLLAMA_MODEL } = require('./ollama');

const CONTEXT_DIR   = path.join(__dirname, '../context');
const PROJECTS_PATH = path.join(CONTEXT_DIR, 'projects.json');
const PLANNING_PATH = path.join(CONTEXT_DIR, 'planning.md');

let _conversationHistory = null;

function setConversationHistoryRef(ref) { _conversationHistory = ref; }

function readIndex() {
  try { return JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf8')); }
  catch { return { projects: [] }; }
}

function writeIndex(data) {
  fs.writeFileSync(PROJECTS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function todayStr() { return getToday(); }
function getTodayDate() { return new Date(getToday() + 'T12:00:00'); }
function isSunday() { return getTodayDate().getDay() === 0; }
function isFirstSundayOfMonth() {
  const d = getTodayDate();
  return d.getDay() === 0 && d.getDate() <= 7;
}

// planning.md: only "append" or "draft" writes are allowed.
function safeWrite(filePath, content, mode = 'overwrite') {
  const rel = path.relative(CONTEXT_DIR, filePath);

  if (rel === 'planning.md') {
    if (mode === 'overwrite') {
      const msg = `[safeWrite] BLOCKED: planning.md does not allow "overwrite"`;
      console.warn(msg);
      throw new Error(msg);
    }
    if (mode === 'draft') {
      fs.appendFileSync(filePath, `\n\n[DRAFT]\n${content}\n[/DRAFT]\n`, 'utf8');
      const memLog = readMemoryLog();
      memLog.planning_review_pending = true;
      writeMemoryLog(memLog);
      return;
    }
    fs.appendFileSync(filePath, '\n\n' + content, 'utf8');
    return;
  }

  if (mode === 'overwrite' && fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, filePath + '.bak');
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

async function suggestThemeForReset(tasks, memLog) {
  const active       = tasks.filter((t) => t.status === 'active').map((t) => t.name);
  const stale        = tasks.filter((t) => t.status === 'stale').map((t) => t.name);
  const recentThemes = (memLog.daily_logs || []).slice(-3).map((d) => d.theme).filter(Boolean);

  try {
    const raw = await generate({
      model:  OLLAMA_MODEL,
      system: 'You suggest specific, actionable daily themes. Output only valid JSON, no other text.',
      prompt: `Active projects: ${active.join(', ') || 'none'}
Stale projects: ${stale.join(', ') || 'none'}
Alert: ${memLog.currentAlert || 'green'}
Recent themes (do NOT repeat): ${recentThemes.join(', ') || 'none'}

Suggest ONE focused theme for today as JSON:
{"name":"...","icon":"...","description":"..."}

Output ONLY the JSON object.`,
      options: { temperature: 0.7, num_predict: 200 },
    });

    const { extractJSON } = require('./ollama');
    const theme = extractJSON(raw);
    if (!theme) throw new Error('No JSON found');
    return theme;
  } catch (err) {
    console.warn('[memory-manager] suggestTheme failed:', err.message);
    return { name: 'Build & Ship', icon: '⚡', description: 'Focus on shipping something tangible today.' };
  }
}

async function dailyReset() {
  console.log('[memory-manager] Running daily reset...');
  const memLog = readMemoryLog();
  const today  = todayStr();

  const todayEntries = (memLog.entries || []).filter(
    (e) => e.timestamp && e.timestamp.startsWith(today)
  );
  const touchedToday = new Set(
    todayEntries.filter((e) => e.taskId).map((e) => e.taskId)
  );

  const dailyLogEntry = {
    date:         today,
    theme:        memLog.todayTheme || '',
    alert:        memLog.currentAlert || 'green',
    tasks_worked: [...touchedToday],
    tasks_missed: [],
    entry_count:  todayEntries.length,
    closed_at:    new Date().toISOString(),
  };

  if (!memLog.pushup_counter) memLog.pushup_counter = { total_owed: 0, completed: 0, log: [] };
  if (!memLog.daysSinceWorked) memLog.daysSinceWorked = {};

  const tasks = loadAllTasks();
  const index = readIndex();

  for (const task of tasks) {
    if (touchedToday.has(task.id)) {
      memLog.daysSinceWorked[task.id] = 0;
    } else {
      memLog.daysSinceWorked[task.id] = (memLog.daysSinceWorked[task.id] || 0) + 1;
      dailyLogEntry.tasks_missed.push(task.id);
    }
    const entry = (index.projects || []).find((t) => t.id === task.id);
    if (entry) entry.days_since_worked = memLog.daysSinceWorked[task.id];
  }
  writeIndex(index);

  const { updateWhiteboard } = require('./memory');
  updateWhiteboard({ lastPlan: null, lastPlanAt: null, taskLogs: {} });

  if (_conversationHistory) _conversationHistory.length = 0;
  memLog.todayTheme       = '';
  memLog.lastDailyReset   = today;
  memLog.dayApproved      = null;
  memLog.todayAdjustments = [];

  if (!memLog.daily_logs) memLog.daily_logs = [];
  memLog.daily_logs.push(dailyLogEntry);
  writeMemoryLog(memLog);

  console.log('[memory-manager] Daily reset complete');

  try { await buildMasterContext(); }
  catch (e) { console.warn('[memory-manager] Master context rebuild failed:', e.message); }

  try {
    const theme = await suggestThemeForReset(tasks, memLog);
    const fresh = readMemoryLog();
    fresh.todayTheme = theme.name;
    writeMemoryLog(fresh);
    console.log(`[memory-manager] Tomorrow's suggested theme: ${theme.name}`);
  } catch (e) {
    console.warn('[memory-manager] Theme suggestion failed:', e.message);
  }

  if (isSunday()) {
    console.log('[memory-manager] Sunday — running weekly memory update');
    await weeklyMemoryUpdate().catch((e) =>
      console.error('[memory-manager] Weekly update failed:', e.message)
    );
  }

  await condensePlanningIfNeeded().catch((e) =>
    console.warn('[memory-manager] Planning condense failed:', e.message)
  );
}

async function weeklyMemoryUpdate() {
  console.log('[memory-manager] Running weekly memory update...');
  const memLog = readMemoryLog();
  const last7  = (memLog.daily_logs || []).slice(-7);

  if (last7.length === 0) {
    console.log('[memory-manager] No daily logs yet — skipping weekly update');
    return;
  }

  const logsText = last7.map((d) =>
    `Date: ${d.date} | Theme: ${d.theme || '—'} | Alert: ${d.alert} | ` +
    `Worked: ${(d.tasks_worked || []).join(', ') || 'none'} | ` +
    `Missed: ${(d.tasks_missed || []).slice(0, 5).join(', ') || 'none'}`
  ).join('\n');

  const dateRange = `${last7[0].date} – ${last7[last7.length - 1].date}`;

  try {
    const entry = await generate({
      model:  OLLAMA_MODEL,
      system: 'You write concise weekly memory entries for a personal AI system. Be honest and specific. Always use exact YYYY-MM-DD dates. Name tasks, people, and events by their actual names — never say "a task" or "someone", always use the real name.',
      prompt: `Given these 7 daily logs, write a weekly memory entry in this exact format:

## Week of ${dateRange}
**Wins:** (bullet list)
**Struggles:** (bullet list)
**Patterns noticed:** (bullet list)
**Theme effectiveness:** (bullet list)
**Adjustments made:** (bullet list)
**Time estimation notes:** For each task that appeared in the week, note whether it was consistently completed, consistently skipped, or mixed.

Daily logs:
${logsText}

Be specific and honest. Use exact YYYY-MM-DD dates. Under 400 tokens. Output only the markdown entry.`,
      options: { temperature: 0.5, num_predict: 800 },
    });

    safeWrite(PLANNING_PATH, entry.trim(), 'append');
    console.log('[memory-manager] Weekly entry appended to planning.md');
    appendMemoryEntry({ type: 'weekly-update', content: `Weekly update written for ${dateRange}` });
  } catch (err) {
    console.error('[memory-manager] Weekly memory update failed:', err.message);
  }

  if (isFirstSundayOfMonth()) {
    console.log('[memory-manager] First Sunday of month — running monthly planning update');
    await monthlyPlanningUpdate().catch((e) =>
      console.error('[memory-manager] Monthly planning failed:', e.message)
    );
  }
}

async function monthlyPlanningUpdate() {
  console.log('[memory-manager] Running monthly planning update...');

  const planningContent = fs.existsSync(PLANNING_PATH) ? fs.readFileSync(PLANNING_PATH, 'utf8') : '';
  const weeklyEntries   = planningContent.split(/(?=## Week of )/).slice(-4).join('\n');
  const monthName       = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  try {
    const draft = await generate({
      model:  OLLAMA_MODEL,
      system: 'You write monthly planning reviews for a personal AI system. Be direct and specific. Use exact YYYY-MM-DD dates.',
      prompt: `Based on these weekly memory logs and current project state, write a monthly planning DRAFT.

## Monthly Review — ${monthName}
**Status: DRAFT**
### What the AI noticed this month: (bullets)
### Suggested priority adjustments: (bullets)
### Projects to consider deprioritizing: (bullets)
### Projects to escalate: (bullets)

Under 400 tokens. Be direct and specific.

Weekly memory (last 4 weeks):
${weeklyEntries || '(no weekly entries yet)'}

Planning file excerpt:
${planningContent.slice(0, 800)}

Output ONLY the markdown draft section.`,
      options: { temperature: 0.4, num_predict: 800 },
    });

    safeWrite(PLANNING_PATH, draft.trim(), 'draft');
    console.log('[memory-manager] Monthly planning draft appended to planning.md');
    appendMemoryEntry({ type: 'monthly-planning', content: `Monthly planning draft written for ${monthName}` });
  } catch (err) {
    console.error('[memory-manager] Monthly planning update failed:', err.message);
  }
}

async function taskComplete(taskId) {
  console.log(`[memory-manager] Completing task: ${taskId}`);
  const index = readIndex();
  const entry = (index.projects || []).find((t) => t.id === taskId);
  if (!entry) throw new Error(`Task '${taskId}' not found in projects.json`);

  entry.folder    = 'completed';
  entry.status    = 'completed';
  entry.completed = todayStr();
  writeIndex(index);
  appendMemoryEntry({ type: 'task-complete', content: `Completed: ${taskId}`, taskId });

  try { await buildMasterContext(); }
  catch (e) { console.warn('[memory-manager] Master context rebuild failed:', e.message); }

  return entry;
}

async function taskArchive(taskId, reason = '') {
  console.log(`[memory-manager] Archiving task: ${taskId} — ${reason}`);
  const index = readIndex();
  const entry = (index.projects || []).find((t) => t.id === taskId);
  if (!entry) throw new Error(`Task '${taskId}' not found in projects.json`);

  entry.folder        = 'archived';
  entry.status        = 'archived';
  entry.archived      = todayStr();
  entry.archiveReason = reason || '';
  writeIndex(index);
  appendMemoryEntry({ type: 'task-archive', content: `Archived: ${taskId} — ${reason}`, taskId });

  try { await buildMasterContext(); }
  catch (e) { console.warn('[memory-manager] Master context rebuild failed:', e.message); }

  return entry;
}

async function taskReactivate(taskId) {
  console.log(`[memory-manager] Reactivating task: ${taskId}`);
  const index = readIndex();
  const entry = (index.projects || []).find((t) => t.id === taskId);
  if (!entry) throw new Error(`Task '${taskId}' not found in projects.json`);

  entry.folder    = 'active';
  entry.status    = 'active';
  entry.completed = null;
  entry.archived  = null;
  writeIndex(index);
  appendMemoryEntry({ type: 'task-reactivate', content: `Reactivated: ${taskId}`, taskId });

  try { await buildMasterContext(); }
  catch (e) { console.warn('[memory-manager] Master context rebuild failed:', e.message); }

  return entry;
}

async function taskReset(taskId) {
  console.log(`[memory-manager] Resetting task: ${taskId}`);
  const index = readIndex();
  const entry = (index.projects || []).find((t) => t.id === taskId);
  if (!entry) throw new Error(`Task '${taskId}' not found in projects.json`);

  entry.status    = 'active';
  entry.todayStep = '';
  writeIndex(index);

  const memLog = readMemoryLog();
  if (memLog.taskProgress?.[taskId])    delete memLog.taskProgress[taskId];
  if (memLog.daysSinceWorked?.[taskId]) memLog.daysSinceWorked[taskId] = 0;

  appendMemoryEntry({ type: 'task-reset', content: `Reset: ${taskId}`, taskId });
  writeMemoryLog(memLog);

  return entry;
}

async function createTask(taskData) {
  const { description, rank } = taskData;
  if (!description) throw new Error('createTask: description required');

  console.log(`[memory-manager] Creating task: ${description.slice(0, 60)}...`);

  let raw;
  try {
    raw = await generate({
      model:  OLLAMA_MODEL,
      system: 'You generate project JSON for a personal productivity system. Output ONLY valid JSON, no explanation, no code fences.',
      prompt: `Generate a project JSON object for: ${description}

Output this exact JSON shape:
{
  "id": "kebab-case-id (max 4 words from description)",
  "name": "Project Name (title case, for display only)",
  "priority_rank": ${rank || 6},
  "steps": ["first actionable step", "second step", "third step"],
  "deadline": null,
  "ai_notes": "one sentence — what done looks like, specific and measurable"
}`,
      options: { temperature: 0.5, num_predict: 300 },
    });
  } catch (err) {
    throw new Error(`createTask: AI generation failed — ${err.message}`);
  }

  const { extractJSON } = require('./ollama');
  const { writeNames, readNames } = require('./task-loader');
  const { setNameEntry } = require('./names-registry');
  const parsed = extractJSON(raw) || {};

  const taskId   = (parsed.id || description.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)).trim();
  const taskName = parsed.name || description;

  const names = readNames();
  setNameEntry(names, taskId, taskName, 'project');
  writeNames(names);

  const index = readIndex();
  index.projects = (index.projects || []).filter((t) => t.id !== taskId);
  index.projects.push({
    id:            taskId,
    steps:         parsed.steps        || [],
    current_step:  0,
    deadline:      parsed.deadline     || null,
    priority_rank: parsed.priority_rank ?? (rank || 6),
    ai_notes:      parsed.ai_notes     || '',
    status:        'active',
    folder:        'new',
  });
  writeIndex(index);

  appendMemoryEntry({ type: 'task-created', content: `New project staged: ${taskId} — ${taskName}`, taskId });

  return { id: taskId, name: taskName, priority_rank: parsed.priority_rank ?? (rank || 6), folder: 'new', description };
}

async function confirmTask(taskId) {
  console.log(`[memory-manager] Confirming task: ${taskId}`);
  const index = readIndex();
  const entry = (index.projects || []).find((t) => t.id === taskId);
  if (!entry) throw new Error(`Task '${taskId}' not found in projects.json`);

  entry.folder = 'active';
  entry.status = 'active';
  writeIndex(index);

  appendMemoryEntry({ type: 'task-confirmed', content: `Task confirmed: ${taskId}`, taskId });
  try { await buildMasterContext(); } catch {}

  return entry;
}

function rejectTask(taskId) {
  console.log(`[memory-manager] Rejecting task: ${taskId}`);
  const index = readIndex();
  index.projects = (index.projects || []).filter((t) => t.id !== taskId);
  writeIndex(index);
  appendMemoryEntry({ type: 'task-rejected', content: `Task rejected: ${taskId}`, taskId });
}

const NEW_TASK_PHRASES = [
  'new task', 'add task', 'create task', 'add project', 'new project',
  'i want to work on', 'add to my tasks', 'add to tasks',
];

function detectNewTask(message) {
  const lower = message.toLowerCase();
  return NEW_TASK_PHRASES.some((p) => lower.includes(p));
}

async function alertChange(newAlert, subCalls = []) {
  console.log(`[memory-manager] Alert → ${newAlert}`);
  const memLog = readMemoryLog();
  const prev   = memLog.currentAlert;
  memLog.currentAlert = newAlert;
  memLog.subCalls     = subCalls;
  writeMemoryLog(memLog);

  if (_conversationHistory) _conversationHistory.length = 0;

  appendMemoryEntry({
    type:    'alert-change',
    content: `Alert: ${prev} → ${newAlert}. SubCalls: ${subCalls.join(' | ')}`,
  });

  if (newAlert === 'green' && prev === 'red') {
    appendMemoryEntry({ type: 'incident-closed', content: `Red alert closed → green` });
  }

  if (newAlert === 'pink') await pinkSweep();

  try {
    const master = await buildMasterContext();
    return { ok: true, masterContext: master };
  } catch (e) {
    console.warn('[memory-manager] Master context rebuild failed:', e.message);
    return { ok: true };
  }
}

async function whiteboardRefresh() {
  console.log('[memory-manager] whiteboardRefresh: not yet implemented');
  const memLog = readMemoryLog();
  memLog.whiteboardLastRead         = new Date().toISOString();
  memLog.whiteboard_cache_last_read = new Date().toISOString();
  writeMemoryLog(memLog);
  appendMemoryEntry({ type: 'whiteboard-refresh', content: 'Stub: whiteboard refresh not yet implemented' });
}

async function pinkSweep() {
  console.log('[memory-manager] Running Pink Sweep...');
  const tasks  = loadAllTasks();
  const memLog = readMemoryLog();
  const index  = readIndex();

  let staleCount = 0;
  for (const entry of (index.projects || [])) {
    if (entry.folder !== 'active') continue;
    const dsw = memLog.daysSinceWorked?.[entry.id] || 0;
    if (dsw > 7 && entry.status === 'active') { entry.status = 'stale'; staleCount++; }
  }
  if (staleCount > 0) writeIndex(index);

  const staleIds = tasks.filter((t) => t.status === 'stale').map((t) => t.id);
  appendMemoryEntry({
    type:    'pink-sweep',
    content: `Pink Sweep started. Newly marked stale: ${staleCount}. All stale: ${staleIds.join(', ') || 'none'}`,
  });

  const lastRead  = memLog.whiteboardLastRead ? new Date(memLog.whiteboardLastRead) : null;
  const daysSince = lastRead ? Math.floor((Date.now() - lastRead) / 86_400_000) : 999;
  if (daysSince >= 2) await whiteboardRefresh();

  return [
    { item: 'Review Arc Board',               done: false },
    { item: 'Review Discord + email',          done: false },
    { item: 'Review Google Drive',             done: false },
    { item: 'Clean physical desk and papers',  done: false },
    { item: 'Update all task files',           done: false },
  ];
}

async function extractMemory(userMessage, aiResponse, masterCtx = '') {
  const prompt =
`You are a memory extraction agent for a personal AI management system.

Current master context (brief):
${masterCtx.slice(0, 1200)}

User message: "${userMessage}"
AI response: "${aiResponse}"

Decide if this exchange contains NEW information worth saving long-term.
Only save genuinely durable facts — not routine status updates.

Save to long_term_memory if the exchange reveals:
- New personal facts, preferences, habits, or constraints
- Behavioral patterns, recurring struggles or wins
- Significant changes to how projects should be approached

Save to long_term_planning if the exchange contains:
- Explicit future intentions or new confirmed goals
- Deadlines or milestones the user stated

SPECIFICITY RULES: Convert relative dates to absolute YYYY-MM-DD. Include specific names.

If nothing is worth saving, output exactly: nothing

Otherwise output valid JSON only:
{"file": "long_term_memory" | "long_term_planning", "content": "the markdown text to append — brief, factual, 1-4 lines"}`;

  let raw;
  try {
    raw = await generate({
      model:   OLLAMA_MODEL,
      system:  'You are a memory extraction agent. Output ONLY valid JSON or the single word "nothing". No explanation.',
      prompt,
      options: { temperature: 0.2, num_predict: 300 },
    });
  } catch (err) {
    console.warn('[memory-manager] extractMemory generate failed:', err.message);
    return;
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'nothing') return;

  let result;
  try {
    const jsonStr = trimmed.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) return;
    result = JSON.parse(jsonStr);
  } catch { return; }

  if (!result?.file || !result?.content) return;
  if (!['long_term_memory', 'long_term_planning'].includes(result.file)) return;

  try {
    safeWrite(PLANNING_PATH, result.content.trim(), 'append');
    console.log(`[memory-manager] extractMemory → appended to planning.md`);
    buildMasterContext().catch(() => {});
  } catch (err) {
    console.warn('[memory-manager] extractMemory write failed:', err.message);
  }
}

const LTP_CONDENSE_THRESHOLD = 5500;

async function condensePlanningIfNeeded() {
  if (!fs.existsSync(PLANNING_PATH)) return;
  const content = fs.readFileSync(PLANNING_PATH, 'utf8');
  if (content.length <= LTP_CONDENSE_THRESHOLD) return;

  console.log(`[memory-manager] planning.md is ${content.length} chars — condensing...`);

  const allChunks = content.split(/(?=^## )/m).filter((s) => s.trim());
  const preamble  = allChunks[0].startsWith('## ') ? '' : allChunks.shift();

  const alwaysKeep = allChunks.filter((s) => /PART 1/i.test(s) || s.includes('[DRAFT]'));
  const condensable = allChunks.filter((s) => !/PART 1/i.test(s) && !s.includes('[DRAFT]'));

  const KEEP      = 2;
  const verbatim   = condensable.slice(-KEEP);
  const toCondense = condensable.slice(0, -KEEP);

  if (toCondense.length === 0) {
    console.log('[memory-manager] Nothing in planning old enough to condense — skipping');
    return;
  }

  let condensed;
  try {
    condensed = await generate({
      model:  OLLAMA_MODEL,
      system: 'You compress strategic planning documents into dense information packets. Output only the compressed markdown, no preamble.',
      prompt: `Compress the following planning sections into a single dense section titled "## Condensed Planning Archive".
Preserve EVERY confirmed goal, finding, priority decision, deadline, and strategic note.
CRITICAL: All specific dates (YYYY-MM-DD) and names must be preserved exactly.
Use tight bullet-point format grouped by topic.

${toCondense.join('\n\n')}`,
      options: { temperature: 0.2, num_predict: 1500 },
    });
  } catch (err) {
    console.warn('[memory-manager] condensePlanning failed — skipping:', err.message);
    return;
  }

  if (!condensed.trimStart().startsWith('## ')) {
    condensed = `## Condensed Planning Archive (auto-compressed ${todayStr()})\n${condensed.trim()}`;
  }

  const rebuilt = [
    preamble.trim(),
    ...alwaysKeep.map((s) => s.trim()),
    condensed.trim(),
    ...verbatim.map((s) => s.trim()),
  ].filter(Boolean).join('\n\n') + '\n';

  fs.copyFileSync(PLANNING_PATH, PLANNING_PATH + '.condense-bak');
  fs.writeFileSync(PLANNING_PATH, rebuilt, 'utf8');

  console.log(`[memory-manager] Condensed planning.md: ${content.length} → ${rebuilt.length} chars`);
}

// Kept as no-op — condensing now handled by condensePlanningIfNeeded
async function condenseMemoryIfNeeded() { return; }

async function checkAndRunDailyReset() {
  const memLog = readMemoryLog();
  const today  = todayStr();
  if (memLog.lastDailyReset !== today) {
    console.log('[memory-manager] New day detected — running daily reset');
    await dailyReset();
  }
}

async function checkWhiteboardRefresh() {
  const memLog    = readMemoryLog();
  const lastRead  = memLog.whiteboardLastRead ? new Date(memLog.whiteboardLastRead) : null;
  const daysSince = lastRead ? Math.floor((Date.now() - lastRead) / 86_400_000) : 999;
  if (daysSince >= 3) {
    console.log(`[memory-manager] Whiteboard is ${daysSince} days old — refreshing`);
    await whiteboardRefresh();
  }
}

function startDailyResetScheduler() {
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      console.log('[memory-manager] Midnight tick — running daily reset');
      await dailyReset().catch((e) => console.error('[memory-manager] Daily reset failed:', e.message));
    }
  }, 60_000);
}

module.exports = {
  safeWrite,
  dailyReset,
  weeklyMemoryUpdate,
  monthlyPlanningUpdate,
  taskComplete,
  taskArchive,
  taskReactivate,
  taskReset,
  createTask,
  confirmTask,
  rejectTask,
  detectNewTask,
  alertChange,
  whiteboardRefresh,
  pinkSweep,
  extractMemory,
  checkAndRunDailyReset,
  checkWhiteboardRefresh,
  startDailyResetScheduler,
  setConversationHistoryRef,
  condenseMemoryIfNeeded,
  condensePlanningIfNeeded,
};
