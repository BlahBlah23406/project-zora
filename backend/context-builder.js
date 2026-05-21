/**
 * context-builder.js
 * Builds /context/master_context.md — a token-efficient file (<800 tokens)
 * that is the primary context Gemma reads on every planning prompt.
 *
 * buildMasterContext():
 *   1. Read specific context files (selectively filtered)
 *   2. Send to Gemma with compression prompt
 *   3. Write result to context/master_context.md
 *   4. Update master_context_last_built in memory_log.json
 *   5. Return the content string
 *
 * getCachedMasterContext():
 *   Returns master_context.md if built today (checks memory_log timestamp), else null.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { generate, OLLAMA_MODEL } = require('./ollama');
const { readMemoryLog, writeMemoryLog } = require('./memory');
const { loadAllTasks }           = require('./task-loader');

const CONTEXT_DIR  = path.join(__dirname, '../context');
const MASTER_PATH  = path.join(CONTEXT_DIR, 'long_term/master_context.md');

// ─── Selective file readers ───────────────────────────────────────────────────

function readFile(relPath) {
  const fullPath = path.join(CONTEXT_DIR, relPath);
  if (!fs.existsSync(fullPath)) return '';
  try { return fs.readFileSync(fullPath, 'utf8').trim(); }
  catch { return ''; }
}

/** Read long_term_memory.md — keep only the last 3 entries (most recent patterns). */
function readLongTermMemoryRecent() {
  const content = readFile('long_term/long_term_memory.md');
  if (!content) return '';
  // Split on ## headers, take the last 3 (most recent entries)
  const sections = content.split(/(?=^## )/m).filter(Boolean);
  return sections.slice(-3).join('\n').trim();
}

/** Read long_term_planning.md — keep only Part 1 (life arcs) + current month. */
function readLongTermPlanning() {
  const content = readFile('long_term/long_term_planning.md');
  if (!content) return '';

  // Keep everything up to the second ## header (life arcs section),
  // then find the most recent monthly review section and include it.
  const lines = content.split('\n');
  const sections = [];
  let currentSection = [];
  let sectionCount   = 0;

  for (const line of lines) {
    if (line.startsWith('## ') && sectionCount > 0) {
      sections.push(currentSection.join('\n'));
      currentSection = [line];
      sectionCount++;
    } else {
      if (line.startsWith('## ')) sectionCount++;
      currentSection.push(line);
    }
  }
  if (currentSection.length) sections.push(currentSection.join('\n'));

  // Always include first section (life arcs) + last section (most recent review)
  if (sections.length <= 2) return content;
  return [sections[0], sections[sections.length - 1]].join('\n\n');
}

/** Read memory_log.json — only current_status fields + last 3 daily_logs. */
function readMemoryLogFiltered() {
  const log = readMemoryLog();
  const last3 = (log.daily_logs || []).slice(-3);

  return JSON.stringify({
    currentAlert:  log.currentAlert,
    subCalls:      log.subCalls,
    todayTheme:    log.todayTheme,
    pushupDebt:    log.pushupDebt,
    lastDailyReset: log.lastDailyReset,
    last3DailyLogs: last3,
  }, null, 2);
}

// ─── Build master context (DISABLED — replaced by process_protocols.md) ───────

/**
 * No-op. master_context.md is retired.
 * All planning context now comes from process_protocols.md + long_term_memory.md.
 * Call sites are left intact so nothing breaks at runtime.
 */
async function buildMasterContext() {
  console.log('[context-builder] buildMasterContext skipped — master_context is retired');
  return '';
}

/** Structured fallback when Gemma is unavailable. */
function buildFallbackContext(tasks, memLog) {
  const currentAlert = memLog.currentAlert || 'green';
  const subCalls     = (memLog.subCalls || []).join(' | ') || 'none';
  const todayTheme   = memLog.todayTheme   || 'not set';

  const projectLines = tasks
    .sort((a, b) => a.rank - b.rank)
    .map((t) => {
      const dsw = memLog.daysSinceWorked?.[t.id];
      const ago = dsw != null ? ` (${dsw}d idle)` : '';
      return `- ${t.name} [${t.rankLabel}] status:${t.status}${ago}`;
    })
    .join('\n') || '*(none)*';

  const top3 = tasks
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.status === 'stale' ? -1 : 0;
    })
    .slice(0, 3)
    .map((t, i) => `${i + 1}. ${t.name} (${t.rankLabel}) — ${t.todayStep || t.objective.slice(0, 70)}`)
    .join('\n') || '*(none)*';

  return `## Identity
Personal AI chief of staff system for a student/developer.

## Current Status
- Alert: ${currentAlert}
- Sub-calls: ${subCalls}
- Theme: ${todayTheme}

## Active Projects
${projectLines}

## Today's Priorities
${top3}

## Key Rules
- Rank order: Admiral of Starfleet > Fleet Admiral > Admiral > Vice Admiral > Rear Admiral > Commodore > Captain > Commander
- Higher rank tasks always go in the afternoon/evening blocks first
- Red Alert = critical event today; Yellow = stale/deadline <48h; Pink = special occasion
- Captain/Commander tasks only if Green Alert + all Admiral+ tasks assigned

## Pointers
- Full rank/alert system: context/onboarding_systems.md
- Project details: context/projects/[id].md
- All rules: context/onboarding_rules.md
- Memory log: context/memory_log.json`;
}

// ─── Cache check ──────────────────────────────────────────────────────────────

/**
 * Returns master_context.md content if built today, null otherwise.
 * Uses master_context_last_built from memory_log (not file mtime).
 */
function getCachedMasterContext() {
  if (!fs.existsSync(MASTER_PATH)) return null;

  const log       = readMemoryLog();
  const lastBuilt = log.master_context_last_built;
  if (!lastBuilt) return null;

  const today = new Date().toLocaleDateString('en-CA');
  if (!lastBuilt.startsWith(today)) return null;

  try {
    return fs.readFileSync(MASTER_PATH, 'utf8');
  } catch {
    return null;
  }
}

module.exports = { buildMasterContext, getCachedMasterContext };
