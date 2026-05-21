/**
 * memory-manager.js
 * Lifecycle reset functions and task management for Zora's memory system.
 *
 * GROUND TRUTH PROTECTION
 *   safeWrite(filePath, content, mode)
 *     "overwrite" — backed-up then overwritten (blocked for ground-truth files)
 *     "append"    — appended with date header (only mode allowed for long_term_memory)
 *     "draft"     — appends [DRAFT] section (long_term_planning only), sets planning_review_pending
 *
 * TASK LIFECYCLE
 *   taskComplete(id)           — moves active → completed, logs
 *   taskArchive(id, reason)    — moves active → archived, prepends reason
 *   taskReactivate(id)         — moves archived/completed → active
 *   taskReset(id)              — resets progress in-place (stays in active)
 *   createTask(taskData)       — generates via Gemma, writes to new/, adds to _index.json
 *   detectNewTask(message)     — scans message for "new task" phrases
 *
 * MEMORY RESETS
 *   dailyReset()               — midnight; closes the day, increments staleness
 *   weeklyMemoryUpdate()       — Sunday; appends to long_term_memory.md
 *   monthlyPlanningUpdate()    — first Sunday of month; appends draft to long_term_planning.md
 *   alertChange(a, sc)         — updates alert + sub-calls, rebuilds master context
 *   whiteboardRefresh()        — fetches/caches whiteboard (Google Drive stub)
 *   pinkSweep()                — triggered when Pink Alert declared
 *
 *   checkAndRunDailyReset()    — call at startup
 *   checkWhiteboardRefresh()   — call at startup
 *   startDailyResetScheduler() — starts midnight check interval
 */

const fs   = require('fs');
const path = require('path');

const { readMemoryLog, writeMemoryLog, appendMemoryEntry, getToday } = require('./memory');
const { loadAllTasks }                                     = require('./task-loader');
const { buildMasterContext }                               = require('./context-builder');
const { generate, OLLAMA_MODEL }                          = require('./ollama');

const CONTEXT_DIR    = path.join(__dirname, '../context');
const PROJECTS_PATH  = path.join(CONTEXT_DIR, 'projects.json');
const PLANNING_PATH  = path.join(CONTEXT_DIR, 'planning.md');

// Conversation history — managed here so alertChange() can clear it.
let _conversationHistory = null;

