'use strict';

const fs = require('fs');
const path = require('path');
const calendarManager = require('./calendar-manager');
const tasksManager = require('./tasks-manager');

const CONTEXT_DIR          = path.join(__dirname, '../context');
const CALENDAR_EVENTS_PATH = path.join(CONTEXT_DIR, 'calendar_events.json');

async function runDailyReset(today) {
  console.log(`[daily-reset] Running for ${today}`);

  try {
    let store = { events: [], last_synced: null };
    if (fs.existsSync(CALENDAR_EVENTS_PATH)) {
      store = JSON.parse(fs.readFileSync(CALENDAR_EVENTS_PATH, 'utf8'));
    }

    const originalLen = store.events.length;
    store.events = store.events.filter(ev => {
      if (ev.type !== 'single') return true;
      if (!ev.date) return true;
      return ev.date >= today;
    });

    if (store.events.length < originalLen) {
      console.log(`[daily-reset] Pruned ${originalLen - store.events.length} stale single events`);
      fs.writeFileSync(CALENDAR_EVENTS_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
    }

    const todayEvents = await calendarManager.loadTodayEvents(today);
    writeCalendarSnapshot(today, todayEvents);

    store = JSON.parse(fs.readFileSync(CALENDAR_EVENTS_PATH, 'utf8'));
    store.last_synced = new Date().toISOString();
    fs.writeFileSync(CALENDAR_EVENTS_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');

    seedDailyFlowFile(today, todayEvents);

    console.log(`[daily-reset] Success for ${today}`);
    return { success: true, eventsCount: todayEvents.length };
  } catch (err) {
    console.error('[daily-reset] Error:', err.message);
    return { success: false, error: err.message };
  }
}

function writeCalendarSnapshot(today, events) {
  const calDir  = path.join(CONTEXT_DIR, 'calendar');
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
      const checked  = t.completed ? '[x]' : '[ ]';
      const flags    = [];
      if (t.urgent)        flags.push('[urgent]');
      if (t.scheduledTime) flags.push(`[${t.scheduledTime}]`);
      md += `- ${checked} ${t.text}${flags.length ? ' ' + flags.join(' ') : ''}\n`;
    });
  }

  const existing = fs.existsSync(calFile) ? fs.readFileSync(calFile, 'utf8') : '';
  if (existing !== md) fs.writeFileSync(calFile, md, 'utf8');
}

function seedDailyFlowFile(today, events) {
  const dailyPath = path.join(CONTEXT_DIR, 'daily', `${today}.md`);
  let content = fs.existsSync(dailyPath)
    ? fs.readFileSync(dailyPath, 'utf8')
    : `# Daily Log — ${today}\n\n`;

  if (!content.includes('## Flow')) {
    let flowStr = '\n## Flow\n';
    if (events.length === 0) {
      flowStr += '- [Open Day]\n';
    } else {
      events.forEach(ev => {
        flowStr += `- [ ] ${ev.startTime || 'All Day'} - ${ev.title}\n`;
      });
    }
    fs.writeFileSync(dailyPath, content + flowStr, 'utf8');
  }
}

module.exports = { runDailyReset };
