'use strict';

/**
 * task-loader.js
 * Reads from context/projects.json.
 *
 * Project schema:
 *   id             string   — unique identifier
 *   steps          string[] — ordered list of steps
 *   current_step   number   — index of current step (0-based)
 *   deadline       string?  — YYYY-MM-DD | null
 *   priority_rank  number   — lower = higher priority
 *   ai_notes       string   — AI-generated notes
 *
 * Names live in context/names.json, keyed by id.
 *
 * loadAllTasks()             — active + new projects
 * loadAllTasksIncludingAll() — all projects regardless of folder
 * loadTaskById(id)           — single project
 * readProjects()             — raw store
 */

const fs   = require('fs');
const path = require('path');
const { getNameLabel, getNameType, setNameEntry } = require('./names-registry');

const PROJECTS_PATH = path.join(__dirname, '../context/projects.json');
const NAMES_PATH    = path.join(__dirname, '../context/names.json');

function readProjects() {
  if (!fs.existsSync(PROJECTS_PATH)) return { projects: [] };
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf8'));
  } catch (err) {
    console.error('[task-loader] Failed to parse projects.json:', err.message);
    return { projects: [] };
  }
}

function readNames() {
  try { return JSON.parse(fs.readFileSync(NAMES_PATH, 'utf8')); } catch { return {}; }
}

function writeProjects(store) {
  fs.writeFileSync(PROJECTS_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

function writeNames(names) {
  fs.writeFileSync(NAMES_PATH, JSON.stringify(names, null, 2) + '\n', 'utf8');
}

function hydrate(p, names) {
  names = names || {};
  return {
    id:            p.id            || '',
    name:          getNameLabel(names, p.id, p.id),   // frontend display only
    steps:         p.steps         || [],
    current_step:  p.current_step  ?? 0,
    deadline:      p.deadline      || null,
    priority_rank: p.priority_rank ?? 99,
    ai_notes:      p.ai_notes      || '',
    folder:        p.folder        || 'active',
    status:        p.status        || 'active',
    // Legacy compat fields used by planner block hydration
    rank:          p.priority_rank ?? 99,
    rankLabel:     p.priority_rank ? `Rank ${p.priority_rank}` : '',
    estimatedMinutes: p.estimatedMinutes || 60,
    objective:     p.objective || (p.steps && p.steps[0]) || '',
    todayStep:     p.todayStep || (p.steps && p.steps[p.current_step ?? 0]) || '',
  };
}

function loadAllTasks() {
  const store = readProjects();
  const names = readNames();
  return (store.projects || [])
    .filter((p) => !p.folder || p.folder === 'active' || p.folder === 'new')
    .map((p) => hydrate(p, names));
}

function loadAllTasksIncludingAll() {
  const store = readProjects();
  const names = readNames();
  return (store.projects || []).map((p) => hydrate(p, names));
}

function loadTaskById(id) {
  const store = readProjects();
  const names = readNames();
  const p     = (store.projects || []).find((p) => p.id === id);
  return p ? hydrate(p, names) : null;
}

/** Add a new project. name goes to names.json, data to projects.json. */
function addProject(data) {
  const store = readProjects();
  const names = readNames();

  // Auto-generate id from name if not provided
  let id = data.id;
  if (!id) {
    const base = (data.name || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 5)
      .join('-');
    let n = 1;
    id = base;
    while (store.projects.some((p) => p.id === id) || names[id]) id = `${base}-${n++}`;
  }

  if (names[id] && getNameType(names, id, null) !== 'project') {
    throw new Error(`Project ID '${id}' already exists as a different item type`);
  }

  const project = {
    id,
    steps:         data.steps         || [],
    current_step:  data.current_step  ?? 0,
    deadline:      data.deadline      || null,
    priority_rank: data.priority_rank ?? 99,
    ai_notes:      data.ai_notes      || '',
    folder:        data.folder        || 'active',
    status:        data.status        || 'active',
  };

  store.projects.push(project);
  writeProjects(store);

  if (data.name) {
    setNameEntry(names, id, data.name, 'project');
    writeNames(names);
  }

  return hydrate(project, names);
}

/** Update project fields. If changes.name provided, updates names.json. */
function updateProject(id, changes) {
  const store = readProjects();
  const names = readNames();

  const project = store.projects.find((p) => p.id === id);
  if (!project) throw new Error(`Project '${id}' not found`);

  if (changes.name !== undefined) {
    setNameEntry(names, id, changes.name, 'project');
    writeNames(names);
    delete changes.name;
  }

  Object.assign(project, changes);
  writeProjects(store);
  return hydrate(project, names);
}

/** Delete a project and its name. */
function deleteProject(id) {
  const store = readProjects();
  const names = readNames();
  const idx   = store.projects.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Project '${id}' not found`);
  store.projects.splice(idx, 1);
  writeProjects(store);
  delete names[id];
  writeNames(names);
  return { deleted: id };
}

module.exports = {
  loadAllTasks,
  loadAllTasksIncludingAll,
  loadTaskById,
  addProject,
  updateProject,
  deleteProject,
  readProjects,
  writeProjects,
  readNames,
  writeNames,
};
