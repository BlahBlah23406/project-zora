/**
 * daily-reset.js
 * Handles the daily calendar/flow reset pathway:
 * 1. Prunes stale `calendar_events.json` daily events
 * 2. Fetches today's events via calendarManager
 * 3. Writes `context/calendar/YYYY-MM-DD.md` snapshot
 * 4. Updates `last_synced` in calendar_events.json
 * 5. Seeds `context/daily/YYYY-MM-DD.md` flow if missing
 */

'use strict';

const fs = require('fs');
const path = require('path');
const calendarManager = require('./calendar-manager');
const tasksManager = require('./tasks-manager');

const CONTEXT_DIR = path.join(__dirname, '../context');
const CALENDAR_EVENTS_PATH = path.join(CONTEXT_DIR, 'calendar_events.json');

/**
 * Runs the daily reset pathway.
 * Designed to be idempotent if run multiple times a day.
 */
async function runDailyReset(today) {
  console.log(`[daily-reset] Running for ${today}`);

  try {
    let store = { events: [], last_synced: null };
    if (fs.existsSync(CALENDAR_EVENTS_PATH)) {
      store = JSON.parse(fs.readFileSync(CALENDAR_EVENTS_PATH, 'utf8'));
    }

    // 1. Prune stale flat events (type: 'single' and past their date)
    const originalLen = store.events.length;
    store.events = store.events.filter(ev => {
      // Keep recurring/external/adjacent rules, or single events for today or future
      if (ev.type !== 'single') return true;
      if (!ev.date) return true; // keep if no date
      return ev.date >= today;
    });

    if (store.events.length < originalLen) {
      console.log(`[daily-reset] Pruned ${originalLen - store.events.length} stale single events`);
      fs.writeFileSync(CALENDAR_EVENTS_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
    }

    // 2. Load today's events (this fetches external APIs and injects them into the store cleanly)
    const todayEvents = await calendarManager.loadTodayEvents(today);

    // 3. Write `context/calendar/YYYY-MM-DD.md` snapshot
    writeCalendarSnapshot(today, todayEvents);

    // 4. Update last_synced
    store = JSON.parse(fs.readFileSync(CALENDAR_EVENTS_PATH, 'utf8')); // reload after calendarManager mutations
    store.last_synced = new Date().toISOString();
    fs.writeFileSync(CALENDAR_EVENTS_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');

    // 5. Seed `context/daily/YYYY-MM-DD.md` flow if missing
    seedDailyFlowFile(today, todayEvents);

    console.log(`[daily-reset] Success for ${today}`);
    return { success: true, eventsCount: todayEvents.length };
  } catch (err) {
    console.error('[daily-reset] Error:', err.message);
    return { success: false, error: err.message };
  }
}

function writeCalendarSnapshot(today, events) {
  const calDir = path.join(CONTEXT_DIR, 'calendar');
  if (!fs.existsSync(calDir)) fs.mkdirSync(calDir, { recursive: true });

  const calFile = path.join(calDir, `${today}.md`);

  let md = `# Calendar — ${today}\n\n## Events\n`;
  if (events.length === 0) {
    md += '- *(No events scheduled)*\n';
  } else {
    events.forEach(ev => {
      const time = ev.startTime && ev.endTime ? `${ev.startTime}–${ev.endTime}` : (ev.startTime || 'All Day');
      md += `- ${time}  ${ev.title} (${ev.type === 'recurring' ? 'recurring' : ev.source})\n`;
    });
  }

  md += `\n## Tasks\n`;
  const tasks = tasksManager.loadTodayTasks(today);
  if (tasks.length === 0) {
    md += '- *(No tasks scheduled)*\n';
  } else {
    tasks.forEach(t => {
      const checked = t.completed ? '[x]' : '[ ]';
      const flags = [];
      if (t.urgent) flags.push('[urgent]');
      if (t.scheduledTime) flags.push(`[${t.scheduledTime}]`);
      const flagsStr = flags.length > 0 ? ` ${flags.join(' ')}` : '';
      md += `- ${checked} ${t.text}${flagsStr}\n`;
    });
  }

  // Only rewrite if changed (idempotent write) to avoid unnecessary file thrashing
  let existing = '';
  if (fs.existsSync(calFile)) {
    existing = fs.readFileSync(calFile, 'utf8');
  }
  if (existing !== md) {
    fs.writeFileSync(calFile, md, 'utf8');
  }
}

function seedDailyFlowFile(today, events) {
  const dailyPath = path.join(CONTEXT_DIR, 'daily', `${today}.md`);
  let content = '';

  if (fs.existsSync(dailyPath)) {
    content = fs.readFileSync(dailyPath, 'utf8');
  } else {
    content = `# Daily Log — ${today}\n\n`;
  }

  if (!content.includes('## Flow')) {
    let flowStr = '\n## Flow\n';
    if (events.length === 0) {
      flowStr += '- [Open Day]\n';
    } else {
      events.forEach(ev => {
        const time = ev.startTime || 'All Day';
        flowStr += `- [ ] ${time} - ${ev.title}\n`;
      });
    }
    content += flowStr;
    fs.writeFileSync(dailyPath, content, 'utf8');
  }
}

module.exports = { runDailyReset };
