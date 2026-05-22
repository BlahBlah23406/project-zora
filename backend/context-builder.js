'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { readMemoryLog, writeMemoryLog } = require('./memory');
const { loadAllTasks }                  = require('./task-loader');

const CONTEXT_DIR = path.join(__dirname, '../context');
const MASTER_PATH = path.join(CONTEXT_DIR, 'long_term/master_context.md');

// master_context.md is retired — all planning context now comes from process_protocols.md.
// buildMasterContext() is a no-op kept so call sites don't break.
async function buildMasterContext() {
  console.log('[context-builder] buildMasterContext skipped — master_context is retired');
  return '';
}

function getCachedMasterContext() {
  if (!fs.existsSync(MASTER_PATH)) return null;

  const log       = readMemoryLog();
  const lastBuilt = log.master_context_last_built;
  if (!lastBuilt) return null;

  const today = new Date().toLocaleDateString('en-CA');
  if (!lastBuilt.startsWith(today)) return null;

  try { return fs.readFileSync(MASTER_PATH, 'utf8'); }
  catch { return null; }
}

module.exports = { buildMasterContext, getCachedMasterContext };
