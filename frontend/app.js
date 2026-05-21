/**
 * app.js — Zora persistent calendar view
 * Single view: Calendar (left) | Projects (middle) | Tasks (right)
 */

'use strict';

// ── Galactic Wisdom quotes ────────────────────────────────────────────────────

const GALACTIC_QUOTES = [
  { text: 'Do or do not. There is no try.', source: '— Yoda' },
  { text: 'Your focus determines your reality.', source: '— Qui-Gon Jinn' },
  { text: 'Many of the truths that we cling to depend on our point of view.', source: '— Obi-Wan Kenobi' },
  { text: 'Fear is the path to the dark side. Fear leads to anger. Anger leads to hate. Hate leads to suffering.', source: '— Yoda' },
  { text: 'Train yourself to let go of everything you fear to lose.', source: '— Yoda' },
  { text: 'The greatest teacher, failure is.', source: '— Yoda' },
  { text: 'We are what they grow beyond. That is the burden of all masters.', source: '— Yoda' },
  { text: 'Luminous beings are we, not this crude matter.', source: '— Yoda' },
  { text: "You can't stop the change, any more than you can stop the suns from setting.", source: '— Shmi Skywalker' },
  { text: "In my experience, there's no such thing as luck.", source: '— Obi-Wan Kenobi' },
  { text: 'Rebellions are built on hope.', source: '— Jyn Erso' },
  { text: "Hope is like the sun. If you only believe in it when you can see it, you'll never make it through the night.", source: '— Leia Organa' },
  { text: "That's how we're gonna win. Not fighting what we hate, saving what we love.", source: '— Rose Tico' },
  { text: 'Never tell me the odds!', source: '— Han Solo' },
  { text: 'The belonging you seek is not behind you... it is ahead.', source: '— Maz Kanata' },
  { text: 'An object cannot make you good or evil. Only you can change yourself.', source: '— The Bendu' },
  { text: "It's every citizen's duty to challenge their leaders, to keep them honest, and hold them accountable.", source: '— Ahsoka Tano' },
  { text: 'One man can change the present.', source: '— Obi-Wan Kenobi' },
  { text: 'Always in motion the future is.', source: '— Yoda' },
  { text: 'It is possible to commit no mistakes and still lose. That is not a weakness; that is life.', source: '— Captain Picard' },
  { text: 'The needs of the many outweigh the needs of the few, or the one.', source: '— Spock' },
  { text: "Things are only impossible until they're not.", source: '— Captain Picard' },
  { text: 'Change is the essential process of all existence.', source: '— Spock' },
  { text: 'Logic is the beginning of wisdom, not the end.', source: '— Spock' },
  { text: 'To boldly go where no one has gone before.', source: '— Captain Kirk' },
  { text: 'There is no such thing as the unknown, only things temporarily hidden.', source: '— Captain Kirk' },
  { text: 'Seize the time. Live now! Make now always the most precious time. Now will never come again.', source: '— Captain Picard' },
  { text: 'What we leave behind is not as important as how we have lived.', source: '— Captain Picard' },
  { text: 'It is the unknown that defines our existence. We are constantly searching, not just for answers, but for new questions.', source: '— Captain Sisko' },
  { text: "You can use logic to justify almost anything. That's its power. And its flaw.", source: '— Captain Janeway' },
  { text: 'Risk is our business. That is what this starship is all about.', source: '— Captain Kirk' },
  { text: 'Without freedom of choice, there is no creativity.', source: '— Captain Kirk' },
  { text: 'Strength is born in the deep silence of long-suffering hearts, not amid joy.', source: '— Captain Janeway' },
  { text: "Compassion: that's the one thing no machine ever had. Maybe it's the one thing that keeps men ahead of them.", source: '— Dr. McCoy' },
  { text: "The most elementary and valuable statement in science, the beginning of wisdom, is: 'I do not know.'", source: '— Data' },
  { text: 'Fear exists for one purpose: to be conquered.', source: '— Captain Janeway' },
  { text: 'Confidence is faith in oneself. It cannot easily be given by another.', source: '— Deanna Troi' },
  { text: 'Insufficient facts always invite danger.', source: '— Spock' },
  { text: 'Life must be worn gloriously.', source: '— Captain Pike' },
  { text: 'We must strive to be more than we are. The effort itself yields its own reward.', source: '— Data' },
  { text: 'The first duty of every Starfleet officer is to the truth.', source: '— Captain Picard' },
  { text: "I don't believe in a no-win scenario.", source: '— Captain Kirk' },
  { text: 'The line must be drawn here! This far, no further!', source: '— Captain Picard' },
  { text: 'Humanity will reach maturity on the day that it begins not just to tolerate but take a special delight in differences in ideas.', source: '— Gene Roddenberry' },
];

// ── Loading screen cycle (GIFs + quotes) ──────────────────────────────────────

const _loading = {
  gifTimerId:   null,
  quoteTimerId: null,
  gifs:         [],
  gifIndex:     0,
  quoteIndex:   0,
  activeLayer:  'a',  // 'a' or 'b'
};

const LOADING_GIFS = [
  'https://64.media.tumblr.com/f73847b7d0eedb4823b62e6cb66386f0/2097c70348c33027-bf/s540x810/4ba7aa1d6d445313af584b0a752e0e36e7b5d0f7.gifv',
  'http://64.media.tumblr.com/4abaac6459d098dceeb2cc2c07177c26/db0c380821e85f85-9a/s540x810/dd1240eacf2b6313de7a1428ff48796a6df8f8c7.gifv',
  'https://64.media.tumblr.com/fd30a27b864248d33e3af9f838806270/e5498980dbb2a8eb-42/s540x810/641cb3aed9a199010a9ea8a7335e386c7c0518f1.gifv',
  'https://64.media.tumblr.com/141d2dc69cdc9fae8ac2383d85d03be7/e5498980dbb2a8eb-eb/s540x810/0f6d4e531797c9b4cb937f1cb5e72288c3bda802.gifv',
  'https://cdn.mos.cms.futurecdn.net/NzBBBhZpS5hgAWXcyU6dWc.gif',
  'https://www.simbasible.com/wp-content/uploads/2022/08/1-7.gif',

];

function startLoadingCycle() {
  // Shuffle quotes so we start at a random point
  _loading.quoteIndex = Math.floor(Math.random() * GALACTIC_QUOTES.length);

  // Show first quote immediately (slight delay so screen is visible)
  setTimeout(() => _showNextQuote(), 400);
  // Rotate quotes every 6 seconds
  _loading.quoteTimerId = setInterval(_showNextQuote, 6000);

  // Shuffle GIF order and start cycling
  _loading.gifs = [...LOADING_GIFS].sort(() => Math.random() - 0.5);
  _loading.gifIndex = 0;

  _showNextGif();
  _loading.gifTimerId = setInterval(_showNextGif, 4000);
}

function stopLoadingCycle() {
  clearInterval(_loading.gifTimerId);
  clearInterval(_loading.quoteTimerId);
  _loading.gifTimerId   = null;
  _loading.quoteTimerId = null;

  // Fade out quote
  const wrap = $('#loading-quote-wrap');
  if (wrap) wrap.classList.remove('visible');

  // Reset GIF layers
  const a = $('#gif-layer-a');
  const b = $('#gif-layer-b');
  if (a) { a.classList.remove('active'); a.src = ''; }
  if (b) { b.classList.remove('active'); b.src = ''; }
}

function _showNextQuote() {
  const wrap   = $('#loading-quote-wrap');
  const textEl = $('#loading-quote-text');
  const srcEl  = $('#loading-quote-source');
  if (!wrap || !textEl || !srcEl) return;

  const q = GALACTIC_QUOTES[_loading.quoteIndex % GALACTIC_QUOTES.length];
  _loading.quoteIndex++;

  // Fade out → swap → fade in
  wrap.classList.remove('visible');
  setTimeout(() => {
    textEl.textContent = `"${q.text}"`;
    srcEl.textContent  = q.source;
    wrap.classList.add('visible');
  }, 400);
}

