/**
 * planner.js — Daily planning flow
 *
 * generateDayPlan() — planning sequence
 *   Steps 1–5:        deepseek-r1  (global context analysis)
 *   Category passes:  deepseek-r1  (projects / tasks / events)
 *   Synthesis:        deepseek-r1  (combined day schedule)
 *   Step 6:     qwen2.5      (JSON formatting → daily_planner.json)
 *   Step 7:     deepseek-r1  (async forward planning → planning.md)
 *
 * Step 1  — Important events
 * Step 2  — Important tasks / task deadlines
 * Step 3  — Important projects / project deadlines
 * Step 4  — Relevant planning.md context
 * Step 5  — Relevant rules.md context
 * Then for projects, tasks, and events:
 *   1. Select all relevant items for today
 *   2. Order them through the day
 *   3. Align them with planning.md
 *   4. Align them with rules.md
 * Then synthesize one combined day-schedule document
 * Step 6  — Format plan into daily_planner.json  (qwen)
 * Step 7  — Forward planning 3d / 1w / 2w / 1mo (async, deepseek)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { generate, extractJSON,
        OLLAMA_MODEL, OLLAMA_JSON_MODEL } = require('./ollama');
const { updateWhiteboard } = require('./memory');
const calendarManager = require('./calendar-manager');
const tasksManager    = require('./tasks-manager');
const { readProjects } = require('./task-loader');
const { getNameType } = require('./names-registry');

const CONTEXT_DIR = path.join(__dirname, '../context');
const DEEPSEEK    = OLLAMA_MODEL;       // deepseek-r1:7b  (env: OLLAMA_MODEL)
const QWEN        = OLLAMA_JSON_MODEL;  // qwen2.5:3b      (env: OLLAMA_JSON_MODEL)
const DEEPSEEK_NUM_PREDICT = 6000;
const BULLET_SYSTEM = 'You are a planning assistant. Output only short bullet points. Be concise. No preamble.';

// ── Helpers ───────────────────────────────────────────────────────────────────

function readContextFile(filename) {
  const p = path.join(CONTEXT_DIR, filename);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function today() {
  return new Date().toLocaleDateString('sv-SE');
}

function collectPlanItemsById(blocks, validIds) {
  const seen = new Set();
  const items = [];

  for (const blockName of ['morning', 'afternoon', 'evening']) {
    for (const item of blocks[blockName] || []) {
      if (!item || !item.id || !validIds.has(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push({ id: item.id, note: item.note || '' });
    }
  }

  return items;
}

function normalizeForwardPlanBullets(text, dateStr) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, ''))
    .map((line) => `- [forward ${dateStr}] ${line}`)
    .join('\n');
}

async function buildCategoryPlan({
  step,
  dateStr,
  categoryName,
  itemLabel,
  itemsCtx,
  globalContextDoc,
  planningSummary,
  rulesSummary,
  runTimingStep = false,   // only true for events
}) {
  const itemJson = JSON.stringify(itemsCtx);

  step(`${categoryName} — Selecting items for today…`);
  const selected = await generate({
    model:  DEEPSEEK,
    system: 'You are a planning assistant. Use only IDs. Output only short bullet points. Be concise. No preamble.',
    prompt: `Today is ${dateStr}.

Global planning context:
${globalContextDoc}

Available ${itemLabel}:
${itemJson}

Select the ${itemLabel} that belong in today's plan.
Follow the rules.md guidance in the global context above.

Constraints:
- use only IDs from the list above
- never use names

Output:
- one bullet per ID
- short reason only`,
    options: { temperature: 0.3, num_predict: DEEPSEEK_NUM_PREDICT },
  });

  step(`${categoryName} — Ordering items for the day…`);
  const ordered = await generate({
    model:  DEEPSEEK,
    system: 'You are a planning assistant. Use only IDs. Output only short bullet points. Be concise. No preamble.',
    prompt: `Today is ${dateStr}.

Selected ${itemLabel} for today:
${selected}

Global planning context:
${globalContextDoc}

Order these ${itemLabel} through the day.
Follow the rules.md guidance in the global context above.

Constraints:
- place each item in morning, afternoon, or evening
- use only IDs from the selected list`,
    options: { temperature: 0.3, num_predict: DEEPSEEK_NUM_PREDICT },
  });

  // — Step 2b: Assign start/end times (events only) ——————————————————————
  let timings = {};
  let timingDoc = '';
  if (runTimingStep) {
    step(`${categoryName} — Assigning start/end times…`);

    const strictLines = (itemsCtx || [])
      .filter((item) => item.strict_timing && item.time_start && item.time_end)
      .map((item) => `- ${item.id}: ${item.time_start}-${item.time_end}`)
      .join('\n') || '(none)';

    const timingRaw = await generate({
      model:  DEEPSEEK,
      system: 'You are a scheduling assistant. Output only "id: HH:MM-HH:MM" lines. No extra text. 24-hour format.',
      prompt: `Today is ${dateStr}.

Ordered event items for today:
${ordered}

Strict timing constraints (must use exactly):
${strictLines}

Assign a realistic start time and end time for every item listed above.
Rules:
- 24-hour HH:MM format only
- strict items must use their exact times
- fit everything else realistically around strict constraints
- output exactly one line per item: id: HH:MM-HH:MM`,
      options: { temperature: 0.2, num_predict: 300 },
    });

    const timeRe = /^-?\s*([a-z0-9][a-z0-9-]*)\s*:\s*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/gm;
    const padHH  = (t) => (t.split(':')[0].length === 1 ? `0${t}` : t);
    let tm;
    while ((tm = timeRe.exec(timingRaw)) !== null) {
      timings[tm[1]] = { start_time: padHH(tm[2]), end_time: padHH(tm[3]) };
    }
    timingDoc = `\n\n## ${categoryName} Times\n${timingRaw}`;
  }

  step(`${categoryName} — Aligning with planning.md…`);
  const alignedPlanning = await generate({
    model:  DEEPSEEK,
    system: 'You are a planning assistant. Use only IDs. Output only short bullet points. Revise if needed. No preamble.',
    prompt: `Today is ${dateStr}.

Current ${categoryName.toLowerCase()} day plan:
${ordered}

Relevant planning.md guidance:
${planningSummary}

Revise this ${categoryName.toLowerCase()} plan to match planning.md.

Constraints:
- use only IDs from the original item list
- if already good, return the cleaned final version`,
    options: { temperature: 0.3, num_predict: DEEPSEEK_NUM_PREDICT },
  });

  step(`${categoryName} — Aligning with rules.md…`);
  const alignedRules = await generate({
    model:  DEEPSEEK,
    system: 'You are a planning assistant. Use only IDs. Output only short bullet points. Revise if needed. No preamble.',
    prompt: `Today is ${dateStr}.

Current ${categoryName.toLowerCase()} day plan:
${alignedPlanning}

Relevant rules.md guidance:
${rulesSummary}

Revise this ${categoryName.toLowerCase()} plan to match rules.md.

Constraints:
- use only IDs from the original item list
- if already good, return the cleaned final version`,
    options: { temperature: 0.3, num_predict: DEEPSEEK_NUM_PREDICT },
  });

  const doc = [
    `## ${categoryName} Selection`,
    selected,
    '',
    `## ${categoryName} Ordered`,
    ordered,
    '',
    `## ${categoryName} Final`,
    alignedRules,
  ].join('\n') + timingDoc;

  return { doc, timings };
}

// ── Main export ───────────────────────────────────────────────────────────────

async function generateDayPlan(onStep, targetDate) {
  const step    = (label) => { if (onStep) onStep(label); console.log('[planner]', label); };
  const dateStr = targetDate || today();

  step(`Generating plan for ${dateStr}…`);

  // ── Load context (no AI yet) ──────────────────────────────────────────────
  const projects   = readProjects().projects || [];
  const tasks      = tasksManager.loadAllTasks();
  const planning   = readContextFile('planning.md');
  const rules      = readContextFile('rules.md');

  // Load all known valid IDs from names.json for plan verification
  const namesPath   = path.join(CONTEXT_DIR, 'names.json');
  const namesJson   = fs.existsSync(namesPath)
    ? JSON.parse(fs.readFileSync(namesPath, 'utf8'))
    : {};
  const knownIds    = new Set(Object.keys(namesJson).filter((id) => !id.startsWith('_')));
  const knownTypes  = Object.fromEntries(
    [...knownIds].map((id) => [id, getNameType(namesJson, id, null)])
  );

  let eventsArr = [];
  try { eventsArr = await calendarManager.loadTodayEvents(dateStr); } catch { /* non-fatal */ }

  // Compact context — AI sees ONLY ids, never names
  const projectsCtx = projects.map((p) => ({
    id:           p.id,
    priority_rank: p.priority_rank ?? 99,
    deadline:     p.deadline || null,
    current_step: p.current_step ?? 0,
    steps_total:  (p.steps || []).length,
    ai_notes:     p.ai_notes || '',
  }));

  const tasksCtx = tasks.map((t) => ({
    id:        t.id,
    desc:      t.desc || '',
    recurring: t.recurring || null,
    deadline:  t.deadline || null,
    ai_notes:  t.ai_notes || '',
  }));

  const eventsCtx = eventsArr.map((e) => ({
    id:            e.id,
    time_start:    e.time_start    || null,
    time_end:      e.time_end      || null,
    strict_timing: e.strict_timing || false,
    recurring:     e.recurring     || null,
    ai_notes:      e.ai_notes      || '',
  }));

  // ── Step 1: Important events ──────────────────────────────────────────────
  step('Step 1 — Checking for important events today…');
  const step1 = await generate({
    model:  DEEPSEEK,
    system: BULLET_SYSTEM,
    prompt: `Today is ${dateStr}.

Calendar events today: ${JSON.stringify(eventsCtx)}
Planning notes (excerpt): ${planning.slice(0, 800)}

List:
- important fixed events today
- routine anchor events that shape the day

Use short bullets only.
If none, say "None."`,
    options: { temperature: 0.3, num_predict: DEEPSEEK_NUM_PREDICT },
  });

  // ── Step 2: Important tasks / deadlines ──────────────────────────────────
  step('Step 2 — Checking important tasks and task deadlines…');
  const step2 = await generate({
    model:  DEEPSEEK,
    system: BULLET_SYSTEM,
    prompt: `Today is ${dateStr}.

Tasks: ${JSON.stringify(tasksCtx)}

Identify the tasks most important for today.
Include:
- tasks due today or within the next 48 hours
- tasks that are recurring and should still happen today
- any task that strongly supports today's priorities

Return a concise bullet list by ID with a short reason and any deadline date.
If none, say "None."`,
    options: { temperature: 0.3, num_predict: DEEPSEEK_NUM_PREDICT },
  });

  // ── Step 3: Important projects / deadlines ────────────────────────────────
  step('Step 3 — Checking important projects and project deadlines…');
  const step3 = await generate({
    model:  DEEPSEEK,
    system: BULLET_SYSTEM,
    prompt: `Today is ${dateStr}.

Projects: ${JSON.stringify(projectsCtx)}

Identify the projects most important for today.
Include:
- projects with deadlines today or soon
- high-priority projects that should move forward today
- projects directly connected to today's commitments

Return a concise bullet list by ID with a short reason and any deadline date.
If none, say "None."`,
    options: { temperature: 0.3, num_predict: DEEPSEEK_NUM_PREDICT },
  });

  // ── Step 4: Planning doc ──────────────────────────────────────────────────
  step('Step 4 — Reviewing planning document…');
  const step4 = await generate({
    model:  DEEPSEEK,
    system: BULLET_SYSTEM,
    prompt: `Today is ${dateStr}. Read this planning document and extract only the most relevant and important information for today.

${planning || '(empty)'}

Output 2-4 short bullet points only.`,
    options: { temperature: 0.3, num_predict: DEEPSEEK_NUM_PREDICT },
  });

  // ── Step 5: Rules ─────────────────────────────────────────────────────────
  step('Step 5 — Reviewing rules…');
  const step5 = await generate({
    model:  DEEPSEEK,
    system: BULLET_SYSTEM,
    prompt: `Today is ${dateStr}. Read this rules file and note only the planning rules and generation rules most relevant today.

Ignore rules that merely describe the day schedule itself.
Prefer rules about how to plan, how to generate plans, how to avoid duplication, and how to keep output simple.

${rules || '(empty)'}

Output 2-5 short bullet points only.`,
    options: { temperature: 0.3, num_predict: DEEPSEEK_NUM_PREDICT },
  });

  const globalContextDoc = [
    `# Daily Planning Context — ${dateStr}`,
    '',
    '## Important Events',
    step1,
    '',
    '## Important Tasks',
    step2,
    '',
    '## Important Projects',
    step3,
    '',
    '## Planning.md Guidance',
    step4,
    '',
    '## Rules.md Guidance',
    step5,
  ].join('\n');

  const { doc: projectsDoc } = await buildCategoryPlan({
    step,
    dateStr,
    categoryName: 'Projects',
    itemLabel: 'projects',
    itemsCtx: projectsCtx,
    globalContextDoc,
    planningSummary: step4,
    rulesSummary: step5,
  });

  const { doc: tasksDoc } = await buildCategoryPlan({
    step,
    dateStr,
    categoryName: 'Tasks',
    itemLabel: 'tasks',
    itemsCtx: tasksCtx,
    globalContextDoc,
    planningSummary: step4,
    rulesSummary: step5,
  });

  const { doc: eventsDoc, timings: allTimings } = await buildCategoryPlan({
    step,
    dateStr,
    categoryName: 'Events',
    itemLabel: 'events',
    itemsCtx: eventsCtx,
    globalContextDoc,
    planningSummary: step4,
    rulesSummary: step5,
    runTimingStep: true,
  });

  const categoryPlanDoc = [
    globalContextDoc,
    '',
    projectsDoc,
    '',
    tasksDoc,
    '',
    eventsDoc,
  ].join('\n');

  step('Step 5a — Combining category plans into one day schedule…');
  const combinedDayDoc = await generate({
    model:  DEEPSEEK,
    system: 'You are a planning assistant. Use only IDs — never use names. Output only short bullet points. Assign concrete actions. No preamble.',
    prompt: `Today is ${dateStr}.

Here is the full planning context and the completed category planning documents:

${categoryPlanDoc}

Build one combined day schedule for morning / afternoon / evening.
Follow the rules.md guidance in the global context above.

Constraints:
- each line must use exactly one real ID
- never invent IDs
- never use names

Output:
- three sections only: Morning, Afternoon, Evening
- 3-5 bullets per section
- each bullet = one ID + short action note`,
    options: { temperature: 0.5, num_predict: DEEPSEEK_NUM_PREDICT },
  });

  step('Step 5b — Checking combined schedule against planning.md and rules.md…');
  const combinedFinalDoc = await generate({
    model:  DEEPSEEK,
    system: 'You are a planning assistant. Output only short bullet points. Verify the plan follows all rules. No preamble.',
    prompt: `Today is ${dateStr}.

Combined day schedule:
${combinedDayDoc}

Planning.md guidance:
${step4}

Rules.md guidance:
${step5}

Check this schedule against planning.md and rules.md above.
If needed, revise it.
Return the final schedule only.`,
    options: { temperature: 0.3, num_predict: DEEPSEEK_NUM_PREDICT },
  });

  // ── Step 6: Format → daily_planner.json  (qwen) ───────────────────────────
  step('Step 6 — Formatting plan into daily_planner.json…');
  let plan = null;
  try {
    const raw6 = await generate({
      model:  QWEN,
      system: 'Output ONLY valid JSON. No markdown fences. No explanation.',
      prompt: `Convert this plan into JSON.

Plan:
${combinedFinalDoc}

Important events: ${step1}
All events today: ${JSON.stringify(eventsCtx)}
All tasks today: ${JSON.stringify(tasksCtx)}
All projects today: ${JSON.stringify(projectsCtx)}
Event timing assignments: ${JSON.stringify(allTimings)}

Required schema (follow exactly):
{
  "date": "${dateStr}",
  "blocks": {
    "morning":   [{ "id": "...", "note": "...", "start_time": "HH:MM", "end_time": "HH:MM" }],
    "afternoon": [{ "id": "...", "note": "...", "start_time": "HH:MM", "end_time": "HH:MM" }],
    "evening":   [{ "id": "...", "note": "...", "start_time": "HH:MM", "end_time": "HH:MM" }]
  },
  "events": [{ "id": "...", "note": "...", "start_time": "HH:MM", "end_time": "HH:MM" }],
  "tasks": [{ "id": "...", "note": "..." }]
}

Rules for conversion:
- Preserve the actual scheduled items from the plan; do not collapse or omit categories.
- Each block should contain the scheduled mix of projects, tasks, and events from the plan text.
- For each item in blocks and events, set start_time and end_time from the timing assignments above.
- If no timing assignment exists for an item, omit start_time and end_time (or use null).
- "events" should include only real event IDs scheduled in the day plan.
- "tasks" should include only real task IDs scheduled in the day plan; tasks do not need start_time/end_time.
- Never place an event ID in "tasks".
- Never place a task ID in "events".
- Do not create redundant duplicates across events/tasks/blocks unless explicitly required by the schedule.
- Each "note" should explain the concrete action or purpose of that scheduled item.`,
      options: { temperature: 0.2, num_predict: 1200 },
    });
    plan = extractJSON(raw6);
  } catch (err) {
    console.warn('[planner] Step 6 failed:', err.message);
  }

  // Fallback if qwen returned bad JSON
  if (!plan) {
    plan = {
      date:   dateStr,
      blocks: { morning: [], afternoon: [], evening: [] },
      events: [],
      tasks:  [],
    };
  }

  const normalizePlan = (p) => {
    p.date   = p.date   || dateStr;
    p.blocks = p.blocks || { morning: [], afternoon: [], evening: [] };
    ['morning', 'afternoon', 'evening'].forEach((b) => {
      if (!Array.isArray(p.blocks[b])) p.blocks[b] = [];
    });
    if (!Array.isArray(p.events)) p.events = collectPlanItemsById(p.blocks, eventIds);
    if (!Array.isArray(p.tasks))  p.tasks  = collectPlanItemsById(p.blocks, taskIds);
    return p;
  };

  const eventIds = new Set(eventsCtx.map((e) => e.id));
  const taskIds  = new Set(tasksCtx.map((t)  => t.id));
  plan = normalizePlan(plan);

  // ── Verification loop ─────────────────────────────────────────────────────
  // Checks: (1) all IDs exist in names.json  (2) no duplicates / near-dupe entries
  // On failure → deepseek fixes the text plan → qwen re-formats → repeat

  const MAX_VERIFY = 3;
  const qwenFormatPrompt = (planText) =>
    `Convert this plan into JSON.

Plan:
${planText}

Important events: ${step1}
All events today: ${JSON.stringify(eventsCtx)}
All tasks today: ${JSON.stringify(tasksCtx)}
All projects today: ${JSON.stringify(projectsCtx)}
Event timing assignments: ${JSON.stringify(allTimings)}

Required schema (follow exactly):
{
  "date": "${dateStr}",
  "blocks": {
    "morning":   [{ "id": "...", "note": "...", "start_time": "HH:MM", "end_time": "HH:MM" }],
    "afternoon": [{ "id": "...", "note": "...", "start_time": "HH:MM", "end_time": "HH:MM" }],
    "evening":   [{ "id": "...", "note": "...", "start_time": "HH:MM", "end_time": "HH:MM" }]
  },
  "events": [{ "id": "...", "note": "...", "start_time": "HH:MM", "end_time": "HH:MM" }],
  "tasks": [{ "id": "...", "note": "..." }]
}

Rules for conversion:
- Preserve the actual scheduled items from the plan; do not collapse or omit categories.
- Each block should contain the scheduled mix of projects, tasks, and events from the plan text.
- For each item in blocks and events, set start_time and end_time from the timing assignments above.
- If no timing assignment exists for an item, omit start_time and end_time (or use null).
- "events" should include only real event IDs scheduled in the day plan.
- "tasks" should include only real task IDs scheduled in the day plan; tasks do not need start_time/end_time.
- Never place an event ID in "tasks".
- Never place a task ID in "events".
- Do not create redundant duplicates across events/tasks/blocks unless explicitly required by the schedule.
- Each "note" should explain the concrete action or purpose of that scheduled item.`;

  for (let attempt = 1; attempt <= MAX_VERIFY; attempt++) {
    // — Check 1: ID validation against names.json ——————————————————————————
    const allPlanEntries = [
      ...['morning', 'afternoon', 'evening'].flatMap((b) =>
        (plan.blocks[b] || []).map((item) => ({ id: item.id, loc: `blocks.${b}` }))
      ),
      ...(plan.events || []).map((item) => ({ id: item.id, loc: 'events' })),
      ...(plan.tasks  || []).map((item) => ({ id: item.id, loc: 'tasks'  })),
    ].filter((e) => e.id);

    const invalidIds = allPlanEntries.filter(({ id }) => !knownIds.has(id));
    const wrongTypeIds = [
      ...(plan.events || [])
        .filter((item) => item?.id && knownIds.has(item.id) && knownTypes[item.id] && knownTypes[item.id] !== 'event')
        .map((item) => ({ id: item.id, loc: 'events', expected: 'event', actual: knownTypes[item.id] })),
      ...(plan.tasks || [])
        .filter((item) => item?.id && knownIds.has(item.id) && knownTypes[item.id] && knownTypes[item.id] !== 'task')
        .map((item) => ({ id: item.id, loc: 'tasks', expected: 'task', actual: knownTypes[item.id] })),
    ];

    // — Check 2: Qwen duplication check ———————————————————————————————————
    step(`Verification attempt ${attempt} — asking qwen to check for duplicates…`);
    let dupeResult = { duplicates_found: false, issues: [] };
    try {
      const rawDupe = await generate({
        model:  QWEN,
        system: 'Output ONLY valid JSON. No markdown fences. No explanation.',
        prompt: `Review this daily plan for duplication or extremely related entries.

Plan:
${JSON.stringify(plan, null, 2)}

Check for:
1. The same ID appearing more than once anywhere in blocks, events, or tasks
2. Different IDs that clearly represent the same real-world work scheduled multiple times

Output JSON exactly:
{"duplicates_found": true, "issues": ["description 1", "description 2"]}

If no issues: {"duplicates_found": false, "issues": []}`,
        options: { temperature: 0.1, num_predict: 400 },
      });
      dupeResult = extractJSON(rawDupe) || dupeResult;
    } catch (err) {
      console.warn('[planner] Dupe-check parse failed:', err.message);
    }

    const hasIdIssues   = invalidIds.length > 0;
    const hasTypeIssues = wrongTypeIds.length > 0;
    const hasDupeIssues = dupeResult.duplicates_found && (dupeResult.issues || []).length > 0;

    if (!hasIdIssues && !hasTypeIssues && !hasDupeIssues) {
      step(`Verification passed (attempt ${attempt}).`);
      break;
    }

    if (attempt === MAX_VERIFY) {
      console.warn('[planner] Verification still failing after max attempts — using last plan.');
      break;
    }

    // — Build precise error report for deepseek ————————————————————————————
    const errorParts = [];
    if (hasIdIssues) {
      errorParts.push(
        `INVALID IDs (not found in names.json): ${invalidIds.map((e) => `"${e.id}" (in ${e.loc})`).join(', ')}.\n` +
        `Valid IDs are: ${[...knownIds].join(', ')}.`
      );
    }
    if (hasTypeIssues) {
      errorParts.push(
        `WRONG TYPE IDs: ${wrongTypeIds.map((e) => `"${e.id}" is a ${e.actual} but was placed in ${e.loc}; expected ${e.expected}`).join(', ')}.`
      );
    }
    if (hasDupeIssues) {
      errorParts.push(
        `DUPLICATION / NEAR-DUPLICATE issues detected:\n${(dupeResult.issues || []).map((i) => `- ${i}`).join('\n')}`
      );
    }

    step(`Verification failed (attempt ${attempt}) — asking deepseek to fix the plan…`);
    const fixedPlanDoc = await generate({
      model:  DEEPSEEK,
      system: 'You are a planning assistant. Use only IDs — never use names. Output short bullet points. No preamble.',
      prompt: `Today is ${dateStr}.

The following plan has issues that must be fixed:
${JSON.stringify(plan, null, 2)}

Issues to fix:
${errorParts.join('\n\n')}

rules.md guidance:
${step5}

Produce a corrected plan. Rules:
- use ONLY IDs from this valid list: ${[...knownIds].join(', ')}
- use event IDs only inside the top-level "events" list
- use task IDs only inside the top-level "tasks" list
- each ID may appear at most once across the entire plan
- preserve the original intent where the IDs are valid
- follow rules.md guidance above

Output:
- three sections: Morning, Afternoon, Evening
- 3-5 bullets per section
- each bullet = one valid ID + short action note`,
      options: { temperature: 0.3, num_predict: DEEPSEEK_NUM_PREDICT },
    });

    // — Re-format with qwen ————————————————————————————————————————————————
    step(`Verification attempt ${attempt} — re-formatting fixed plan with qwen…`);
    try {
      const rawFixed = await generate({
        model:  QWEN,
        system: 'Output ONLY valid JSON. No markdown fences. No explanation.',
        prompt: qwenFormatPrompt(fixedPlanDoc),
        options: { temperature: 0.2, num_predict: 1000 },
      });
      const fixedPlan = extractJSON(rawFixed);
      if (fixedPlan) plan = normalizePlan(fixedPlan);
    } catch (err) {
      console.warn('[planner] Re-format failed:', err.message);
    }
  }

  // Persist to daily_planner.json
  try {
    updateWhiteboard(plan);
  } catch (err) {
    console.warn('[planner] Could not save to daily_planner.json:', err.message);
  }

  step('Plan ready!');

  // ── Step 7: Async forward planning (deepseek) ─────────────────────────────
  setImmediate(() => {
    updateForwardPlan(projects, tasks, dateStr).catch((err) =>
      console.warn('[planner] Forward plan failed:', err.message)
    );
  });

  return plan;
}

