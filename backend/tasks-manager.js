/**
 * tasks-manager.js
 * Manages context/tasks.json — master list of small daily tasks.
 *
 * Task schema:
 *   id        string   — auto-generated kebab-case slug
 *   desc      string   — task description
 *   recurring string?  — "daily" | "weekly" | "MON-FRI" | null
 *   deadline  string?  — YYYY-MM-DD | null
 *   ai_notes  string   — AI-generated notes (empty by default)
 *   completed boolean
 *
 * Names live in context/names.json, keyed by id.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { getNameType, setNameEntry } = require('./names-registry');

const TASKS_PATH = path.join(__dirname, '../context/tasks.json');
const NAMES_PATH = path.join(__dirname, '../context/names.json');

// ── Store helpers ─────────────────────────────────────────────────────────────

function readStore() {
  try { return JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8')); } catch { return { tasks: [] }; }
}

function writeStore(store) {
  fs.writeFileSync(TASKS_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

function readNames() {
  try { return JSON.parse(fs.readFileSync(NAMES_PATH, 'utf8')); } catch { return {}; }
}

function writeNames(names) {
  fs.writeFileSync(NAMES_PATH, JSON.stringify(names, null, 2) + '\n', 'utf8');
}

// ── ID generator ──────────────────────────────────────────────────────────────

function makeId(desc, existing) {
  const names = readNames();
  const base = (desc || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .slice(0, 5)
    .join('-');
  let id = base;
  let n  = 1;
  while (existing.some((t) => t.id === id) || names[id]) id = `${base}-${n++}`;
  return id;
}

// ── Exports ───────────────────────────────────────────────────────────────────

/** Returns all tasks. */
function loadAllTasks() {
  return readStore().tasks;
}

function replaceAllTasks(tasks) {
  writeStore({ tasks: Array.isArray(tasks) ? tasks : [] });
  return loadAllTasks();
}

/** Returns incomplete tasks (optionally filtered by date or recurring). */
function loadTodayTasks() {
  return readStore().tasks.filter((t) => !t.completed);
}

/**
 * Add a new task.
 * @param {{ name: string, desc?: string, recurring?: string, deadline?: string }} data
 */
function addTask(data) {
  const store = readStore();
  const id    = makeId(data.desc || data.name || 'task', store.tasks);
  const names = readNames();

  if (names[id] && getNameType(names, id, null) !== 'task') {
    throw new Error(`ID '${id}' already exists as a different item type`);
  }

  const task = {
    id,
    desc:      data.desc      || data.name || '',
    recurring: data.recurring || null,
    deadline:  data.deadline  || null,
    ai_notes:  data.ai_notes  || '',
    completed: false,
  };

  store.tasks.push(task);
  writeStore(store);

  // Save name to names.json if provided
  if (data.name) {
    setNameEntry(names, id, data.name, 'task');
    writeNames(names);
  }

  return task;
}

/** Mark a task complete. */
function completeTask(id) {
  const store = readStore();
  const task  = store.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task '${id}' not found`);
  task.completed = true;
  writeStore(store);
  return task;
}

/** Delete a task from the store and names.json. */
function deleteTask(id) {
  const store = readStore();
  const idx   = store.tasks.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error(`Task '${id}' not found`);
  store.tasks.splice(idx, 1);
  writeStore(store);

  const names = readNames();
  delete names[id];
  writeNames(names);

  return { deleted: id };
}

/** Patch task fields. */
function updateTask(id, changes) {
  const store = readStore();
  const task  = store.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task '${id}' not found`);
  Object.assign(task, changes);
  writeStore(store);

  // If name is in changes, update names.json
  if (changes.name !== undefined) {
    const names = readNames();
    setNameEntry(names, id, changes.name, 'task');
    writeNames(names);
  }

  return task;
}

module.exports = {
  loadAllTasks,
  loadTodayTasks,
  addTask,
  completeTask,
  deleteTask,
  updateTask,
  replaceAllTasks,
  readStore,
  writeStore,
  readNames,
  writeNames,
};