function _showNextGif() {
  if (_loading.gifs.length === 0) return;

  const src   = _loading.gifs[_loading.gifIndex % _loading.gifs.length];
  _loading.gifIndex++;

  const next = _loading.activeLayer === 'a' ? 'b' : 'a';
  const cur  = _loading.activeLayer;

  const nextEl = $(`#gif-layer-${next}`);
  const curEl  = $(`#gif-layer-${cur}`);
  if (!nextEl || !curEl) return;

  // Preload next gif then crossfade
  nextEl.src = src;
  nextEl.onload = () => {
    nextEl.classList.add('active');
    curEl.classList.remove('active');
    _loading.activeLayer = next;
  };
}

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  plan: null,
  names: {},
  calendarEvents: [],
  tasks: [],
  date: null,
  isSchoolDay: false,
  nowTimer: null,
  bubbleTimer: null,
  detailData: null,
  eodRating: null,
  eodBars: {},   // taskId → progressPct
  editor: null,
  pendingEditorSave: null,
};

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugifyId(text, fallback = 'item') {
  const base = String(text || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('-');
  return base || fallback;
}

function findPlanNote(plan, id) {
  if (!plan?.blocks || !id) return '';
  for (const blockName of ['morning', 'afternoon', 'evening']) {
    const found = (plan.blocks[blockName] || []).find((item) => item?.id === id);
    if (found) return found.note || '';
  }
  return '';
}

function blockFromTaskTime(scheduledTime) {
  if (scheduledTime === 'before-school' || scheduledTime === 'morning') return 'morning';
  if (scheduledTime === 'afternoon') return 'afternoon';
  if (scheduledTime === 'evening' || scheduledTime === 'after-dinner' || scheduledTime === 'anytime') return 'evening';
  return 'morning';
}

function removePlanItem(plan, id) {
  for (const blockName of ['morning', 'afternoon', 'evening']) {
    plan.blocks[blockName] = (plan.blocks[blockName] || []).filter((item) => item.id !== id);
  }
}

function setPlanItem(plan, id, note, blockName) {
  removePlanItem(plan, id);
  plan.blocks[blockName] = plan.blocks[blockName] || [];
  plan.blocks[blockName].push({ id, note: note || '' });
}

function normalizeEditorPlan(plan) {
  const keepItem = (item) => item?.id ? {
    id:         item.id,
    note:       item.note       || '',
    start_time: item.start_time || null,
    end_time:   item.end_time   || null,
  } : null;
  const normalizeItems = (arr) => (arr || []).map(keepItem).filter(Boolean);
  return {
    date: plan?.date || state.date || new Date().toLocaleDateString('sv-SE'),
    blocks: {
      morning:   normalizeItems(plan?.blocks?.morning),
      afternoon: normalizeItems(plan?.blocks?.afternoon),
      evening:   normalizeItems(plan?.blocks?.evening),
    },
    events: normalizeItems(plan?.events),
    tasks:  normalizeItems(plan?.tasks),
  };
}

function serializeEditorState(editor) {
  const names = {};

  const projects = editor.projects
    .filter((item) => !item.markedDelete)
    .map((item) => {
      const id = item.isNew ? slugifyId(item.name, 'project') : item.id;
      names[id] = { label: item.name, type: 'project' };
      return {
        id,
        steps: String(item.stepsText || '').split('\n').map((line) => line.trim()).filter(Boolean),
        current_step: Number(item.current_step || 0),
        deadline: item.deadline || null,
        priority_rank: Number(item.priority_rank || 99),
        ai_notes: item.ai_notes || '',
        folder: item.folder || 'active',
        status: item.status || 'active',
      };
    });

  const tasks = editor.tasks
    .filter((item) => !item.markedDelete)
    .map((item) => {
      const id = item.isNew ? slugifyId(item.name || item.desc, 'task') : item.id;
      names[id] = { label: item.name, type: 'task' };
      return {
        id,
        desc: item.desc || '',
        recurring: item.recurring || null,
        deadline: item.deadline || null,
        ai_notes: item.ai_notes || '',
        completed: Boolean(item.completed),
      };
    });

  const events = editor.events
    .filter((item) => !item.markedDelete)
    .map((item) => {
      const id = item.isNew ? slugifyId(item.name, 'event') : item.id;
      names[id] = { label: item.name, type: 'event' };
      return {
        id,
        date:          item.date          || null,
        recurring:     item.recurring     || null,
        time_start:    item.time_start    || null,
        time_end:      item.time_end      || null,
        strict_timing: Boolean(item.strict_timing),
        ai_notes:      item.ai_notes      || '',
        completed:     Boolean(item.completed),
        exceptions:    Array.isArray(item.exceptions) ? item.exceptions : [],
      };
    });

  return { plan: editor.plan, projects, tasks, events, names };
}

function replacePlanId(plan, fromId, toId) {
  if (!plan || !fromId || !toId || fromId === toId) return;
  for (const blockName of ['morning', 'afternoon', 'evening']) {
    plan.blocks[blockName] = (plan.blocks[blockName] || []).map((item) =>
      item.id === fromId ? { ...item, id: toId } : item
    );
  }
  plan.tasks = (plan.tasks || []).map((item) => item.id === fromId ? { ...item, id: toId } : item);
  plan.events = (plan.events || []).map((item) => item.id === fromId ? { ...item, id: toId } : item);
}

function finalizeEditorIds(editor) {
  for (const collectionName of ['projects', 'tasks', 'events']) {
    for (const item of editor[collectionName] || []) {
      if (!item.isNew) continue;
      const fallback = collectionName === 'projects' ? 'project' : collectionName === 'tasks' ? 'task' : 'event';
      const nextId = slugifyId(item.name || item.desc, fallback);
      replacePlanId(editor.plan, item.id, nextId);
      item.id = nextId;
      item.isNew = false;
    }
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function show(el) { el?.classList.remove('hidden'); }
function hide(el) { el?.classList.add('hidden'); }

// ── Starfield ─────────────────────────────────────────────────────────────────

function initStarfield() {
  const canvas = $('#starfield');
  const ctx = canvas.getContext('2d');
  let stars = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = Array.from({ length: 130 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 0.8 + 0.2,
      o: Math.random() * 0.25 + 0.03,
    }));
    // 5 faint vertical grid lines
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(10,20,40,0.35)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i <= 5; i++) {
      const x = (canvas.width / 6) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (const s of stars) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180,200,230,${s.o})`;
      ctx.fill();
    }
  }

  resize();
  window.addEventListener('resize', resize);
}

// ── Rank pip renderer ─────────────────────────────────────────────────────────

/**
 * rank 1 = Fleet Admiral (6 circle pips)
 * rank 2 = Admiral       (4 circle pips)  — wait, let's use the spec mapping:
 * 1=FleetAdm, 2=Adm, 3=ViceAdm, 4=RearAdm, 5=Commodore, 6=Captain(?), 7=Captain, 8=Commander
 *
 * Medal (ranks 1–5): 6 circle slots, filled = rank pips count
 *   Fleet Admiral=6, Admiral=4 (but spec says Medal ranks 1-6)
 * Star (rank 7–8 Captain/Commander): star pips
 *
 * Using memory: Fleet Admiral=6 pips, Admiral=4, Vice Admiral=3, Rear Admiral=2, Commodore=1
 * rank numbers from index: 1=FleetAdm(6pip), 2=Adm(4pip), 3=ViceAdm(3pip), 4=RearAdm(2pip),
 *   5=Commodore(1pip), 7=Captain(2star), 8=Commander(1star)
 */
function renderPips(rank) {
  const rankNum = typeof rank === 'number' ? rank : parseInt(rank, 10);

  if (isNaN(rankNum) || rankNum === 99) return '<div class="card-pips"></div>';

  let pips = '';

  if (rankNum <= 5) {
    // Medal pips (circles) — 6 slots
    const filled = rankNum === 1 ? 6 : rankNum === 2 ? 4 : rankNum === 3 ? 3 : rankNum === 4 ? 2 : 1;
    for (let i = 0; i < 6; i++) {
      pips += `<div class="pip ${i < filled ? 'filled' : 'hollow'}"></div>`;
    }
  } else {
    // Star pips — 2 slots for captain (7), 1 for commander (8)
    const stars = rankNum === 7 ? 2 : 1;
    for (let i = 0; i < 2; i++) {
      pips += `<div class="pip star ${i < stars ? 'filled' : 'hollow'}"></div>`;
    }
  }

  return `<div class="card-pips">${pips}</div>`;
}

// ── Time helpers ──────────────────────────────────────────────────────────────

const START_HOUR = 6;   // 6am
const END_HOUR = 22;  // 10pm
const PX_PER_HR = 52;

function timeToY(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return (h - START_HOUR + m / 60) * PX_PER_HR;
}

function nowY() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  return (h - START_HOUR + m / 60) * PX_PER_HR;
}

function fmtHHMM(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 || 12;
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, '0')}${ampm}`;
}

// ── Calendar column ───────────────────────────────────────────────────────────

function buildTimeGrid() {
  const grid = $('#time-grid');
  if (!grid) return;
  const totalHours = END_HOUR - START_HOUR;
  let html = '';
  // Set total height so events-layer aligns
  grid.style.height = totalHours * PX_PER_HR + 'px';
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    const label = h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`;
    html += `<div class="time-row">
      <div class="time-label">${label}</div>
      <div class="time-line"></div>
    </div>`;
  }
  grid.innerHTML = html;

  // Events layer needs same height
  const evLayer = $('#events-layer');
  if (evLayer) evLayer.style.minHeight = totalHours * PX_PER_HR + 'px';
}

function renderCalendarEvents(events) {
  const layer = $('#events-layer');
  if (!layer) return;

  // Remove old event blocks (keep now-line)
  $$('.cal-event', layer).forEach((el) => el.remove());

  const normalizedEvents = (events || [])
    .map((ev) => normalizeCalendarEvent(ev, state.plan))
    .filter((ev) => ev?.startTime && ev?.endTime);

  // Group same-startTime events for width splitting
  const groups = {};
  for (const ev of normalizedEvents) {
    const key = ev.startTime || 'none';
    if (!groups[key]) groups[key] = [];
    groups[key].push(ev);
  }

  for (const ev of normalizedEvents) {
    const topPx = timeToY(ev.startTime);
    const botPx = timeToY(ev.endTime);
    const heightPx = Math.max(botPx - topPx, 20);

    const siblings = groups[ev.startTime] || [ev];
    const idx = siblings.indexOf(ev);
    const count = siblings.length;
    const pct = 100 / count;
    const left = idx * pct;

    const div = document.createElement('div');
    div.className = `cal-event cal-${ev.color || 'blue'}${ev.type === 'adjacent' ? ' adjacent' : ''}`;
    div.style.top = topPx + 'px';
    div.style.height = heightPx + 'px';
    div.style.left = left + '%';
    div.style.right = (100 - left - pct) + '%';
    div.dataset.id = ev.id;

    div.innerHTML = `
      <div class="cal-event-title">${escHtml(ev.title)}</div>
      <div class="cal-event-time">${fmtHHMM(ev.startTime)}–${fmtHHMM(ev.endTime)}</div>
    `;

    div.addEventListener('click', () => showDetail({ type: 'calendar', data: ev }));
    layer.appendChild(div);
  }
}

function updateNowLine() {
  const y = nowY();
  const nowLine = $('#now-line');
  if (nowLine) nowLine.style.top = y + 'px';

  // Middle column now line — proportional position
  updateMidNowLine();
}

function updateMidNowLine() {
  const midLine = $('#now-line-mid');
  if (!midLine) return;

  const body = $('#col-projects-body');
  if (!body) return;

  const scrollH = body.scrollHeight;
  const h = new Date().getHours();
  const m = new Date().getMinutes();
  const totalMins = (END_HOUR - START_HOUR) * 60;
  const elapsed = Math.max(0, (h - START_HOUR) * 60 + m);
  const frac = Math.min(elapsed / totalMins, 1);
  midLine.style.top = (frac * scrollH) + 'px';
}

// ── Project cards ─────────────────────────────────────────────────────────────

function renderProjectBlock(blockKey, tasks, label) {
  const labelEl = $(`#block-${blockKey} .block-label`);
  if (labelEl) labelEl.textContent = label;

  const area = $(`#cards-${blockKey}`);
  if (!area) return;
  area.innerHTML = '';

  for (const task of tasks) {
    area.appendChild(buildProjectCard(task));
  }
}

function buildProjectCard(task) {
  const div = document.createElement('div');
  div.className = 'project-card';
  div.dataset.id = task.id;

  const staleHtml = (task.days_since_worked > 5)
    ? '<div class="stale-dot" title="Stale"></div>' : '';

  const timeStr = task.estimatedMinutes
    ? (task.estimatedMinutes >= 60
      ? `${Math.round(task.estimatedMinutes / 60)}h`
      : `${task.estimatedMinutes}m`)
    : '';

  div.innerHTML = `
    <div class="card-top-row">
      ${renderPips(task.rank || task.rankNumber)}
      <div class="card-name">${escHtml(task.name || '(no name)')}</div>
      ${timeStr ? `<div class="card-time">${timeStr}</div>` : ''}
      ${staleHtml}
    </div>
    <div class="card-step">${escHtml(task.todayStep || task.objective || task.note || '')}</div>
  `;

  div.addEventListener('click', () => showDetail({ type: 'project', data: task }));
  return div;
}

function hydratePlanEntry(entry) {
  if (!entry || !entry.id) return entry;

  return {
    ...entry,
    name: entry.name || state.names?.[entry.id] || entry.id,
    objective: entry.objective || entry.note || '',
    todayStep: entry.todayStep || entry.note || '',
  };
}

function hydratePlan(plan) {
  if (!plan) return plan;

  const blocks = plan.blocks || {};
  return {
    ...plan,
    blocks: {
      morning:   (blocks.morning || []).map(hydratePlanEntry),
      afternoon: (blocks.afternoon || []).map(hydratePlanEntry),
      evening:   (blocks.evening || []).map(hydratePlanEntry),
    },
  };
}

function findBlockForId(plan, id) {
  if (!plan?.blocks || !id) return null;
  for (const blockName of ['morning', 'afternoon', 'evening']) {
    if ((plan.blocks[blockName] || []).some((item) => item?.id === id)) return blockName;
  }
  return null;
}

function normalizeTask(task, plan = state.plan) {
  if (!task) return task;
  const blockName = findBlockForId(plan, task.id);
  return {
    ...task,
    text: task.text || task.desc || task.note || state.names?.[task.id] || task.id,
    scheduledTime: task.scheduledTime || blockName || task.time_slot || 'anytime',
  };
}

function mergePlannedTasks(tasks, plan) {
  const merged = new Map((tasks || []).map((task) => [task.id, normalizeTask(task, plan)]));

  for (const plannedTask of plan?.tasks || []) {
    const existing = merged.get(plannedTask.id) || {};
    merged.set(plannedTask.id, normalizeTask({
      ...existing,
      ...plannedTask,
      id: plannedTask.id,
      source: existing.source || 'plan',
    }, plan));
  }

  return [...merged.values()];
}

function findPlanTimes(plan, id) {
  if (!plan?.blocks || !id) return null;
  for (const blockName of ['morning', 'afternoon', 'evening']) {
    const item = (plan.blocks[blockName] || []).find((b) => b?.id === id);
    if (item?.start_time && item?.end_time) {
      return { startTime: item.start_time, endTime: item.end_time };
    }
  }
  // Also check plan.events array
  const evItem = (plan.events || []).find((e) => e?.id === id);
  if (evItem?.start_time && evItem?.end_time) {
    return { startTime: evItem.start_time, endTime: evItem.end_time };
  }
  return null;
}

function normalizeCalendarEvent(event, plan = state.plan) {
  if (!event) return event;
  const normalized = {
    ...event,
    title: event.title || event.name || state.names?.[event.id] || event.id,
    info:  event.info  || event.note  || event.ai_notes || '',
  };
  if (normalized.startTime && normalized.endTime) return normalized;
  // Strict timing: always use the master event's fixed times
  if (event.strict_timing && event.time_start && event.time_end) {
    return { ...normalized, startTime: event.time_start, endTime: event.time_end };
  }
  // Non-strict: use planner-assigned times from the daily plan
  const planTimes = findPlanTimes(plan, event.id);
  return planTimes ? { ...normalized, ...planTimes } : normalized;
}

function mergePlannedEvents(events, plan) {
  const merged = new Map((events || []).map((event) => [event.id, normalizeCalendarEvent(event, plan)]));

  const plannedEvents = [
    ...(plan?.events || []),
    ...(Array.isArray(plan?.important_events) ? plan.important_events : []),
  ];

  for (const plannedEvent of plannedEvents) {
    if (!plannedEvent?.id) continue;
    const existing = merged.get(plannedEvent.id) || {};
    merged.set(plannedEvent.id, normalizeCalendarEvent({
      ...existing,
      ...plannedEvent,
      id: plannedEvent.id,
      source: existing.source || 'plan',
    }, plan));
  }

  return [...merged.values()];
}

async function fetchEditorContext() {
  const res = await fetch('/api/editor/context');
  const raw = await res.text();
  let data = null;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    if (!res.ok) {
      throw new Error(`Editor API unavailable (${res.status}).`);
    }
    throw new Error('Editor API returned invalid JSON.');
  }

  if (!res.ok) {
    throw new Error(data?.error || `Editor API unavailable (${res.status}).`);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function buildLocalEditorContext() {
  const plan = normalizeEditorPlan(cloneDeep(state.plan || {
    date: state.date || '',
    blocks: { morning: [], afternoon: [], evening: [] },
    events: [],
    tasks: [],
  }));

  const names = { ...(state.names || {}) };
  const projectMap = new Map();

  for (const blockName of ['morning', 'afternoon', 'evening']) {
    for (const item of plan.blocks[blockName] || []) {
      if (!item?.id) continue;
      if (!names[item.id] && item.name) names[item.id] = item.name;
      if (!projectMap.has(item.id)) {
        projectMap.set(item.id, {
          id: item.id,
          steps: [],
          current_step: 0,
          deadline: null,
          priority_rank: 99,
          ai_notes: '',
          folder: 'active',
          status: 'active',
        });
      }
    }
  }

  const taskMap = new Map();
  for (const task of state.tasks || []) {
    if (!task?.id) continue;
    taskMap.set(task.id, { ...task });
  }
  for (const item of plan.tasks || []) {
    if (!item?.id || taskMap.has(item.id)) continue;
    taskMap.set(item.id, {
      id: item.id,
      desc: item.note || '',
      recurring: null,
      deadline: null,
      ai_notes: '',
      completed: false,
    });
  }

  const eventMap = new Map();
  for (const event of state.calendarEvents || []) {
    if (!event?.id) continue;
    eventMap.set(event.id, { ...event });
  }
  for (const item of plan.events || []) {
    if (!item?.id || eventMap.has(item.id)) continue;
    eventMap.set(item.id, {
      id: item.id,
      date: plan.date || state.date || null,
      recurring: null,
      time_slot: findBlockForId(plan, item.id),
      ai_notes: item.note || '',
      completed: false,
      exceptions: [],
    });
  }

  return {
    date: state.date || plan.date || '',
    plan,
    names,
    projects: [...projectMap.values()],
    tasks: [...taskMap.values()],
    events: [...eventMap.values()],
  };
}

function openEditorReason() {
  show($('#editor-reason-overlay'));
  $('#editor-reason-input').value = '';
  $('#editor-reason-input')?.focus();
}

function closeEditorReason() {
  hide($('#editor-reason-overlay'));
}

function closeEditorModal() {
  hide($('#editor-overlay'));
  hide($('#editor-reason-overlay'));
  state.editor = null;
  state.pendingEditorSave = null;
}

function buildEditorRows(kind) {
  const items = (state.editor?.[kind] || []).filter((item) => !item.markedDelete);

  return items.map((item, index) => {
    if (kind === 'projects') {
      return `
        <div class="editor-item">
          <div class="editor-item-top">
            <div class="editor-item-id">${escHtml(item.id)}</div>
            <div class="editor-actions-row">
              <button class="editor-mini-btn" data-editor-action="move-up" data-kind="${kind}" data-index="${index}">Up</button>
              <button class="editor-mini-btn" data-editor-action="move-down" data-kind="${kind}" data-index="${index}">Down</button>
              <button class="editor-mini-btn danger" data-editor-action="delete-row" data-kind="${kind}" data-index="${index}">Delete</button>
            </div>
          </div>
          <div class="editor-item-grid three">
            <label class="editor-field"><span class="editor-field-label">Name</span><input class="editor-input" data-editor-kind="${kind}" data-index="${index}" data-field="name" value="${escAttr(item.name || '')}" /></label>
            <label class="editor-field"><span class="editor-field-label">Deadline</span><input type="date" class="editor-input" data-editor-kind="${kind}" data-index="${index}" data-field="deadline" value="${escAttr(item.deadline || '')}" /></label>
            <label class="editor-field"><span class="editor-field-label">Rank</span><input type="number" min="1" class="editor-input" data-editor-kind="${kind}" data-index="${index}" data-field="priority_rank" value="${escAttr(item.priority_rank ?? 99)}" /></label>
          </div>
          <label class="editor-field"><span class="editor-field-label">Steps</span><textarea class="editor-textarea" data-editor-kind="${kind}" data-index="${index}" data-field="stepsText">${escHtml(item.stepsText || '')}</textarea></label>
          <div class="editor-item-grid">
            <label class="editor-checkbox"><input type="checkbox" data-editor-kind="${kind}" data-index="${index}" data-field="includeToday" ${item.includeToday ? 'checked' : ''} /> Include in today's plan</label>
            <label class="editor-field"><span class="editor-field-label">Block</span>
              <select class="editor-select" data-editor-kind="${kind}" data-index="${index}" data-field="planBlock">
                <option value="morning" ${item.planBlock === 'morning' ? 'selected' : ''}>Morning</option>
                <option value="afternoon" ${item.planBlock === 'afternoon' ? 'selected' : ''}>Afternoon</option>
                <option value="evening" ${item.planBlock === 'evening' ? 'selected' : ''}>Evening</option>
              </select>
            </label>
          </div>
          <label class="editor-field"><span class="editor-field-label">Today's Note</span><textarea class="editor-textarea" data-editor-kind="${kind}" data-index="${index}" data-field="planNote">${escHtml(item.planNote || '')}</textarea></label>
        </div>`;
    }

    if (kind === 'tasks') {
      return `
        <div class="editor-item">
          <div class="editor-item-top">
            <div class="editor-item-id">${escHtml(item.id)}</div>
            <div class="editor-actions-row">
              <button class="editor-mini-btn" data-editor-action="move-up" data-kind="${kind}" data-index="${index}">Up</button>
              <button class="editor-mini-btn" data-editor-action="move-down" data-kind="${kind}" data-index="${index}">Down</button>
              <button class="editor-mini-btn danger" data-editor-action="delete-row" data-kind="${kind}" data-index="${index}">Delete</button>
            </div>
          </div>
          <div class="editor-item-grid">
            <label class="editor-field"><span class="editor-field-label">Name</span><input class="editor-input" data-editor-kind="${kind}" data-index="${index}" data-field="name" value="${escAttr(item.name || '')}" /></label>
            <label class="editor-field"><span class="editor-field-label">Deadline</span><input type="date" class="editor-input" data-editor-kind="${kind}" data-index="${index}" data-field="deadline" value="${escAttr(item.deadline || '')}" /></label>
          </div>
          <label class="editor-field"><span class="editor-field-label">Description</span><textarea class="editor-textarea" data-editor-kind="${kind}" data-index="${index}" data-field="desc">${escHtml(item.desc || '')}</textarea></label>
          <div class="editor-item-grid">
            <label class="editor-field"><span class="editor-field-label">Recurring</span><input class="editor-input" data-editor-kind="${kind}" data-index="${index}" data-field="recurring" value="${escAttr(item.recurring || '')}" /></label>
            <label class="editor-field"><span class="editor-field-label">Time</span>
              <select class="editor-select" data-editor-kind="${kind}" data-index="${index}" data-field="scheduledTime">
                ${['morning','afternoon','evening'].map((option) => `<option value="${option}" ${blockFromTaskTime(item.scheduledTime) === option ? 'selected' : ''}>${option}</option>`).join('')}
              </select>
            </label>
          </div>
          <label class="editor-checkbox"><input type="checkbox" data-editor-kind="${kind}" data-index="${index}" data-field="includeToday" ${item.includeToday ? 'checked' : ''} /> Include in today's plan</label>
          <label class="editor-field"><span class="editor-field-label">Today's Note</span><textarea class="editor-textarea" data-editor-kind="${kind}" data-index="${index}" data-field="planNote">${escHtml(item.planNote || '')}</textarea></label>
        </div>`;
    }

    return `
      <div class="editor-item">
        <div class="editor-item-top">
          <div class="editor-item-id">${escHtml(item.id)}</div>
          <div class="editor-actions-row">
            <button class="editor-mini-btn" data-editor-action="move-up" data-kind="${kind}" data-index="${index}">Up</button>
            <button class="editor-mini-btn" data-editor-action="move-down" data-kind="${kind}" data-index="${index}">Down</button>
            <button class="editor-mini-btn danger" data-editor-action="delete-row" data-kind="${kind}" data-index="${index}">Delete</button>
          </div>
        </div>
        <div class="editor-item-grid">
          <label class="editor-field"><span class="editor-field-label">Name</span><input class="editor-input" data-editor-kind="${kind}" data-index="${index}" data-field="name" value="${escAttr(item.name || '')}" /></label>
          <label class="editor-field"><span class="editor-field-label">Date</span><input type="date" class="editor-input" data-editor-kind="${kind}" data-index="${index}" data-field="date" value="${escAttr(item.date || '')}" /></label>
        </div>
        <div class="editor-item-grid">
          <label class="editor-field"><span class="editor-field-label">Recurring</span><input class="editor-input" data-editor-kind="${kind}" data-index="${index}" data-field="recurring" value="${escAttr(item.recurring || '')}" /></label>
          <label class="editor-field"><span class="editor-field-label">Start Time</span><input type="time" class="editor-input" data-editor-kind="${kind}" data-index="${index}" data-field="time_start" value="${escAttr(item.time_start || '')}" /></label>
          <label class="editor-field"><span class="editor-field-label">End Time</span><input type="time" class="editor-input" data-editor-kind="${kind}" data-index="${index}" data-field="time_end" value="${escAttr(item.time_end || '')}" /></label>
        </div>
        <label class="editor-checkbox"><input type="checkbox" data-editor-kind="${kind}" data-index="${index}" data-field="strict_timing" ${item.strict_timing ? 'checked' : ''} /> Strict timing (AI cannot adjust)</label>
        <label class="editor-checkbox"><input type="checkbox" data-editor-kind="${kind}" data-index="${index}" data-field="includeToday" ${item.includeToday ? 'checked' : ''} /> Include in today's plan</label>
        <label class="editor-field"><span class="editor-field-label">Today's Note</span><textarea class="editor-textarea" data-editor-kind="${kind}" data-index="${index}" data-field="planNote">${escHtml(item.planNote || '')}</textarea></label>
      </div>`;
  }).join('');
}

function renderEditorModal() {
  const editor = state.editor;
  if (!editor) return;
  const titleMap = {
    projects: 'Edit Projects',
    tasks: 'Edit Tasks',
    calendar: 'Edit Calendar',
  };
  $('#editor-title').textContent = titleMap[editor.kind] || 'Edit';
  $('#editor-subtitle').textContent = 'Move items, add existing or new ones, and choose whether they belong in today\'s plan or only the master list.';
  $('#editor-content').innerHTML = `
    <div class="editor-section">
      <div class="editor-section-title">${escHtml(titleMap[editor.kind] || 'Edit')}</div>
      <div class="editor-actions-row">
        <button class="editor-mini-btn" data-editor-action="add-row" data-kind="${editor.kind}">Add New</button>
      </div>
      <div class="editor-list">${buildEditorRows(editor.kind)}</div>
    </div>
  `;
  show($('#editor-overlay'));
}

function makeNewEditorRow(kind) {
  if (kind === 'projects') {
    return {
      id: `new-project-${Date.now()}`,
      name: '',
      stepsText: '',
      current_step: 0,
      deadline: '',
      priority_rank: 99,
      ai_notes: '',
      folder: 'active',
      status: 'active',
      includeToday: true,
      planBlock: 'morning',
      planNote: '',
      isNew: true,
    };
  }
  if (kind === 'tasks') {
    return {
      id: `new-task-${Date.now()}`,
      name: '',
      desc: '',
      recurring: '',
      deadline: '',
      ai_notes: '',
      completed: false,
      includeToday: true,
      scheduledTime: 'anytime',
      planNote: '',
      isNew: true,
    };
  }
  return {
    id:            `new-event-${Date.now()}`,
    name:          '',
    date:          '',
    recurring:     '',
    time_start:    '',
    time_end:      '',
    strict_timing: false,
    ai_notes:      '',
    completed:     false,
    exceptions:    [],
    includeToday:  true,
    planNote:      '',
    isNew:         true,
  };
}

function syncPlanFromEditor(kind) {
  const editor = state.editor;
  if (!editor) return;
  editor.plan = normalizeEditorPlan(editor.plan);

  if (kind === 'projects') {
    const projectIds = new Set(editor.projects.map((item) => item.id));
    for (const id of projectIds) removePlanItem(editor.plan, id);
    for (const item of editor.projects) {
      if (item.markedDelete || !item.includeToday) continue;
      setPlanItem(editor.plan, item.id, item.planNote || item.name, item.planBlock || 'morning');
    }
  }

  if (kind === 'tasks') {
    const taskIds = new Set(editor.tasks.map((item) => item.id));
    for (const id of taskIds) removePlanItem(editor.plan, id);
    editor.plan.tasks = [];
    for (const item of editor.tasks) {
      if (item.markedDelete || !item.includeToday) continue;
      editor.plan.tasks.push({ id: item.id, note: item.planNote || item.desc || item.name });
      setPlanItem(editor.plan, item.id, item.planNote || item.desc || item.name, blockFromTaskTime(item.scheduledTime));
    }
  }

  if (kind === 'calendar') {
    editor.plan.events = [];
    for (const item of editor.events) {
      if (item.markedDelete || !item.includeToday) continue;
      const planItem = {
        id:   item.id,
        note: item.planNote || item.name,
        start_time: null,
        end_time:   null,
      };
      // Strict events always propagate their fixed times into the plan
      if (item.strict_timing && item.time_start && item.time_end) {
        planItem.start_time = item.time_start;
        planItem.end_time   = item.time_end;
        // Also update timing in any block that already contains this event
        for (const blockName of ['morning', 'afternoon', 'evening']) {
          const blockItem = (editor.plan.blocks[blockName] || []).find((b) => b.id === item.id);
          if (blockItem) {
            blockItem.start_time = item.time_start;
            blockItem.end_time   = item.time_end;
          }
        }
      }
      editor.plan.events.push(planItem);
    }
  }
}

async function openColumnEditor(kind) {
  let ctx;
  try {
    ctx = await fetchEditorContext();
  } catch (err) {
    console.warn('[editor] falling back to local context:', err.message);
    ctx = buildLocalEditorContext();
  }
  const plan = normalizeEditorPlan(ctx.plan);
  const names = ctx.names || {};
  state.editor = {
    kind,
    date: ctx.date,
    names,
    plan,
    projects: (ctx.projects || []).map((item) => ({
      ...item,
      name: names[item.id] || item.id,
      stepsText: (item.steps || []).join('\n'),
      includeToday: Boolean(findBlockForId(plan, item.id)),
      planBlock: findBlockForId(plan, item.id) || 'morning',
      planNote: findPlanNote(plan, item.id),
    })),
    tasks: (ctx.tasks || []).map((item) => ({
      ...item,
      name: names[item.id] || item.id,
      includeToday: Boolean((plan.tasks || []).some((entry) => entry.id === item.id) || findBlockForId(plan, item.id)),
      scheduledTime: normalizeTask(item, plan).scheduledTime,
      planNote: ((plan.tasks || []).find((entry) => entry.id === item.id)?.note) || findPlanNote(plan, item.id),
    })),
    events: (ctx.events || []).map((item) => ({
      ...item,
      name:          names[item.id] || item.id,
      time_start:    item.time_start    || '',
      time_end:      item.time_end      || '',
      strict_timing: item.strict_timing || false,
      includeToday:  Boolean((plan.events || []).some((entry) => entry.id === item.id)),
      planNote:      ((plan.events || []).find((entry) => entry.id === item.id)?.note) || '',
    })),
  };
  renderEditorModal();
}

function updateEditorField(el) {
  const editor = state.editor;
  if (!editor) return;
  const kind = el.dataset.editorKind;
  const index = Number(el.dataset.index);
  const field = el.dataset.field;
  const row = editor?.[kind]?.[index];
  if (!row || !field) return;
  row[field] = el.type === 'checkbox' ? el.checked : el.value;
}

function moveEditorRow(kind, index, delta) {
  const list = state.editor?.[kind];
  if (!list) return;
  const next = index + delta;
  if (next < 0 || next >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(next, 0, item);
  renderEditorModal();
}

function markEditorRowDeleted(kind, index) {
  const list = state.editor?.[kind];
  if (!list) return;
  list.splice(index, 1);
  renderEditorModal();
}

function buildEditorSummary(editor) {
  return `Manual ${editor.kind} edit on ${editor.plan?.date || state.date || 'today'}.`;
}

async function submitEditorSave() {
  const editor = state.editor;
  if (!editor) return;
  finalizeEditorIds(editor);
  syncPlanFromEditor(editor.kind);
  const payload = serializeEditorState(editor);
  const reason = $('#editor-reason-input')?.value.trim() || '';
  payload.reason = reason;
  payload.summary = buildEditorSummary(editor);

  const loadingText = $('#loading-text');
  if (loadingText) loadingText.textContent = 'Saving edits…';
  show($('#loading-screen'));
  hide($('#view-main'));
  startLoadingCycle();

  try {
    const res = await fetch('/api/editor/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      if (!res.ok) throw new Error(`Editor save API unavailable (${res.status}). Restart the backend and try again.`);
      throw new Error('Editor save returned invalid JSON.');
    }
    if (!res.ok) throw new Error(data?.error || `Editor save failed (${res.status}).`);
    if (data.error) throw new Error(data.error);
    closeEditorModal();
    await reloadView();
  } catch (err) {
    console.error('[editor] save failed:', err);
    UIUpdater.showResponse(err.message || 'Editor save failed.');
  } finally {
    stopLoadingCycle();
    hide($('#loading-screen'));
    show($('#view-main'));
  }
}

function renderAllProjectBlocks(plan) {
  if (!plan) return;

  const blocks = plan.blocks || {};
  const labels = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

  for (const key of ['morning', 'afternoon', 'evening']) {
    renderProjectBlock(key, blocks[key] || [], labels[key]);
  }

  // Update block labels
  if ($('#block-morning  .block-label')) $('#block-morning  .block-label').textContent = labels.morning;
  if ($('#block-afternoon .block-label')) $('#block-afternoon .block-label').textContent = labels.afternoon;
  if ($('#block-evening  .block-label')) $('#block-evening  .block-label').textContent = labels.evening;
}

// ── Task items ────────────────────────────────────────────────────────────────

const SECTION_MAP = {
  'morning': 'tasks-morning',
  'afternoon': 'tasks-afternoon',
  'evening': 'tasks-evening',
};

// Also map HH:MM times to sections by hour
function sectionForTask(task) {
  const st = task.scheduledTime;
  if (!st) return 'tasks-evening';
  if (SECTION_MAP[st]) return SECTION_MAP[st];
  // HH:MM
  const m = st.match(/^(\d{1,2}):/);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h < 12) return 'tasks-morning';
    if (h < 17) return 'tasks-afternoon';
    return 'tasks-evening';
  }
  return 'tasks-evening';
}

function renderAllTasks(tasks) {
  // Clear all section bodies (keep the label)
  for (const sectionId of Object.values(SECTION_MAP)) {
    const section = $(`#${sectionId}`);
    if (!section) continue;
    $$('.task-item', section).forEach((el) => el.remove());
  }

  for (const task of tasks) {
    const sectionId = sectionForTask(task);
    const section = $(`#${sectionId}`);
    if (!section) continue;
    section.appendChild(buildTaskItem(task));
  }
}

function buildTaskItem(task) {
  const text = task.text || task.desc || task.note || state.names?.[task.id] || task.id;
  const div = document.createElement('div');
  div.className = `task-item${task.urgent ? ' urgent' : ''}`;
  div.dataset.id = task.id;

  const timeLabel = task.scheduledTime && task.scheduledTime.match(/^\d{1,2}:\d{2}$/)
    ? task.scheduledTime : '';

  div.innerHTML = `
    <div class="task-checkbox${task.completed ? ' checked' : ''}" data-id="${escAttr(task.id)}">
      ${task.completed ? '✓' : ''}
    </div>
    <div class="task-content">
      <div class="task-text${task.completed ? ' done' : ''}">${escHtml(text)}</div>
      ${timeLabel ? `<div class="task-time">${timeLabel}</div>` : ''}
    </div>
  `;

  // Checkbox click — toggle complete directly
  const cb = $('.task-checkbox', div);
  cb.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTaskComplete(task);
  });

  // Body click — open detail
  div.addEventListener('click', () => showDetail({ type: 'task', data: task }));

  return div;
}