// ── Step 7 — Forward planning (async) ────────────────────────────────────────

async function updateForwardPlan(projects, tasks, dateStr) {
  const planning     = readContextFile('planning.md');
  const planningPath = path.join(CONTEXT_DIR, 'planning.md');

  const d0  = new Date(dateStr + 'T12:00:00');
  const p3  = new Date(d0); p3.setDate(d0.getDate() + 3);
  const p7  = new Date(d0); p7.setDate(d0.getDate() + 7);
  const p14 = new Date(d0); p14.setDate(d0.getDate() + 14);
  const p30 = new Date(d0); p30.setDate(d0.getDate() + 30);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const projectsCtx = projects
    .slice()
    .sort((a, b) => (a.priority_rank || 99) - (b.priority_rank || 99))
    .map((p) =>
      `  [rank ${p.priority_rank ?? '?'}] ${p.id}` +
      ` — step ${p.current_step ?? 0}/${(p.steps || []).length}` +
      (p.deadline ? `, deadline: ${p.deadline}` : '') +
      (p.ai_notes ? ` | ${p.ai_notes.slice(0, 60)}` : '')
    )
    .join('\n') || '  (none)';

  const deadlinesCtx = tasks
    .filter((t) => t.deadline)
    .map((t) => `  ${t.id}: deadline ${t.deadline}`)
    .join('\n') || '  (none)';

  let raw;
  try {
    raw = await generate({
      model:  DEEPSEEK,
      system: 'Write only short forward-planning bullet points. Use exact IDs and YYYY-MM-DD dates. No preamble.',
      prompt: `Today: ${dateStr}

Projects (by priority):
${projectsCtx}

Tasks with deadlines:
${deadlinesCtx}

Recent planning context:
${planning.slice(-600)}

Write bullets in this style:
- [3d ${fmt(d0)}–${fmt(p3)}] ...
- [1w ${fmt(d0)}–${fmt(p7)}] ...
- [2w ${fmt(d0)}–${fmt(p14)}] ...
- [1m ${fmt(d0)}–${fmt(p30)}] ...

Rules:
- write 1 or 2 bullets for each horizon: 3d, 1w, 2w, 1m
- keep each bullet short
- use exact IDs and YYYY-MM-DD dates when relevant
- output bullets only`,
      options: { temperature: 0.4, num_predict: DEEPSEEK_NUM_PREDICT },
    });
  } catch (err) {
    console.warn('[planner] Step 7 generate failed:', err.message);
    return;
  }

  if (!raw || !raw.trim()) return;

  const section = `\n${normalizeForwardPlanBullets(raw.trim(), dateStr)}\n`;
  try {
    fs.appendFileSync(planningPath, section, 'utf8');
    console.log('[planner] Step 7 — forward plan appended to planning.md');
  } catch (err) {
    console.warn('[planner] Could not append forward plan:', err.message);
  }
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = { generateDayPlan };