function setConversationHistoryRef(ref) { _conversationHistory = ref; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readIndex() {
  try { return JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf8')); }
  catch { return { projects: [] }; }
}

function writeIndex(data) {
  fs.writeFileSync(PROJECTS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function todayStr() {
  return getToday();
}

function getTodayDate() {
  return new Date(getToday() + 'T12:00:00');
}

function isSunday() {
  return getTodayDate().getDay() === 0;
}

function isFirstSundayOfMonth() {
  const d = getTodayDate();
  return d.getDay() === 0 && d.getDate() <= 7;
}

// ─── safeWrite ────────────────────────────────────────────────────────────────

/**
 * safeWrite(filePath, content, mode)
 * Enforces write rules for ground-truth files.
 *
 * mode: "overwrite" | "append" | "draft"
 *
 * long_term_memory.md   → only "append" allowed
 * long_term_planning.md → "append" or "draft" only
 * onboarding_*.md       → NEVER auto-write (throws)
 * all other files       → overwrite with backup first
 */
function safeWrite(filePath, content, mode = 'overwrite') {
  const rel = path.relative(CONTEXT_DIR, filePath);

  // ── planning.md: append or draft only ────────────────────────────────────
  if (rel === 'planning.md') {
    if (mode === 'overwrite') {
      const msg = `[safeWrite] BLOCKED: planning.md does not allow "overwrite"`;
      console.warn(msg);
      throw new Error(msg);
    }
    if (mode === 'draft') {
      const draft = `\n\n[DRAFT]\n${content}\n[/DRAFT]\n`;
      fs.appendFileSync(filePath, draft, 'utf8');
      const memLog = readMemoryLog();
      memLog.planning_review_pending = true;
      writeMemoryLog(memLog);
      console.log(`[safeWrite] Draft section appended to planning.md`);
      return;
    }
    fs.appendFileSync(filePath, '\n\n' + content, 'utf8');
    console.log(`[safeWrite] Appended to planning.md`);
    return;
  }

  // ── All other context files: backup then overwrite ────────────────────────
  if (mode === 'overwrite' && fs.existsSync(filePath)) {
    const backupPath = filePath + '.bak';
    fs.copyFileSync(filePath, backupPath);
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

// ─── suggestTheme (used by dailyReset) ───────────────────────────────────────

async function suggestThemeForReset(tasks, memLog) {
  const active  = tasks.filter((t) => t.status === 'active').map((t) => t.name);
  const stale   = tasks.filter((t) => t.status === 'stale').map((t) => t.name);
  const recentThemes = (memLog.daily_logs || [])
    .slice(-3)
    .map((d) => d.theme)
    .filter(Boolean);

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

Good examples: "Investigating AI" / "Japanese Immersion Day" / "Build & Ship" / "Outreach & Research" / "Clearing the Deck"
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

// ─── dailyReset ───────────────────────────────────────────────────────────────

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
    date:          today,
    theme:         memLog.todayTheme || '',
    alert:         memLog.currentAlert || 'green',
    tasks_worked:  [...touchedToday],
    tasks_missed:  [],
    entry_count:   todayEntries.length,
    closed_at:     new Date().toISOString(),
  };

  if (!memLog.pushup_counter) memLog.pushup_counter = { total_owed: 0, completed: 0, log: [] };

  if (!memLog.daysSinceWorked) memLog.daysSinceWorked = {};
  const tasks = loadAllTasks();

  // Sync days_since_worked back to projects.json
  const index = readIndex();
  for (const task of tasks) {
    if (touchedToday.has(task.id)) {
      memLog.daysSinceWorked[task.id] = 0;
    } else {
      memLog.daysSinceWorked[task.id] = (memLog.daysSinceWorked[task.id] || 0) + 1;
      dailyLogEntry.tasks_missed.push(task.id);
    }
    // Mirror to projects.json
    const entry = (index.projects || []).find((t) => t.id === task.id);
    if (entry) entry.days_since_worked = memLog.daysSinceWorked[task.id];
  }
  writeIndex(index);

  const { updateWhiteboard } = require('./memory');
  updateWhiteboard({ lastPlan: null, lastPlanAt: null, taskLogs: {} });

  if (_conversationHistory) _conversationHistory.length = 0;
  memLog.todayTheme     = '';
  memLog.lastDailyReset = today;
  memLog.dayApproved    = null;
  memLog.todayAdjustments = [];

  if (!memLog.daily_logs) memLog.daily_logs = [];
  memLog.daily_logs.push(dailyLogEntry);

  writeMemoryLog(memLog);
  console.log('[memory-manager] Daily reset complete');

  try { await buildMasterContext(); } catch (e) {
    console.warn('[memory-manager] Master context rebuild failed:', e.message);
  }

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

  // Condense long-term files if they've grown too large for the read window
  await condenseMemoryIfNeeded().catch((e) =>
    console.warn('[memory-manager] Memory condense failed:', e.message)
  );
  await condensePlanningIfNeeded().catch((e) =>
    console.warn('[memory-manager] Planning condense failed:', e.message)
  );
}

// ─── weeklyMemoryUpdate ───────────────────────────────────────────────────────

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
    `Worked: ${(d.tasks_worked  || []).join(', ') || 'none'} | ` +
    `Missed: ${(d.tasks_missed  || []).slice(0, 5).join(', ') || 'none'}`
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
**Time estimation notes:** For each task that appeared in the week, note whether it was consistently completed (estimate likely accurate), consistently skipped/missed (estimate may be too high or task is blocked), or mixed. Flag any task where the estimatedMinutes seems misaligned with reality. Format: "TaskName: <observation>".

Daily logs:
${logsText}

Be specific and honest. Use exact YYYY-MM-DD dates throughout. Name every task, person, or event by its real name — never generic labels like "a task" or "someone". Under 400 tokens. Output only the markdown entry.`,
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

// ─── monthlyPlanningUpdate ────────────────────────────────────────────────────

async function monthlyPlanningUpdate() {
  console.log('[memory-manager] Running monthly planning update...');

  const planningContent = fs.existsSync(PLANNING_PATH) ? fs.readFileSync(PLANNING_PATH, 'utf8') : '';

  const weeklyEntries = planningContent.split(/(?=## Week of )/).slice(-4).join('\n');

  const now       = new Date();
  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  try {
    const draft = await generate({
      model:  OLLAMA_MODEL,
      system: 'You write monthly planning reviews for a personal AI system. Be direct and specific. Use exact YYYY-MM-DD dates for all deadlines and milestones. Name every project, person, and event by its real name — never generic labels.',
      prompt: `Based on these weekly memory logs and current project state, write a monthly planning DRAFT.

## Monthly Review — ${monthName}
**Status: DRAFT**
### What the AI noticed this month: (bullets — use exact dates and real names)
### Suggested priority adjustments: (bullets — name the specific projects)
### Projects to consider deprioritizing: (bullets — name them and why)
### Projects to escalate: (bullets — name them and include any hard deadlines as YYYY-MM-DD)

Under 400 tokens. Be direct and specific. All action items must name who does what and by when (exact date).


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

// ─── taskComplete ─────────────────────────────────────────────────────────────

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

  try { await buildMasterContext(); } catch (e) {
    console.warn('[memory-manager] Master context rebuild failed:', e.message);
  }

  return entry;
}

// ─── taskArchive ──────────────────────────────────────────────────────────────

async function taskArchive(taskId, reason = '') {
  console.log(`[memory-manager] Archiving task: ${taskId} — ${reason}`);

  const index = readIndex();
  const entry = (index.projects || []).find((t) => t.id === taskId);
  if (!entry) throw new Error(`Task '${taskId}' not found in projects.json`);

  entry.folder         = 'archived';
  entry.status         = 'archived';
  entry.archived       = todayStr();
  entry.archiveReason  = reason || '';
  writeIndex(index);

  appendMemoryEntry({ type: 'task-archive', content: `Archived: ${taskId} — ${reason}`, taskId });

  try { await buildMasterContext(); } catch (e) {
    console.warn('[memory-manager] Master context rebuild failed:', e.message);
  }

  return entry;
}

// ─── taskReactivate ───────────────────────────────────────────────────────────

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

  try { await buildMasterContext(); } catch (e) {
    console.warn('[memory-manager] Master context rebuild failed:', e.message);
  }

  return entry;
}

// ─── taskReset ────────────────────────────────────────────────────────────────

async function taskReset(taskId) {
  console.log(`[memory-manager] Resetting task: ${taskId}`);

  const index = readIndex();
  const entry = (index.projects || []).find((t) => t.id === taskId);
  if (!entry) throw new Error(`Task '${taskId}' not found in projects.json`);

  entry.status   = 'active';
  entry.todayStep = '';
  writeIndex(index);

  const memLog = readMemoryLog();
  if (memLog.taskProgress?.[taskId])    delete memLog.taskProgress[taskId];
  if (memLog.daysSinceWorked?.[taskId]) memLog.daysSinceWorked[taskId] = 0;

  appendMemoryEntry({ type: 'task-reset', content: `Reset: ${taskId}`, taskId });
  writeMemoryLog(memLog);

  return entry;
}

// ─── createTask ───────────────────────────────────────────────────────────────

/**
 * createTask(taskData)
 * taskData: { description, rank? (1–8 number, optional) }
 * Generates a project via AI using the new schema, writes to projects.json (folder: "new").
 * Returns a preview object (not yet confirmed).
 */
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

  // Store name separately in names.json
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

// ─── confirmTask ──────────────────────────────────────────────────────────────

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

// ─── rejectTask ───────────────────────────────────────────────────────────────

function rejectTask(taskId) {
  console.log(`[memory-manager] Rejecting task: ${taskId}`);

  const index = readIndex();
  index.projects = (index.projects || []).filter((t) => t.id !== taskId);
  writeIndex(index);

  appendMemoryEntry({ type: 'task-rejected', content: `Task rejected: ${taskId}`, taskId });
}

// ─── detectNewTask ────────────────────────────────────────────────────────────

const NEW_TASK_PHRASES = [
  'new task', 'add task', 'create task', 'add project', 'new project',
  'i want to work on', 'add to my tasks', 'add to tasks',
];

/**
 * detectNewTask(message)
 * Returns true if message contains a "new task" intent phrase.
 */
function detectNewTask(message) {
  const lower = message.toLowerCase();
  return NEW_TASK_PHRASES.some((p) => lower.includes(p));
}

// ─── alertChange ─────────────────────────────────────────────────────────────

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

  if (newAlert === 'pink') {
    await pinkSweep();
  }

  try {
    const master = await buildMasterContext();
    return { ok: true, masterContext: master };
  } catch (e) {
    console.warn('[memory-manager] Master context rebuild failed:', e.message);
    return { ok: true };
  }
}

// ─── whiteboardRefresh ────────────────────────────────────────────────────────

async function whiteboardRefresh() {
  console.log('[memory-manager] whiteboardRefresh: not yet implemented (Google Drive pending)');

  const memLog = readMemoryLog();
  memLog.whiteboardLastRead          = new Date().toISOString();
  memLog.whiteboard_cache_last_read  = new Date().toISOString();
  writeMemoryLog(memLog);

  appendMemoryEntry({ type: 'whiteboard-refresh', content: 'Stub: whiteboard refresh not yet implemented' });
}

// ─── pinkSweep ────────────────────────────────────────────────────────────────

async function pinkSweep() {
  console.log('[memory-manager] Running Pink Sweep...');

  const tasks  = loadAllTasks();
  const memLog = readMemoryLog();
  const index  = readIndex();

  let staleCount = 0;
  for (const entry of (index.projects || [])) {
    if (entry.folder !== 'active') continue;
    const dsw = memLog.daysSinceWorked?.[entry.id] || 0;
    if (dsw > 7 && entry.status === 'active') {
      entry.status = 'stale';
      staleCount++;
    }
  }
  if (staleCount > 0) writeIndex(index);

  const staleIds = tasks.filter((t) => t.status === 'stale').map((t) => t.id);

  appendMemoryEntry({
    type:    'pink-sweep',
    content: `Pink Sweep started. Newly marked stale: ${staleCount}. All stale: ${staleIds.join(', ') || 'none'}`,
  });

  const lastRead  = memLog.whiteboardLastRead ? new Date(memLog.whiteboardLastRead) : null;
  const daysSince = lastRead ? Math.floor((Date.now() - lastRead) / 86_400_000) : 999;
  if (daysSince >= 2) {
    console.log('[memory-manager] Pink Sweep: triggering whiteboard refresh');
    await whiteboardRefresh();
  }

  return [
    { item: 'Review Starfleet Intelligence (Arc Board)',         done: false },
    { item: 'Review Starfleet Communications (Discord + email)', done: false },
    { item: 'Review Starfleet Quantum Archives (Drive)',         done: false },
    { item: 'Clean physical desk and papers',                    done: false },
    { item: 'Update all task .md files with current status',     done: false },
  ];
}

// ─── extractMemory ────────────────────────────────────────────────────────────

async function extractMemory(userMessage, aiResponse, masterCtx = '') {
  const prompt =
`You are a memory extraction agent for a personal AI management system.

Current master context (brief):
${masterCtx.slice(0, 1200)}

User message: "${userMessage}"
AI response: "${aiResponse}"

Decide if this exchange contains NEW information worth saving long-term.
Only save genuinely durable facts — not routine status updates or things already in context.

Save to long_term_memory if the exchange reveals:
- New personal facts, preferences, habits, or constraints about the user
- Behavioral patterns, recurring struggles or wins
- Significant changes to how projects should be approached
- Insights the AI should remember to avoid repeating mistakes

Save to long_term_planning if the exchange contains:
- Explicit future intentions ("I want to...", "I'm planning to...", "after X...")
- New confirmed goals or project direction changes
- Deadlines or milestones the user stated

SPECIFICITY RULES — always apply when saving:
- Convert ALL relative dates to absolute YYYY-MM-DD dates. Today is ${todayStr()}.
  Examples: "next Monday" → the actual date, "next week" → week of YYYY-MM-DD, "after exams" → after YYYY-MM-DD
- Include specific names exactly as stated: people ("speak to Professor Kim"), events ("AP Japanese exam"), places ("Bellevue College")
- Include specific times/deadlines: "due by 2026-05-15 at 11:59pm" not "due soon"
- If a name or date is ambiguous, write what was said plus your best resolution in parentheses

If nothing is worth saving, output exactly: nothing

Otherwise output valid JSON only (no explanation):
{"file": "long_term_memory" | "long_term_planning", "content": "the markdown text to append — brief, factual, 1-4 lines"}`;

  let raw;
  try {
    raw = await generate({
      model:   OLLAMA_MODEL,
      system:  'You are a memory extraction agent. Output ONLY valid JSON or the single word "nothing". No explanation, no markdown fences.',
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
  } catch {
    return;
  }

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

// ─── condenseMemoryIfNeeded ───────────────────────────────────────────────────

const LTM_CONDENSE_THRESHOLD = 5500; // chars — condense before the 6000-char read window fills up

/**
 * If long_term_memory.md exceeds the threshold, Gemma compresses all but the
 * last 2 sections into a dense "Condensed Archive" block, then rewrites the
 * file as: preamble + condensed archive + 2 recent sections verbatim.
 * Always backs up the original first.
 */
async function condenseMemoryIfNeeded() {
  // No separate memory file — condensing happens on planning.md via condensePlanningIfNeeded
  return;

  /* eslint-disable no-unreachable */
  const memoryPath = PLANNING_PATH;
  if (!fs.existsSync(memoryPath)) return;

  const content = fs.readFileSync(memoryPath, 'utf8');
  if (content.length <= LTM_CONDENSE_THRESHOLD) return;

  console.log(`[memory-manager] planning.md is ${content.length} chars — condensing...`);

  // Split on ## headings; first chunk may be the intro preamble (no ## prefix)
  const allChunks = content.split(/(?=^## )/m).filter((s) => s.trim());
  const preamble  = allChunks[0].startsWith('## ') ? '' : allChunks.shift();
  // allChunks now contains only ## sections
  const KEEP = 2;
  const verbatim    = allChunks.slice(-KEEP);
  const toCondense  = allChunks.slice(0, -KEEP);

  if (toCondense.length === 0) {
    console.log('[memory-manager] Nothing old enough to condense — skipping');
    return;
  }

  let condensed;
  try {
    condensed = await generate({
      model:  OLLAMA_MODEL,
      system: 'You compress memory log entries into a dense information packet. Output only the compressed markdown, no preamble or explanation.',
      prompt:
`Compress the following memory entries into a single dense section titled "## Condensed Archive".
Preserve EVERY fact, preference, rule, behavioral pattern, project update, scheduling constraint, and scheduling rule.
CRITICAL: Preserve all specific dates (YYYY-MM-DD format), specific names of people, tasks, exams, and events exactly as written. Never replace a specific date with "recently" or a name with "a task" — exact dates and names must survive compression.
Use tight bullet-point format grouped by topic (Scheduling, Projects, Preferences, Patterns, etc.).
Remove only filler phrases, repetitive phrases, and formatting overhead.
Every real piece of information must survive in the compressed form.

${toCondense.join('\n\n')}`,
      options: { temperature: 0.2, num_predict: 1500 },
    });
  } catch (err) {
    console.warn('[memory-manager] condenseMemory Gemma failed — skipping:', err.message);
    return;
  }

  // Ensure the output starts with the ## heading
  if (!condensed.trimStart().startsWith('## ')) {
    condensed = `## Condensed Archive (auto-compressed ${todayStr()})\n${condensed.trim()}`;
  }

  const rebuilt = [preamble.trim(), condensed.trim(), ...verbatim.map((s) => s.trim())]
    .filter(Boolean)
    .join('\n\n') + '\n';

  // Backup then overwrite
  const backupPath = memoryPath + '.condense-bak';
  fs.copyFileSync(memoryPath, backupPath);
  fs.writeFileSync(memoryPath, rebuilt, 'utf8');

  console.log(
    `[memory-manager] Condensed long_term_memory.md: ${content.length} → ${rebuilt.length} chars`
  );
}

// ─── condensePlanningIfNeeded ─────────────────────────────────────────────────

const LTP_CONDENSE_THRESHOLD = 5500;

/**
 * If long_term_planning.md exceeds the threshold, Gemma compresses the monthly
 * review sections (PART 3 and older entries) into a dense archive, while always
 * keeping PART 1 (Life Arcs) fully intact and any [DRAFT] blocks untouched.
 * Backs up to .condense-bak before writing.
 */
async function condensePlanningIfNeeded() {
  if (!fs.existsSync(PLANNING_PATH)) return;

  const content = fs.readFileSync(PLANNING_PATH, 'utf8');
  if (content.length <= LTP_CONDENSE_THRESHOLD) return;

  console.log(`[memory-manager] planning.md is ${content.length} chars — condensing...`);

  // Split on ## headings
  const allChunks = content.split(/(?=^## )/m).filter((s) => s.trim());
  const preamble  = allChunks[0].startsWith('## ') ? '' : allChunks.shift();

  // Always keep PART 1 (Life Arcs) and anything containing [DRAFT] verbatim
  const alwaysKeep = allChunks.filter(
    (s) => /PART 1/i.test(s) || s.includes('[DRAFT]')
  );
  const condensable = allChunks.filter(
    (s) => !/PART 1/i.test(s) && !s.includes('[DRAFT]')
  );

  const KEEP = 2; // keep 2 most recent condensable sections verbatim
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
      prompt:
`Compress the following planning sections into a single dense section titled "## Condensed Planning Archive".
Preserve EVERY confirmed goal, monthly review finding, project priority decision, deadline, arc direction, and strategic note.
CRITICAL: All specific dates (YYYY-MM-DD), specific names of projects, people, exams, and events must be preserved exactly. Never replace a specific date with "soon" or a name with "a project" — exact dates and names must survive.
Keep [CONFIRMED] / [APPROVED] / [REJECTED] markers on anything that had them.
Use tight bullet-point format. Group by time period or topic. Remove only filler and redundancy.

${toCondense.join('\n\n')}`,
      options: { temperature: 0.2, num_predict: 1500 },
    });
  } catch (err) {
    console.warn('[memory-manager] condensePlanning Gemma failed — skipping:', err.message);
    return;
  }

  if (!condensed.trimStart().startsWith('## ')) {
    condensed = `## Condensed Planning Archive (auto-compressed ${todayStr()})\n${condensed.trim()}`;
  }

  // Reconstruct: preamble + PART1/drafts + condensed archive + recent verbatim
  const rebuilt = [
    preamble.trim(),
    ...alwaysKeep.map((s) => s.trim()),
    condensed.trim(),
    ...verbatim.map((s) => s.trim()),
  ].filter(Boolean).join('\n\n') + '\n';

  const backupPath = PLANNING_PATH + '.condense-bak';
  fs.copyFileSync(PLANNING_PATH, backupPath);
  fs.writeFileSync(PLANNING_PATH, rebuilt, 'utf8');

  console.log(
    `[memory-manager] Condensed planning.md: ${content.length} → ${rebuilt.length} chars`
  );
}

// ─── Startup checks ───────────────────────────────────────────────────────────

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