async function toggleTaskComplete(task) {
  try {
    const res = await fetch('/api/tasks/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id }),
    });
    const data = await res.json();
    if (data.ok) UIUpdater.completeTaskItem(task.id);
  } catch (err) {
    console.error('toggleTaskComplete:', err);
  }
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function showDetail(item) {
  state.detailData = item;

  const panel = $('#detail-panel');
  const titleEl = $('#detail-title');
  const chipsEl = $('#detail-chips');
  const bodyEl = $('#detail-body');
  const actEl = $('#detail-actions');

  if (!panel) return;

  let title = '';
  let chips = [];
  let body = '';
  let actions = [];

  if (item.type === 'calendar') {
    const ev = item.data;
    title = ev.title;
    chips = [
      `${fmtHHMM(ev.startTime)}–${fmtHHMM(ev.endTime)}`,
      ev.source || 'local',
      ev.recurringRule ? `Recurring: ${ev.recurringRule}` : null,
      ev.flagged ? { text: ev.rank || 'Flagged', cls: 'red' } : null,
      ev.completed ? { text: 'Archived', cls: 'green' } : null,
    ].filter(Boolean);
    body = ev.info || '';
    actions = [
      { label: 'Edit time', phrase: `Edit ${ev.title} time to ` },
      { label: 'Add adjacent event', phrase: `Add adjacent event inside ${ev.title}: ` },
      { label: 'Skip today', phrase: `Skip ${ev.title} today` },
      { label: 'Archive', phrase: `Archive ${ev.title}` },
      { label: 'Delete', phrase: `Delete calendar event ${ev.id}` },
    ];
  } else if (item.type === 'project') {
    const t = item.data;
    title = t.name;
    chips = [
      t.rankLabel || '',
      t.estimatedMinutes ? (t.estimatedMinutes >= 60 ? `${Math.round(t.estimatedMinutes / 60)}h` : `${t.estimatedMinutes}m`) : null,
      t.status || 'active',
      t.days_since_worked > 0 ? `${t.days_since_worked}d stale` : null,
    ].filter(Boolean);
    body = (t.objective ? t.objective + '\n\n' : '') +
      (t.todayStep ? 'Today: ' + t.todayStep : '');
    actions = [
      { label: 'Mark done', phrase: `Complete task ${t.id}` },
      { label: 'Update step', phrase: `Update ${t.name}: ` },
      { label: 'Reschedule', phrase: `Reschedule ${t.name} to ` },
      { label: 'Archive', phrase: `Archive ${t.name}` },
    ];
  } else if (item.type === 'task') {
    const t = item.data;
    title = t.text || t.desc || t.note || t.id;
    chips = [
      t.scheduledTime || 'anytime',
      t.source !== 'manual' ? t.source : null,
      t.urgent ? { text: 'Urgent', cls: 'red' } : null,
      t.completed ? { text: 'Done', cls: 'green' } : null,
    ].filter(Boolean);
    body = t.text || t.desc || t.note || '';
    actions = [
      { label: 'Mark complete', phrase: `Complete task item ${t.id}` },
      { label: 'Reschedule', phrase: `Reschedule task ${t.id} to ` },
      { label: 'Delete', phrase: `Delete task item ${t.id}` },
      { label: 'Create follow-up', phrase: `New task: follow up on ${t.text || t.desc || t.id}` },
    ];
  }

  titleEl.textContent = title;

  chipsEl.innerHTML = chips.map((c) => {
    if (typeof c === 'object') {
      return `<span class="chip ${c.cls}">${escHtml(c.text)}</span>`;
    }
    return `<span class="chip">${escHtml(c)}</span>`;
  }).join('');

  bodyEl.textContent = body;

  actEl.innerHTML = '';
  for (const act of actions) {
    const btn = document.createElement('button');
    btn.className = 'detail-action-btn';
    btn.textContent = act.label;
    btn.addEventListener('click', () => {
      const input = $('#chat-input');
      if (input) {
        input.value = act.phrase;
        input.focus();
      }
      closeDetail();
    });
    actEl.appendChild(btn);
  }

  panel.classList.remove('detail-hidden');
}

