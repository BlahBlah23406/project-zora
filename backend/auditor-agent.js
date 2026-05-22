'use strict';

const { generate, OLLAMA_AUDIT_MODEL } = require('./ollama');

async function runConflictAudit({ dateStr, projectsCtx, tasksCtx, eventsCtx, rules, planning }) {
  const raw = await generate({
    model:  OLLAMA_AUDIT_MODEL,
    system: 'You are a constraint auditor. Scan for conflicts, overrides, and deadline urgency only. Output a markdown table then a single YES/NO verdict. No preamble. Be terse.',
    prompt: `Today: ${dateStr}

PROJECTS:
${JSON.stringify(projectsCtx)}

TASKS:
${JSON.stringify(tasksCtx)}

EVENTS:
${JSON.stringify(eventsCtx)}

RULES:
${(rules || '').slice(0, 1200)}

PLANNING NOTES:
${(planning || '').slice(0, 400)}

Populate this table. Only include rows where a real constraint exists — skip empty rows:

| # | Type | Items Affected | Severity | Action Required |
|---|------|----------------|----------|-----------------|

Constraint types:
- DEADLINE_URGENT: project or task due today or within 48 hours
- TIME_COLLISION: two strict-timing events overlap
- RULE_OVERRIDE: a conditional rule in rules.md applies to a scheduled item
- CROSS_DEPENDENCY: an item cannot proceed until another item is scheduled first

After the table, on its own line, write exactly one of:
CONSTRAINTS_FOUND: YES
CONSTRAINTS_FOUND: NO`,
    options: { temperature: 0.1, num_predict: 700 },
  });

  const hasConstraints = /CONSTRAINTS_FOUND:\s*YES/i.test(raw);
  return { hasConstraints, scratchpad: raw };
}

module.exports = { runConflictAudit };
