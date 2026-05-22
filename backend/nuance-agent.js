'use strict';

const { generate, OLLAMA_AUDIT_MODEL } = require('./ollama');

async function runNuanceCheck({ dateStr, globalContextDoc, generatedPlan, auditScratchpad }) {
  const raw = await generate({
    model:  OLLAMA_AUDIT_MODEL,
    system: 'You are a nuance manager. Your only job is to detect what the plan dropped or mishandled. Output numbered patches only. No preamble. Be precise.',
    prompt: `Today: ${dateStr}

## Original Context (compressed)
${globalContextDoc}

## Constraint Audit Report
${auditScratchpad}

## Generated Day Plan
${generatedPlan}

For each row in the constraint audit that is missing or incorrectly handled in the plan, issue a correction patch:

PATCH 1:
- Missed: [what was dropped or misapplied]
- Fix: [what the plan must do instead]
- Evidence: [exact quote from original context or audit table]

If every constraint in the audit table is correctly addressed in the plan, write exactly:
NO_PATCHES_REQUIRED`,
    options: { temperature: 0.2, num_predict: 900 },
  });

  const isClean = /NO_PATCHES_REQUIRED/i.test(raw);
  return { isClean, patches: isClean ? null : raw };
}

module.exports = { runNuanceCheck };