function closeDetail() {
  const panel = $('#detail-panel');
  if (panel) panel.classList.add('detail-hidden');
  state.detailData = null;
}

// ── UIUpdater ─────────────────────────────────────────────────────────────────

const UIUpdater = {
  // Project cards
  updateCard(id, data) {
    const el = $(`[data-id="${id}"].project-card`);
    if (el) {
      const fresh = buildProjectCard(data);
      el.replaceWith(fresh);
    }
  },
  addCard(task, block) {
    const area = $(`#cards-${block}`);
    if (area) area.appendChild(buildProjectCard(task));
  },
  removeCard(id) {
    const el = $(`[data-id="${id}"].project-card`);
    if (el) el.remove();
  },

  // Calendar events
  addCalendarEvent(event) {
    state.calendarEvents.push(event);
    renderCalendarEvents(state.calendarEvents);
  },
  updateCalendarEvent(id, data) {
    const idx = state.calendarEvents.findIndex((e) => e.id === id);
    if (idx !== -1) {
      state.calendarEvents[idx] = { ...state.calendarEvents[idx], ...data };
      renderCalendarEvents(state.calendarEvents);
    }
  },
  removeCalendarEvent(id) {
    state.calendarEvents = state.calendarEvents.filter((e) => e.id !== id);
    renderCalendarEvents(state.calendarEvents);
  },

  // Task items
  addTaskItem(task) {
    state.tasks.push(task);
    const section = $(`#${sectionForTask(task)}`);
    if (section) section.appendChild(buildTaskItem(task));
  },
  completeTaskItem(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (task) task.completed = true;
    const el = $(`[data-id="${id}"].task-item`);
    if (el) {
      const cb = $('.task-checkbox', el);
      const text = $('.task-text', el);
      if (cb) { cb.classList.add('checked'); cb.textContent = '✓'; }
      if (text) text.classList.add('done');
    }
  },
  removeTaskItem(id) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    const el = $(`[data-id="${id}"].task-item`);
    if (el) el.remove();
  },
  reorderTaskItems(ids) {
    reloadView();
  },
  updateTaskItemEl(id, data) {
    const idx = state.tasks.findIndex((t) => t.id === id);
    if (idx !== -1) state.tasks[idx] = { ...state.tasks[idx], ...data };
    const el = $(`[data-id="${id}"].task-item`);
    if (el) el.replaceWith(buildTaskItem(state.tasks[idx]));
  },

  // Response bubble
  showResponse(text) {
    const bubble = $('#response-bubble');
    const span = $('#response-text');
    const cursor = $('#response-cursor');
    if (!bubble) return;
    if (span) span.textContent = text;
    if (cursor) hide(cursor);
    show(bubble);
    clearTimeout(state.bubbleTimer);
    state.bubbleTimer = setTimeout(() => hide(bubble), 8000);
  },
  showStreamToken(token) {
    const bubble = $('#response-bubble');
    const span = $('#response-text');
    const cursor = $('#response-cursor');
    if (!bubble) return;
    if (span) span.textContent += token;
    if (cursor) show(cursor);
    show(bubble);
    clearTimeout(state.bubbleTimer);
  },
  endStream() {
    const cursor = $('#response-cursor');
    if (cursor) hide(cursor);
    clearTimeout(state.bubbleTimer);
    state.bubbleTimer = setTimeout(() => hide($('#response-bubble')), 8000);
  },

  // Detail
  showDetail,
  closeDetail,

  // Full reload
  reloadView,
};

