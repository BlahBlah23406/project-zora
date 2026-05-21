/**
 * condense-manager.js
 *
 * Monitors rules.md and planning.md for bullet-point bloat.
 * When either file exceeds 40 bullet points, generates a condensed version
 * using AI and stores it as a pending review in context/condense_pending.json.
 *
 * Exports:
 *   checkAllFiles()              — check both files, generate pending if needed
 *   getStatus()                  — { rules: pending|null, planning: pending|null }
 *   applyCondensed(file)         — accept: replace .md with condensed version
 *   rejectCondensed(file)        — reject: discard condensed draft
 *   BULLET_LIMIT                 — 40
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { generate, OLLAMA_MODEL } = require('./ollama');

const CONTEXT_DIR    = path.join(__dirname, '../context');
const RULES_PATH     = path.join(CONTEXT_DIR, 'rules.md');
const PLANNING_PATH  = path.join(CONTEXT_DIR, 'planning.md');
const PENDING_PATH   = path.join(CONTEXT_DIR, 'condense_pending.json');

const BULLET_LIMIT = 40;

// ── Pending store ─────────────────────────────────────────────────────────────

function readPending() {
  try { return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8')); }
  catch { return { rules: null, planning: null }; }
}

function writePending(data) {
  fs.writeFileSync(PENDING_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ── Bullet counter ────────────────────────────────────────────────────────────

/** Counts lines that are bullet points (start with "- " or "* " after whitespace). */
function countBullets(text) {
  return (text || '').split('\n').filter((l) => /^\s*[-*]\s/.test(l)).length;
}

// ── Status ────────────────────────────────────────────────────────────────────

function getStatus() {
  const pending = readPending();
  return {
    rules:    pending.rules    ? { count: pending.rules.originalCount,    generatedAt: pending.rules.generatedAt }    : null,
    planning: pending.planning ? { count: pending.planning.originalCount, generatedAt: pending.planning.generatedAt } : null,
  };
}

// ── Condense rules.md ─────────────────────────────────────────────────────────

async function condenseRules(content, count) {
  console.log(`[condense] rules.md has ${count} bullets — condensing…`);

  const raw = await generate({
    model:  OLLAMA_MODEL,
    system: 'You condense rule lists. Output ONLY a simple bullet list. No preamble, no explanation.',
    prompt: `This rules file has grown too long (${count} bullets). Condense it to under 30 bullets total while keeping ALL important rules.

CRITICAL requirements:
- Keep the simple bullet-list format only — one rule per bullet
- Use [standing] for durable rules
- Use [temp ...] for temporary rules that still matter
- Drop temporary rules that are clearly expired
- Merge any redundant rules into one concise bullet
- Keep this file focused on planning rules and generation rules, not the day schedule itself
- Do NOT invent new rules — only compress and merge existing ones
- Output only bullet points

Current content:
${content}`,
    options: { temperature: 0.2, num_predict: 1200 },
  });

  return raw.trim();
}

// ── Condense planning.md ──────────────────────────────────────────────────────

async function condensePlanning(content, count) {
  console.log(`[condense] planning.md has ${count} bullets — condensing…`);

  const raw = await generate({
    model:  OLLAMA_MODEL,
    system: 'You condense planning documents. Output ONLY the condensed markdown. No preamble, no explanation.',
    prompt: `This planning file has grown too long (${count} bullets). Condense it to under 30 bullets total.

CRITICAL requirements:
- Preserve the "# Planning" heading and all "## Section" headings that are still relevant
- Every section must remain bullet-point format only
- Keep Life Arcs section fully intact — these are long-term
- For month/forward-plan sections: keep only current and future entries, drop fully past ones
- Merge redundant observations into concise bullets
- Preserve all specific dates (YYYY-MM-DD) and project names exactly
- Do NOT invent new content — only compress and merge existing content
- Output only the markdown

Current content:
${content}`,
    options: { temperature: 0.2, num_predict: 1500 },
  });

  return raw.trim();
}

// ── Check a single file ───────────────────────────────────────────────────────

async function checkFile(key) {
  const filePath = key === 'rules' ? RULES_PATH : PLANNING_PATH;
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  const count   = countBullets(content);

  if (count <= BULLET_LIMIT) {
    console.log(`[condense] ${key}.md: ${count} bullets — OK`);
    return;
  }

  // Already has a pending review — don't regenerate
  const pending = readPending();
  if (pending[key]) {
    console.log(`[condense] ${key}.md: ${count} bullets — already pending review`);
    return;
  }

  // Generate condensed version
  let condensed;
  try {
    condensed = key === 'rules'
      ? await condenseRules(content, count)
      : await condensePlanning(content, count);
  } catch (err) {
    console.error(`[condense] Failed to condense ${key}.md:`, err.message);
    return;
  }

  if (!condensed) return;

  pending[key] = {
    condensed,
    originalCount: count,
    generatedAt:   new Date().toISOString(),
  };
  writePending(pending);
  console.log(`[condense] ${key}.md condensed — pending review (was ${count} bullets)`);
}

// ── Check both files ──────────────────────────────────────────────────────────

async function checkAllFiles() {
  await checkFile('rules').catch((e) => console.warn('[condense] rules check failed:', e.message));
  await checkFile('planning').catch((e) => console.warn('[condense] planning check failed:', e.message));
}

// ── Apply / reject ────────────────────────────────────────────────────────────

function applyCondensed(key) {
  if (key !== 'rules' && key !== 'planning') throw new Error('Invalid file key');

  const pending = readPending();
  const entry   = pending[key];
  if (!entry) throw new Error(`No pending condensed version for ${key}`);

  const filePath = key === 'rules' ? RULES_PATH : PLANNING_PATH;

  // Backup original
  fs.copyFileSync(filePath, filePath + '.condense-bak');

  // Write condensed version
  fs.writeFileSync(filePath, entry.condensed + '\n', 'utf8');

  // Clear pending
  pending[key] = null;
  writePending(pending);

  console.log(`[condense] Applied condensed ${key}.md`);
  return { ok: true, newCount: countBullets(entry.condensed) };
}

function rejectCondensed(key) {
  if (key !== 'rules' && key !== 'planning') throw new Error('Invalid file key');

  const pending = readPending();
  pending[key]  = null;
  writePending(pending);

  console.log(`[condense] Rejected condensed ${key}.md — keeping original`);
  return { ok: true };
}

/** Returns the pending condensed text for display in the review modal. */
function getPendingContent(key) {
  const pending = readPending();
  return pending[key]?.condensed || null;
}

module.exports = {
  checkAllFiles,
  checkFile,
  getStatus,
  getPendingContent,
  applyCondensed,
  rejectCondensed,
  countBullets,
  BULLET_LIMIT,
};
