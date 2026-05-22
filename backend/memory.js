'use strict';

const fs   = require('fs');
const path = require('path');

const WHITEBOARD_PATH = path.join(__dirname, '../context/daily_planner.json');

function getToday() {
  return new Date().toLocaleDateString('sv-SE');
}

function readWhiteboard() {
  try { return JSON.parse(fs.readFileSync(WHITEBOARD_PATH, 'utf8')); }
  catch { return {}; }
}

function updateWhiteboard(updates) {
  const merged = { ...readWhiteboard(), ...updates, lastUpdated: new Date().toISOString() };
  fs.writeFileSync(WHITEBOARD_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

function setWhiteboard(data) {
  const full = { ...data, lastUpdated: new Date().toISOString() };
  fs.writeFileSync(WHITEBOARD_PATH, JSON.stringify(full, null, 2) + '\n', 'utf8');
  return full;
}

// Stubs kept for call-site compatibility
function readMemoryLog()        { return {}; }
function writeMemoryLog()       { /* no-op */ }
function appendMemoryEntry()    { /* no-op */ }
function recordTaskProgress()   { /* no-op */ }
function advanceSimulatedDate() { return getToday(); }
function resetSimulatedDate()   { /* no-op */ }
function appendToDailyLog()     { /* no-op */ }

module.exports = {
  getToday,
  readWhiteboard,
  updateWhiteboard,
  setWhiteboard,
  readMemoryLog,
  writeMemoryLog,
  appendMemoryEntry,
  recordTaskProgress,
  advanceSimulatedDate,
  resetSimulatedDate,
  appendToDailyLog,
};