// ── Apply UI updates from action engine ───────────────────────────────────────

function applyUIUpdates(updates) {
  for (const u of (updates || [])) {
    switch (u.type) {
      // ── Project cards (middle column) ─────────────────────────────────────
      case 'update_card': UIUpdater.updateCard(u.target, u.data); break;
      case 'add_card': UIUpdater.addCard(u.data?.task, u.data?.block || 'evening'); break;
      case 'remove_card': UIUpdater.removeCard(u.target); break;
      case 'move_card': reloadView(); break; // project_reschedule re-renders
      case 'reload_view': reloadView(); break; // project_reorder, plan_update, plan_reset, system_preference

      // ── Calendar (left column) ────────────────────────────────────────────
      case 'add_calendar_event': UIUpdater.addCalendarEvent(u.data); break;
      case 'update_calendar_event': UIUpdater.updateCalendarEvent(u.target, u.data); break;
      case 'remove_calendar_event': UIUpdater.removeCalendarEvent(u.target); break;
      case 'archive_calendar_event': UIUpdater.updateCalendarEvent(u.target, { completed: true }); break;

      // ── Task items (right column) ─────────────────────────────────────────
      case 'add_task_item': UIUpdater.addTaskItem(u.data); break;
      case 'complete_task_item': UIUpdater.completeTaskItem(u.target); break;
      case 'remove_task_item': UIUpdater.removeTaskItem(u.target); break;
      case 'reorder_task_items': UIUpdater.reorderTaskItems(u.data); break;
      case 'update_task_item': UIUpdater.updateTaskItemEl(u.target, u.data); break;

      // ── System ────────────────────────────────────────────────────────────
      case 'update_alert': renderAlert(u.data?.alert); break;  // system_alert
      case 'update_theme': renderTheme(u.data); break;         // system_theme

      // ── Info / query results ──────────────────────────────────────────────
      case 'show_response': UIUpdater.showResponse(u.data?.text || ''); break; // info_answer from query synthesis
      // query_gmail / query_google_calendar / query_google_tasks /
      // query_ical_school / query_ical_college → no direct UI change
      // (results feed into info_answer which calls show_response)
    }
  }
}

