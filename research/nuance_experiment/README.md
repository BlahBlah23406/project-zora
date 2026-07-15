# Nuance-Manager Experiment Harness

Tests the central Project Zora research claim with **objective, deterministic scoring**:

> Does *decompose → small workers → aggregate → Nuance Manager* match a single large model,
> more cheaply — and does the advantage **grow with cross-chunk dependency density**?

Full rationale, literature, and interpretation: [`../nuance-manager-architecture.md`](../nuance-manager-architecture.md).

## Files
- `tasks.jsonl` — seed planning tasks. Each has a machine-checkable **gold constraint set** and a
  `dependency_density` label (low / mid / high). Add more tasks here — the density axis is where the
  effect should appear.
- `metrics.py` — deterministic scoring (no LLM judge for correctness). `correctness` = fraction of all
  gold constraints satisfied; `ledger_recall` = fraction of **cross-chunk** constraints satisfied (the
  nuance metric).
- `run_experiment.py` — arms A–E, resumable, prints a Pareto-style summary.
- `results/` — one JSON per (task, arm, seed). **Delete a file to force that cell to re-run.**

## The five arms
| Arm | Name | What it isolates |
|-----|------|------------------|
| A | `single_large` | quality + cost ceiling (strongest model, full prompt) |
| B | `single_small` | naive-cheap baseline (small model, full prompt) — the thing to beat |
| C | `decomp_noNM` | decomposition alone (rule-blind workers + rule-blind aggregate) |
| D | `decomp_NM` | full system (adds the Nuance Manager, which is the only step that sees the rules) |
| E | `self_moa` | Self-MoA (N samples of the small model, majority-aggregated) — confronts arXiv:2502.00674 |

**The claims are in the differences:** `D − C` = Nuance Manager value; `C − B` = decomposition value;
`A − D` = residual gap to the big model. If the thesis holds, all three widen from low → high density.

### Key experimental assumption (read this)
In arms C/D the workers see **only their own chunk and none of the rules**, and the aggregator is
**rule-blind**. The Nuance Manager (arm D only) is the sole step that sees the rules. This is
deliberate: it models the regime where the full context is too big to give everything to every worker,
and it cleanly attributes rule-satisfaction to the manager, so `D − C` measures exactly the manager's
contribution. If you'd rather test "give rules to everyone," change `_worker_place` / `_aggregate`.

## Running it — as a DETACHED JOB (a full sweep outlives a tool-call timeout)
```
node C:\Users\shaya\.openclaw\scripts\job.mjs start ^
  --name "zora nuance exp" ^
  --cmd "python run_experiment.py --arms A,B,C,D,E --seeds 3" ^
  --cwd C:\Users\shaya\.openclaw\workspace\project-zora\research\nuance_experiment
```
It checkpoints every cell, so if it's killed it resumes where it left off. **Never run the full sweep
inside a foreground tool call** — it will be SIGKILLed and take its process tree with it.

A cheap smoke (safe inline, ~2–3 min): `python run_experiment.py --arms B,C --seeds 1 --limit 1`

## Sweeps that make it publishable
- **Manager-size sweep** — answers "how small can the manager be?":
  `ZORA_MANAGER=gemma4:e2b python run_experiment.py --arms D --seeds 3`, then `e4b`, then a local 8B,
  then `gemma4:31b-cloud`. Find the smallest manager that closes most of the `A − D` gap.
- **Model roles** are env-overridable: `ZORA_SMALL`, `ZORA_MID`, `ZORA_LARGE`, `ZORA_MANAGER`,
  `ZORA_MOA_N`, `ZORA_TIMEOUT`, `OLLAMA_URL`.

## Reading results
The summary table prints `corr`, `ledger`, mean violations, mean total tokens, and mean call count per
(arm, density). Cost = **summed** tokens/latency across *all* calls in the pipeline — decomposition
multiplies calls, so a naive pipeline can cost *more* than the single big call it replaces. That honest
accounting is the point (don't report per-call cost).

## Citation verification recipe (see architecture doc §7)
Every paper cited was verified against the arXiv API. To re-check an ID/title:
```
curl -s "https://export.arxiv.org/api/query?search_query=ti:%22Mixture-of-Agents%22&max_results=3"
```
Rule adopted: a blog/LinkedIn post is an idea to check, never a source to cite. Every citation gets an
arXiv ID or DOI.
