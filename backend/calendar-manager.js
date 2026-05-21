/**
 * calendar-manager.js
 * Manages context/calendar_events.json.
 *
 * Event schema:
 *   id            string   — unique identifier
 *   date          string?  — YYYY-MM-DD (one-time events only)
 *   recurring     string?  — "daily" | "MON-FRI" | "MON,WED,FRI" | "WEEKLY:FRI" | "MONTHLY:15" | null
 *   time_start    string?  — "HH:MM" start time | null
 *   time_end      string?  — "HH:MM" end time | null
 *   strict_timing boolean  — true = fixed time (AI must not change it); false = AI may adjust
 *   ai_notes      string   — AI-generated notes
 *   completed     boolean
 *   exceptions    string[] — YYYY-MM-DD dates to skip (recurring events)
 *
 * Names live in context/names.json, keyed by id.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { getNameLabel, getNameType, setNameEntry } = require('./names-registry');

const STORE_PATH = path.join(__dirname, '../context/calendar_events.json');
const NAMES_PATH = path.join(__dirname, '../context/names.json');

const DOW_MAP = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 0 };

// ── Recurring helpers ─────────────────────────────────────────────────────────

function matchesRecurring(event, dateStr) {
  if (!event.recurring) return false;
  const d   = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun…6=Sat
  const rule = event.recurring.toUpperCase();

  if (rule === 'DAILY')   return true;
  if (rule === 'MON-FRI') return dow >= 1 && dow <= 5;

  if (/^[A-Z]+(,[A-Z]+)*$/.test(rule)) {
    const days = rule.split(',').map((s) => DOW_MAP[s]);
    return days.includes(dow);
  }

  const weekly = rule.match(/^WEEKLY:([A-Z]+)$/);
  if (weekly) return DOW_MAP[weekly[1]] === dow;

  const monthly = rule.match(/^MONTHLY:(\d+)$/);
  if (monthly) return d.getDate() === parseInt(monthly[1], 10);

  return false;
}

// ── Store helpers ─────────────────────────────────────────────────────────────

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch { return { events: [] }; }
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

function readNames() {
  try { return JSON.parse(fs.readFileSync(NAMES_PATH, 'utf8')); } catch { return {}; }
}

function writeNames(names) {
  fs.writeFileSync(NAMES_PATH, JSON.stringify(names, null, 2) + '\n', 'utf8');
}

// ── ID generator ──────────────────────────────────────────────────────────────

function makeId(name, existing) {
  const names = readNames();
  const base = (name || 'event')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .slice(0, 4)
    .join('-');
  let id = base || 'event-' + Date.now().toString(36);
  let n  = 1;
  while (existing.some((e) => e.id === id) || names[id]) id = `${base}-${n++}`;
  return id;
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Returns events active on `dateStr`.
 * Includes name from names.json for frontend display.
 */
async function loadTodayEvents(dateStr) {
  const store = readStore();
  const names = readNames();

  return store.events
    .filter((ev) => {
      if (ev.completed) return false;
      if (ev.recurring) {
        if ((ev.exceptions || []).includes(dateStr)) return false;
        return matchesRecurring(ev, dateStr);
      }
      return ev.date === dateStr;
    })
    .map((ev) => ({ ...ev, name: getNameLabel(names, ev.id, ev.id) }));
}

function loadAllEvents() {
  const store = readStore();
  const names = readNames();
  return (store.events || []).map((ev) => ({ ...ev, name: getNameLabel(names, ev.id, ev.id) }));
}

function replaceAllEvents(events) {
  writeStore({ events: Array.isArray(events) ? events : [] });
  return loadAllEvents();
}

/** Add a new event. name goes to names.json. */
function addEvent(data) {
  const store = readStore();
  const names = readNames();
  const id    = data.id || makeId(data.name, store.events);

  if (names[id] && getNameType(names, id, null) !== 'event') {
    throw new Error(`ID '${id}' already exists as a different item type`);
  }

  const event = {
    id,
    date:          data.date          || null,
    recurring:     data.recurring     || null,
    time_start:    data.time_start    || null,
    time_end:      data.time_end      || null,
    strict_timing: Boolean(data.strict_timing),
    ai_notes:      data.ai_notes      || '',
    completed:     false,
    exceptions:    [],
  };

  store.events.push(event);
  writeStore(store);

  if (data.name) { setNameEntry(names, id, data.name, 'event'); writeNames(names); }

  return { ...event, name: getNameLabel(names, id, id) };
}

/** Patch event fields. */
function updateEvent(id, changes) {
  const store = readStore();
  const names = readNames();
  const event = store.events.find((e) => e.id === id);
  if (!event) throw new Error(`Event '${id}' not found`);

  if (changes.name !== undefined) {
    setNameEntry(names, id, changes.name, 'event');
    writeNames(names);
    delete changes.name;
  }

  Object.assign(event, changes);
  writeStore(store);
  return { ...event, name: getNameLabel(names, id, id) };
}

/** Remove event and its name. */
function deleteEvent(id) {
  const store = readStore();
  const names = readNames();
  const idx   = store.events.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error(`Event '${id}' not found`);
  store.events.splice(idx, 1);
  writeStore(store);
  delete names[id];
  writeNames(names);
  return { deleted: id };
}

/** Mark event completed. */
function archiveEvent(id) {
  return updateEvent(id, { completed: true });
}

/** Add a skip date to a recurring event. */
function addException(id, dateStr) {
  const store = readStore();
  const event = store.events.find((e) => e.id === id);
  if (!event) throw new Error(`Event '${id}' not found`);
  if (!event.exceptions) event.exceptions = [];
  if (!event.exceptions.includes(dateStr)) event.exceptions.push(dateStr);
  writeStore(store);
  return event;
}

/** Reorder events by id array. */
function reorderEvents(orderedIds) {
  const store = readStore();
  const pos   = {};
  orderedIds.forEach((id, i) => { pos[id] = i; });
  store.events.sort((a, b) => (pos[a.id] ?? Infinity) - (pos[b.id] ?? Infinity));
  writeStore(store);
  return store.events;
}

module.exports = {
  loadTodayEvents,
  loadAllEvents,
  addEvent,
  updateEvent,
  deleteEvent,
  archiveEvent,
  addException,
  reorderEvents,
  replaceAllEvents,
  readStore,
  writeStore,
  readNames,
  writeNames,
};