// ── Topbar helpers ────────────────────────────────────────────────────────────

function renderAlert(alert) {
  const pill = $('#alert-pill');
  if (!pill) return;
  pill.className = `alert-pill ${alert || 'gray'}`;
  pill.textContent = (alert || 'gray').toUpperCase();
}

function renderTheme(theme) {
  const pill = $('#theme-pill');
  if (!pill || !theme) return;
  const icon = theme.icon || '';
  const name = theme.name || '';
  pill.innerHTML = `${icon ? `<span>${escHtml(icon)}</span>` : ''}<span>${escHtml(name)}</span>`;
}

function renderDate(dateStr) {
  const el = $('#topbar-date');
  if (!el || !dateStr) return;
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  el.textContent = `${days[d.getDay()]}, ${mons[d.getMonth()]} ${d.getDate()}`;
}

// ── Load and render ───────────────────────────────────────────────────────────

async function loadToday() {
  const loadingText = $('#loading-text');
  if (loadingText) loadingText.textContent = 'Loading today…';

  try {
    // 1. Auth check
    const authRes = await fetch('/api/auth-status');
    const authData = await authRes.json();
    if (!authData.authenticated) {
      show($('#auth-screen'));
      return;
    }

    // 2. Load today data
    const res = await fetch('/api/today');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    state.date = data.date;
    state.isSchoolDay = data.isSchoolDay;
    state.calendarEvents = data.calendarEvents || [];
    state.tasks = data.tasks || [];
    state.names = data.names || state.names || {};
    state.plan = hydratePlan(data.plan || null);
    state.calendarEvents = mergePlannedEvents(state.calendarEvents, state.plan);
    state.tasks = mergePlannedTasks(state.tasks, state.plan);

    // If no plan yet, trigger generation
    if (!state.plan) {
      if (loadingText) loadingText.textContent = 'Generating plan…';
      const planRes = await fetch('/api/plan');
      const planData = await planRes.json();
      if (!planData.error) {
        state.plan = hydratePlan(planData);
        state.calendarEvents = planData.calendarEvents || state.calendarEvents;
        state.tasks = planData.tasks || state.tasks;
        state.calendarEvents = mergePlannedEvents(state.calendarEvents, state.plan);
        state.tasks = mergePlannedTasks(state.tasks, state.plan);
      }
    }

    // Render
    stopLoadingCycle();
    hide($('#loading-screen'));
    show($('#view-main'));

    renderDate(state.date);
    renderAlert(state.plan?.alert || 'green');
    renderTheme(state.plan?.theme || state.plan?.themeObj);

    buildTimeGrid();
    renderCalendarEvents(state.calendarEvents);
    renderAllProjectBlocks(state.plan);
    renderAllTasks(state.tasks);

    updateNowLine();

    // Start now-line timer
    if (state.nowTimer) clearInterval(state.nowTimer);
    state.nowTimer = setInterval(updateNowLine, 60 * 1000);

    // Scroll calendar to current time
    scrollCalendarToNow();

    // Check context status for review banner
    checkContextStatus();

  } catch (err) {
    console.error('[app] loadToday failed:', err);
    stopLoadingCycle();
    hide($('#loading-screen'));
    const errScreen = $('#view-main');
    if (errScreen) show(errScreen);
    // Try to show something even on error
    buildTimeGrid();
  }
}

function scrollCalendarToNow() {
  const body = $('.col-calendar .col-body');
  if (!body) return;
  const y = nowY();
  body.scrollTop = Math.max(0, y - 100);
}

async function reloadView() {
  try {
    const res = await fetch('/api/today');
    const data = await res.json();
    if (data.error) return;

    state.date = data.date;
    state.isSchoolDay = data.isSchoolDay;
    state.calendarEvents = data.calendarEvents || [];
    state.tasks = data.tasks || [];
    state.names = data.names || state.names || {};
    if (data.plan) state.plan = hydratePlan(data.plan);
    state.calendarEvents = mergePlannedEvents(state.calendarEvents, state.plan);
    state.tasks = mergePlannedTasks(state.tasks, state.plan);

    renderDate(state.date);
    renderAlert(state.plan?.alert || 'green');
    renderTheme(state.plan?.theme || state.plan?.themeObj);
    renderCalendarEvents(state.calendarEvents);
    renderAllProjectBlocks(state.plan);
    renderAllTasks(state.tasks);
  } catch (err) {
    console.error('[app] reloadView failed:', err);
  }
}

async function regenPlan() {
  show($('#loading-screen'));
  hide($('#view-main'));
  startLoadingCycle();

  const loadingText = $('#loading-text');
  if (loadingText) loadingText.textContent = 'Generating plan…';

  try {
    const res  = await fetch('/api/plan');
    const data = await res.json();
    if (!data.error) {
      state.plan           = hydratePlan(data);
      state.calendarEvents = data.calendarEvents || state.calendarEvents;
      state.tasks          = data.tasks          || state.tasks;
      state.calendarEvents = mergePlannedEvents(state.calendarEvents, state.plan);
      state.tasks = mergePlannedTasks(state.tasks, state.plan);
    }
  } catch (err) {
    console.error('[app] regenPlan failed:', err);
  }

  stopLoadingCycle();
  hide($('#loading-screen'));
  show($('#view-main'));

  renderDate(state.date);
  renderAlert(state.plan?.alert || 'green');
  renderTheme(state.plan?.theme || state.plan?.themeObj);
  renderCalendarEvents(state.calendarEvents);
  renderAllProjectBlocks(state.plan);
  renderAllTasks(state.tasks);
}

async function checkContextStatus() {
  try {
    const res = await fetch('/api/context-status');
    const data = await res.json();
    if (data.planningReviewPending) {
      // Could show a banner — for now a console note
      console.log('[app] Planning review pending');
    }
  } catch { /* non-fatal */ }
}

// ── Chat / streaming ──────────────────────────────────────────────────────────

async function sendMessage(message) {
  if (!message.trim()) return;

  // Client-side special triggers
  const lc = message.toLowerCase().trim();
  if (lc === 'reset chat' || lc === 'start over') {
    await fetch('/api/reset-conversation', { method: 'POST' });
    UIUpdater.showResponse('Conversation reset.');
    return;
  }
  if (lc === 'end of day' || lc === 'wrap up' || lc === 'done for today') {
    openEOD();
    return;
  }
  if (/^(new task|add task):\s*/i.test(message)) {
    const text = message.replace(/^(new task|add task):\s*/i, '').trim();
    try {
      const res = await fetch('/api/tasks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, scheduledTime: 'anytime' }),
      });
      const data = await res.json();
      if (data.ok) {
        UIUpdater.addTaskItem(data.task);
        UIUpdater.showResponse(`Task added: ${text}`);
      }
    } catch (err) {
      UIUpdater.showResponse('Failed to add task.');
    }
    return;
  }

  // Clear bubble and start streaming
  const bubble = $('#response-bubble');
  const span = $('#response-text');
  if (span) span.textContent = '';
  if (bubble) { show(bubble); }

  try {
    // Enrich the plan snapshot with live calendar + task state so the
    // action engine's intent parser can see all three columns.
    const planPayload = state.plan
      ? {
        ...state.plan,
        calendarEvents: state.calendarEvents || state.plan.calendarEvents || [],
        tasks: state.tasks || state.plan.tasks || [],
      }
      : null;

    const res = await fetch('/api/message/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        view: 'main',
        plan: planPayload,
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }

        if (evt.type === 'token') {
          UIUpdater.showStreamToken(evt.token);
        } else if (evt.type === 'done') {
          UIUpdater.endStream();
          if (evt.ui_updates?.length) applyUIUpdates(evt.ui_updates);
          if (evt.triggerReplan) {
            UIUpdater.showResponse('Rebuilding plan…');
            setTimeout(regenPlan, 800);
          }
        } else if (evt.type === 'error') {
          UIUpdater.showResponse('Error: ' + evt.error);
        }
      }
    }
  } catch (err) {
    console.error('[app] sendMessage stream error:', err);
    UIUpdater.showResponse('Connection error.');
  }
}

// ── EOD popup ─────────────────────────────────────────────────────────────────

function openEOD() {
  const overlay = $('#eod-overlay');
  if (!overlay) return;

  // Build progress bars for all plan tasks
  const allTasks = [
    ...(state.plan?.blocks?.morning || []),
    ...(state.plan?.blocks?.afternoon || []),
    ...(state.plan?.blocks?.evening || []),
  ];

  const barsEl = $('#eod-progress-bars');
  if (barsEl) {
    barsEl.innerHTML = '';
    state.eodBars = {};

    for (const task of allTasks) {
      state.eodBars[task.id] = 50; // default 50%
      barsEl.appendChild(buildProgressBar(task));
    }
  }

  // Reset emoji selection and journal
  const eodJournal = $('#eod-journal');
  if (eodJournal) eodJournal.value = '';
  state.eodRating = null;
  $$('.eod-emoji').forEach((btn) => btn.classList.remove('selected'));

  hide($('#eod-close-progress'));
  show(overlay);
}

function closeEOD() {
  hide($('#eod-overlay'));
}

function buildProgressBar(task) {
  const row = document.createElement('div');
  row.className = 'eod-progress-row';
  row.dataset.taskId = task.id;

  const pct = 50;

  row.innerHTML = `
    <div class="eod-progress-name">
      ${renderPips(task.rank || task.rankNumber)}
      <span>${escHtml(task.name)}</span>
    </div>
    <div class="eod-bar-wrap" data-task="${escAttr(task.id)}">
      <div class="eod-bar-fill" style="width:${pct}%;background:${barColor(pct)}"></div>
      <div class="eod-bar-midline"></div>
      <div class="eod-bar-label-step">step done</div>
      <div class="eod-bar-label-done">task done</div>
    </div>
    <div class="eod-bar-hint">${barHint(pct)}</div>
  `;

  // Drag interaction
  const wrap = $('.eod-bar-wrap', row);
  attachBarDrag(wrap, task.id);

  return row;
}

function barColor(pct) {
  if (pct >= 95) return '#1a4a1a';
  if (pct >= 48) return '#1a5a4a';
  return '#1a4a70';
}

function barHint(pct) {
  if (pct === 0) return 'Nothing done today';
  if (pct <= 24) return 'Barely started';
  if (pct <= 47) return 'Partial progress — didn\'t finish the step';
  if (pct <= 52) return 'Step completed';
  if (pct <= 74) return 'Step completed — good work';
  if (pct <= 94) return 'Step done and went further';
  return 'Task fully complete!';
}

function attachBarDrag(wrap, taskId) {
  function setFromX(clientX) {
    const rect = wrap.getBoundingClientRect();
    let raw = (clientX - rect.left) / rect.width * 100;
    raw = Math.max(0, Math.min(100, raw));
    // Snap to 0, 50, 100 if within 5%
    if (raw <= 5) raw = 0;
    else if (raw >= 95) raw = 100;
    else if (Math.abs(raw - 50) <= 5) raw = 50;

    state.eodBars[taskId] = Math.round(raw);
    updateBar(wrap, Math.round(raw));
  }

  let dragging = false;

  wrap.addEventListener('mousedown', (e) => {
    dragging = true;
    setFromX(e.clientX);
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    setFromX(e.clientX);
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  // Touch
  wrap.addEventListener('touchstart', (e) => {
    setFromX(e.touches[0].clientX);
    e.preventDefault();
  }, { passive: false });
  wrap.addEventListener('touchmove', (e) => {
    setFromX(e.touches[0].clientX);
    e.preventDefault();
  }, { passive: false });
}

function updateBar(wrap, pct) {
  const fill = $('.eod-bar-fill', wrap);
  const hint = wrap.parentElement?.querySelector('.eod-bar-hint');
  if (fill) {
    fill.style.width = pct + '%';
    fill.style.background = barColor(pct);
  }
  if (hint) hint.textContent = barHint(pct);
}

async function submitEOD() {
  const journal = $('#eod-journal')?.value || '';
  const rating = state.eodRating;

  const taskProgress = Object.entries(state.eodBars).map(([taskId, progressPct]) => {
    const task = [
      ...(state.plan?.blocks?.morning || []),
      ...(state.plan?.blocks?.afternoon || []),
      ...(state.plan?.blocks?.evening || []),
    ].find((t) => t.id === taskId);
    return {
      taskId,
      progressPct,
      taskName: task?.name || taskId,
      interpretation: barHint(progressPct),
    };
  });

  // Switch to progress view
  const submitBtn = $('#eod-submit');
  if (submitBtn) submitBtn.disabled = true;

  const progressEl = $('#eod-close-progress');
  if (progressEl) {
    progressEl.innerHTML = '';
    show(progressEl);
  }

  function addStep(label, status) {
    if (!progressEl) return;
    const line = document.createElement('div');
    line.className = `eod-step-line ${status}`;
    const icon = status === 'done' ? '✓' : status === 'error' ? '✗' : '…';
    line.innerHTML = `<span>${icon}</span> ${escHtml(label)}`;
    progressEl.appendChild(line);
  }

  try {
    const res = await fetch('/api/journal/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, entry: journal, taskProgress }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }

        if (evt.step) {
          addStep(evt.label, evt.status);
        }
        if (evt.complete) {
          if (!evt.error) {
            addStep('Good night, Admiral.', 'done');
            // Now run /api/close-day, then advance date for next-day testing
            runCloseDay(addStep).then(async () => {
              // Advance the simulated date by 1 day
              try {
                const advRes = await fetch('/api/advance-day', { method: 'POST' });
                const advData = await advRes.json();
                if (advData.ok) {
                  addStep(`Date advanced → ${advData.date}`, 'done');
                }
              } catch (e) {
                console.warn('[EOD] advance-day failed:', e.message);
              }
              setTimeout(() => {
                closeEOD();
                // Full page reload so plan regenerates for the new date
                window.location.reload();
              }, 1800);
            });
          } else {
            addStep('Error: ' + evt.error, 'error');
          }
        }
      }
    }
  } catch (err) {
    addStep('Connection error: ' + err.message, 'error');
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function runCloseDay(addStep) {
  try {
    const res = await fetch('/api/close-day', { method: 'POST' });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }

        if (evt.label) {
          addStep(evt.label, evt.status === 'done' ? 'done' : evt.status === 'error' ? 'error' : 'running');
        }
        if (evt.complete) {
          if (evt.message) addStep(evt.message, 'done');
        }
      }
    }
  } catch (err) {
    addStep('Close day error: ' + err.message, 'error');
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return escHtml(str).replace(/'/g, '&#39;');
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  // Chat input
  const input = $('#chat-input');
  const sendBtn = $('#send-btn');

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const msg = input.value.trim();
      if (msg) { input.value = ''; sendMessage(msg); }
    }
  });
  sendBtn?.addEventListener('click', () => {
    const msg = input?.value.trim();
    if (msg) { if (input) input.value = ''; sendMessage(msg); }
  });

  // EOD button
  $('#eod-btn')?.addEventListener('click', openEOD);
  $('#eod-cancel')?.addEventListener('click', closeEOD);
  $('#eod-submit')?.addEventListener('click', submitEOD);

  // EOD emoji
  $$('.eod-emoji').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.eod-emoji').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.eodRating = parseInt(btn.dataset.rating, 10);
    });
  });

  // Detail close
  $('#detail-close')?.addEventListener('click', closeDetail);
  $('#editor-close')?.addEventListener('click', closeEditorModal);
  $('#editor-cancel-btn')?.addEventListener('click', closeEditorModal);
  $('#editor-save-btn')?.addEventListener('click', () => {
    if (!state.editor) return;
    syncPlanFromEditor(state.editor.kind);
    openEditorReason();
  });
  $('#editor-reason-cancel')?.addEventListener('click', closeEditorReason);
  $('#editor-reason-save')?.addEventListener('click', submitEditorSave);

  $$('.col-edit-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await openColumnEditor(btn.dataset.editorKind);
      } catch (err) {
        console.error('[editor] open failed:', err);
        UIUpdater.showResponse('Could not open editor.');
      }
    });
  });

  $('#editor-content')?.addEventListener('input', (e) => {
    const target = e.target;
    if (target?.dataset?.editorKind) updateEditorField(target);
  });
  $('#editor-content')?.addEventListener('change', (e) => {
    const target = e.target;
    if (target?.dataset?.editorKind) updateEditorField(target);
  });
  $('#editor-content')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-editor-action]');
    if (!btn || !state.editor) return;
    const kind = btn.dataset.kind;
    const index = Number(btn.dataset.index);
    const action = btn.dataset.editorAction;
    if (action === 'move-up') moveEditorRow(kind, index, -1);
    if (action === 'move-down') moveEditorRow(kind, index, 1);
    if (action === 'delete-row') markEditorRowDeleted(kind, index);
    if (action === 'add-row') {
      state.editor[kind].push(makeNewEditorRow(kind));
      renderEditorModal();
    }
  });

  // Plan Date Previews
  const dateBtn = $('#plan-date-btn');
  const datePicker = $('#plan-date-picker');
  const regenBtn = $('#plan-regen-btn');
  const returnBtn = $('#plan-return-btn');

  dateBtn?.addEventListener('click', () => {
    dateBtn.classList.add('hidden');
    datePicker.classList.remove('hidden');
    datePicker.focus();
  });

  datePicker?.addEventListener('change', async (e) => {
    const val = e.target.value; // YYYY-MM-DD
    if (!val) return;
    datePicker.classList.add('hidden');

    const todayStr = new Date().toLocaleDateString('sv-SE');
    if (val === todayStr) {
      returnBtn.classList.add('hidden');
      dateBtn.classList.remove('hidden');
      await reloadView();
      return;
    }

    returnBtn.classList.remove('hidden');
    const loadingText = $('#loading-text');
    if (loadingText) loadingText.textContent = `Generating preview for ${val}…`;
    show($('#loading-screen'));
    hide($('#view-main'));
    startLoadingCycle();

    try {
      const res = await fetch(`/api/plan?date=${val}`);
      const data = await res.json();

      state.date = data.date;
      state.isSchoolDay = data.isSchoolDay;
      state.calendarEvents = data.calendarEvents || [];
      state.tasks = data.tasks || [];
      state.plan = hydratePlan(data);
      state.calendarEvents = mergePlannedEvents(state.calendarEvents, state.plan);
      state.tasks = mergePlannedTasks(state.tasks, state.plan);

      stopLoadingCycle();
      hide($('#loading-screen'));
      show($('#view-main'));

      renderDate(state.date);
      renderAlert(state.plan?.alert || 'green');
      renderTheme(state.plan?.theme || state.plan?.themeObj);
      renderCalendarEvents(state.calendarEvents);
      renderAllProjectBlocks(state.plan);
      renderAllTasks(state.tasks);
    } catch (err) {
      console.error('[app] plan preview failed:', err);
    }
  });

  returnBtn?.addEventListener('click', async () => {
    returnBtn.classList.add('hidden');
    dateBtn.classList.remove('hidden');
    datePicker.value = '';

    const loadingText = $('#loading-text');
    if (loadingText) loadingText.textContent = 'Returning to today…';
    show($('#loading-screen'));
    hide($('#view-main'));
    startLoadingCycle();

    await reloadView();

    stopLoadingCycle();
    hide($('#loading-screen'));
    show($('#view-main'));
  });

  regenBtn?.addEventListener('click', async () => {
    const viewingPreview = !returnBtn?.classList.contains('hidden');
    if (viewingPreview) {
      returnBtn.classList.add('hidden');
      dateBtn.classList.remove('hidden');
      datePicker.value = '';
    }
    await regenPlan();
  });

  // Click outside detail panel to close
  document.addEventListener('click', (e) => {
    const panel = $('#detail-panel');
    if (!panel || panel.classList.contains('detail-hidden')) return;
    if (!panel.contains(e.target) &&
      !e.target.closest('.cal-event') &&
      !e.target.closest('.project-card') &&
      !e.target.closest('.task-item')) {
      closeDetail();
    }
  });

  // Dismiss response bubble on next input
  input?.addEventListener('focus', () => {
    hide($('#response-bubble'));
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initStarfield();
  wireEvents();

  // Show loading, then load
  show($('#loading-screen'));
  hide($('#view-main'));
  hide($('#auth-screen'));
  startLoadingCycle();

  loadToday();
});
