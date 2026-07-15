# Prompt Condensation + Nuance Manager: Literature, Architecture, and an Experiment Plan

**Author:** Claude (Opus 4.8), acting as mentor to Project Zora
**Date:** 2026-07-15
**Audience:** Shayaan (Project Zora) — and R2-D2, the local agent maintaining Zora
**Status:** Research direction review. Nothing here has been run end-to-end yet; §6 ships a runnable
harness to actually test the central claim.

---

## 0. TL;DR (read this first)

Your core question is:

> Do several smaller, weaker agents — each handling a decomposed piece of a prompt, with a Nuance
> Manager reconciling the losses — outperform one large agent processing the full prompt at once?

Honest answer from the literature and from first principles:

1. **This has been studied heavily, under other names.** The "many small agents beat one big model"
   claim is essentially **Mixture-of-Agents (MoA)** (Wang et al., 2024) plus **prompt/context
   compression** (LLMLingua, Jiang et al., 2023) plus **decomposition prompting** (Least-to-Most,
   Zhou et al., 2022). Your "Nuance Manager" is a specific, and genuinely underexplored, twist on the
   *aggregator/critic* role. So: not a blank field, but there is a real, defensible novel angle.

2. **The strong version of the claim is probably false, and the recent literature says so.**
   "Rethinking Mixture-of-Agents" (Li et al., 2025 — *Self-MoA*) found that mixing in *weaker* models
   usually **drags the ensemble down**; an ensemble of the single *best* model's own samples often beats
   a mixture of heterogeneous weaker ones. So "collect enough 2B models and you match GPT-4" is not a
   safe bet. **The defensible claim is narrower and more interesting** (see #3).

3. **The narrow claim that is worth your research energy:** *For tasks that decompose into
   near-independent sub-tasks over a long, structured context, a decompose → small-model → reconcile
   pipeline can match a single large model at a fraction of the cost/memory, PROVIDED a reconciliation
   step repairs the cross-chunk dependencies that decomposition severs.* That reconciliation step is
   your Nuance Manager. Your key insight — that lost nuance is **concentrated, not uniform** — is the
   right insight and is the thing to measure.

4. **Your Nuance Manager, as a "recover what chunking severed" mechanism, maps onto a known failure
   mode with no clean off-the-shelf solution.** Decomposition destroys exactly the *cross-chunk
   relations* (a rule in chunk A that overrides an event in chunk C). Nobody has a tidy answer for
   this at the 2B scale. That is your contribution surface. Build it as a **cross-dependency repair
   pass**, not a vague "oversee and reintegrate" agent.

5. **Feasibility:** the small *workers* can be 2–8B and CPU-fine. The **Nuance Manager itself is the
   hard reasoning step and should be your strongest available model** (in Zora terms: `gemma4:31b-cloud`
   or `glm-5.2:cloud`, or a strong local 7–8B), because reconciling cross-dependencies *is* the
   long-horizon reasoning you decomposed to avoid. If the manager has to be as big as the model you
   were trying to replace, the cost argument weakens — so the research question becomes: **how small can
   the manager be and still repair the losses?** That is measurable and publishable.

Everything below justifies these five points and gives you a way to test them.

---

## 1. What the literature already says (verified sources)

Every arXiv ID below was verified against the arXiv API on 2026-07-15. I have deliberately **not**
included any source I could not verify. (See §7 for a note on a citation in your existing
`research_reasoning_small_models.md` that I could **not** verify and recommend you drop.)

### 1.1 The idea you're describing already has names

| Your term | Established name | Reference |
|---|---|---|
| "Condense the prompt" | Prompt / context compression | LLMLingua (arXiv **2310.05736**); LLMLingua-2 (**2403.12968**); Selective Context; RECOMP (**2310.04408**) |
| "Break into chunks, one small agent each" | Task decomposition prompting | Least-to-Most (**2205.10625**); Decomposed Prompting; Skeleton-of-Thought (**2307.15337**) |
| "Several agents, a master aggregates" | Mixture-of-Agents (MoA) | Wang et al. (**2406.04692**) |
| "Long context split across agents" | Chain-of-Agents | Zhang et al. (**2406.02818**) |
| "Run many, combine" | Ensembling / sampling | Self-Consistency (**2203.11171**); More Agents Is All You Need (**2402.05120**) |
| "Agents cross-check each other" | Multi-agent debate | Du et al. (**2305.14325**) |
| "Master reconciles nuance loss" | *Aggregator / critic / reconciler* | closest priors are MoA's aggregator and the summarization-faithfulness literature (§1.4) — **your Nuance Manager is a specific instantiation here that is not well-studied** |

**Takeaway:** you are standing on a large, active body of work. This is good news for a UW freshman
research portfolio: it means there are strong baselines to compare against and a clear gap to claim.
It is bad news for a naive framing — "nobody has tried small agents + a manager" is not defensible.
Frame the contribution as the *Nuance Manager mechanism and a measurement of concentrated nuance
loss*, not as the general idea.

### 1.2 Mixture-of-Agents — the direct prior, and its rebuttal

- **Mixture-of-Agents Enhances Large Language Model Capabilities** — Wang, Mo, Xu, et al., 2024
  (arXiv:2406.04692). Layers of LLM "proposers" whose outputs are fed to "aggregators" in the next
  layer; a final aggregator synthesizes. Reported that an open-source MoA beat GPT-4 Omni on
  AlpacaEval 2.0. **This is the paper your thesis most resembles.** Read it first.

- **Rethinking Mixture-of-Agents: Is Mixing Different LLMs Beneficial?** — Li et al., 2025
  (arXiv:2502.00674, "Self-MoA"). *Directly challenges the mixing premise.* Finds that aggregating
  multiple samples from the **single strongest** model ("Self-MoA") often **beats** mixing in weaker,
  heterogeneous models, because a few low-quality proposals poison the aggregation. **This is the
  paper that most threatens your hypothesis — you must engage with it.** Its lesson for you: quality of
  proposers matters more than diversity; adding weak agents can *hurt*. Your Nuance Manager has to
  earn its keep against this baseline.

- **More Agents Is All You Need** — Li et al., 2024 (arXiv:2402.05120). Sampling-and-voting scales
  performance with the number of agents, and the effect is **larger for smaller/weaker base models** —
  a point in *favor* of your direction, but note it is ensembling the *same* model, not decomposing
  one prompt across specialists.

- **When Agents Disagree: The Selection Bottleneck in Multi-Agent LLM Pipelines** — 2026
  (arXiv:2603.20324). Recent and directly relevant: the bottleneck in these pipelines is often the
  *selection/aggregation* step, not the workers. This is an argument that your Nuance Manager (an
  aggregation-quality mechanism) is attacking the *right* bottleneck.

### 1.3 Prompt / context compression — the "condense" half

- **LLMLingua** (2310.05736) and **LLMLingua-2** (2403.12968): compress prompts by having a small LM
  score and drop low-information tokens, achieving up to ~20× compression with small performance loss
  on some tasks. Crucially, **LLMLingua-2 is trained to be faithful/task-agnostic precisely because
  naive perplexity-based dropping loses task-relevant nuance unevenly** — which is empirical support
  for your "nuance is concentrated, not uniform" insight.
- **RECOMP** (2310.04408): compress retrieved documents (extractive + abstractive) before feeding an
  LM; explicitly trades off compression rate vs. downstream answer quality.
- **Relevance to Zora:** compression research already treats "how much nuance did we lose, and where"
  as a first-class metric. Borrow their evaluation methodology (§4) rather than inventing one.

### 1.4 The unavoidable subproblem: faithfulness of summarization/aggregation

Your Nuance Manager's job is, formally, *detecting and repairing information loss during
summarize-then-merge.* That is the summarization-faithfulness field. You should measure with its tools:

- **SummEval** (2007.12626): showed most automatic summarization metrics (ROUGE, etc.) correlate poorly
  with human judgments of consistency — **do not evaluate nuance loss with ROUGE/BLEU alone.**
- **Atomic Content Units / "Revisiting the Gold Standard"** (2212.07981, the RoSE work): decompose a
  reference into atomic facts and measure recall of those units. **This is the right shape for your
  "nuance preservation" metric** — see §4.2.
- **FineSurE** (2407.00908): fine-grained LLM-based faithfulness + completeness scoring at the
  fact/sentence level. A ready-made template for an LLM-judge that reports *which* facts were dropped
  (completeness) and which were wrong (faithfulness) — exactly the two axes a Nuance Manager cares about.

### 1.5 Why decomposition loses nuance in the first place (the mechanism)

- **Lost in the Middle** (2307.03172): LMs use information at the *edges* of a long context far better
  than in the middle. This is a mechanistic reason a single big-context call drops nuance — and part of
  *why* decomposition can help (each chunk is short, so nothing is "in the middle"). But it is also why
  **cross-chunk** relations are the exact thing that dies: the relation spans two chunks that no single
  worker ever sees together.
- **Decomposition prompting** (Least-to-Most 2205.10625; Skeleton-of-Thought 2307.15337): decomposing
  helps *within* a reasoning chain, but classic decomposition assumes sub-problems are **independent or
  cleanly sequential**. Your planning domain violates that assumption (a rule in one chunk gates an
  event in another). **The independence violation is precisely the nuance the manager must recover.**

**Synthesis of §1:** the field strongly supports (a) that decomposition + compression can preserve
most performance cheaply, and (b) that the residual failure is concentrated in cross-chunk / non-uniform
information loss. The field is skeptical (Self-MoA) that *heterogeneous weak* agents beat a strong one.
Your Nuance Manager is best positioned as *the mechanism that recovers the concentrated cross-chunk loss*
— and that is both novel enough to be interesting and narrow enough to be testable.

---

## 2. Is the "Nuance Manager" concept sound? (architecture feedback)

Short version: **the concept is sound, but "nuance" is too vague to build or measure. Make it
mechanical.** Right now the README describes it as "track, recover, and inject back subtle
cross-dependencies." That is an aspiration, not an algorithm. Here is how to make it real.

### 2.1 Define "nuance" operationally, or you cannot measure it

Pick a concrete, checkable definition. For Zora's planning domain I recommend defining a unit of nuance
as a **constraint**: a typed, checkable proposition about the plan. You already have the vocabulary in
`auditor-agent.js`:

- `DEADLINE_URGENT(item, due)` — item due within 48h
- `TIME_COLLISION(a, b)` — two strict events overlap
- `RULE_OVERRIDE(rule, item)` — a conditional rule applies to a scheduled item
- `CROSS_DEPENDENCY(a, b)` — a must be scheduled before b

"Nuance loss" then has a precise meaning: **a constraint that was true of the full context but is
violated or absent in the merged plan.** This is checkable by code for the structural ones
(TIME_COLLISION, DEADLINE_URGENT) and by an LLM-judge for the semantic ones (RULE_OVERRIDE). This
definition is what makes the whole research program falsifiable. Do not skip it.

### 2.2 The Nuance Manager should be a *cross-dependency repair* pass, not an "overseer"

The failure that decomposition introduces is specific: **constraints whose two endpoints landed in
different chunks.** If chunk A holds the rule "no robotics after 9pm" and chunk C holds the 10pm
robotics block, no worker can see the violation; only something that reads across chunks can. So the
manager's job is mechanical:

1. **Before decomposition:** extract the set of cross-chunk relations the split is about to sever.
   (You know the chunk boundaries; you can detect which rules/dependencies reference items in other
   chunks.) Call this the **nuance ledger** — a list of "at-risk" constraints. This is the concrete
   form of your insight that nuance is concentrated: *the ledger is usually short*, even when the prompt
   is huge, because most content is chunk-local.
2. **After aggregation:** check the merged plan against the ledger. For each at-risk constraint, ask:
   is it satisfied? This is cheap — it is checking a short list, not re-reasoning the whole plan.
3. **Repair:** for each violated constraint, emit a patch (your `nuance-agent.js` already emits
   `PATCH n: Missed / Fix / Evidence` — keep that format; it's good) and re-apply. Re-run the check
   until clean or a max iteration count.

This reframing matters because it (a) makes the manager's workload *proportional to the number of
cross-chunk dependencies*, not to prompt size — so a small manager can handle a huge prompt as long as
few dependencies cross boundaries; and (b) turns "measure nuance loss" into "count violated ledger
entries," which is objective.

### 2.3 Make the *chunker* dependency-aware — that's where the leverage is

Your biggest lever is not the manager; it's **the split**. If you chunk so that mutually-dependent
items stay in the same chunk, you sever fewer relations and the manager has almost nothing to repair.
This is a **graph partitioning** problem: build a graph where nodes are items (events, tasks, rules)
and edges are relations (overrides, dependencies, time-adjacency), then cut the graph to minimize the
weight of severed edges (min-cut / community detection). Even a greedy heuristic (keep each rule in the
same chunk as the items it names) will beat naive "split by category" chunking (which is what the
README's Calendar/Projects/Tasks split does — that split cuts *every* cross-category rule).

> **This is a genuinely novel, publishable sub-contribution on its own:** *dependency-aware semantic
> chunking that minimizes reconciliation cost*, measured by "constraints severed per chunk." It's also
> much more tractable than "solve nuance in general."

### 2.4 Reintegration mechanism: patch-and-recheck, not merge/vote

You asked: merge, vote, or hierarchical? For this domain:

- **Vote** is wrong — the workers aren't answering the *same* question, so there's nothing to vote on.
- **Merge** (concatenate sub-plans) is the *aggregator's* job and is fine as a first pass.
- **Hierarchical repair** (the manager checks the merged artifact against the ledger and patches) is
  the right model for the Nuance Manager. It's iterative refinement (cf. Self-Refine / reflection),
  bounded by the ledger so it terminates and stays cheap.

### 2.5 Risks to design against (from the literature)

- **Self-MoA risk (2502.00674):** a weak worker's bad chunk output can poison the merge. Mitigation:
  the manager should *validate* each worker's output structurally before merging (you already do JSON
  schema validation — extend it), and the aggregator should be allowed to discard a malformed chunk
  and re-ask.
- **Selection-bottleneck risk (2603.20324):** if the manager/aggregator is weak, it becomes the
  ceiling. This is the empirical argument for spending your model budget on the *manager*, not the
  workers.
- **Compounding-error risk:** iterative patch loops can oscillate. Cap iterations (2–3), and never let
  two components adjust the same field independently — one owner per field. (R2-D2 learned this exact
  lesson the expensive way in the LipSync speed bug; the rule generalizes.)

---

## 3. Feasibility on local hardware

- **Workers (per-chunk):** 2–8B, CPU-fine. Each sees a *short* chunk, so context is small and latency
  is bounded. `gemma4:e2b`/`e4b` are appropriate here — your own eval suite already shows they pass
  formatting/audit/nuance-*detection* style tasks. Run them **sequentially** on a CPU box (low RAM);
  "parallel local execution" in the README is aspirational on one CPU machine — parallelism buys you
  nothing without multiple cores/GPUs free, and can thrash RAM. Measure sequential first.
- **The Nuance Manager:** this is the long-horizon reasoning step. Budget your best model here:
  `gemma4:31b-cloud` or `glm-5.2:cloud`, or a strong local 7–8B (`deepseek-r1:7b`, `qwen3:8b` per your
  `.env`). **The central feasibility question of your whole project is: can the manager be small?**
  If the manager must be as large as the single-big-model baseline, the cost argument collapses. So
  make "manager size vs. reconciliation quality" a first-class axis in the experiment (§4.3). My prior:
  because the manager only checks a *short ledger* (§2.2), it can be much smaller than a model that has
  to reason over the whole prompt — but you must show it.
- **Cost model to report:** total wall-clock, total tokens (prompt+gen) summed across *all* calls
  (workers + aggregator + manager + repair loops), and peak RAM. The honest comparison is *pipeline
  total* vs. *one big call* — decomposition multiplies the number of calls, so a naive pipeline can
  easily cost **more** tokens than the single big call it replaces. Reporting only per-call cost is the
  metric-that-only-reports-success trap. Report the sum.

---

## 4. How to test this rigorously (experiment design)

This is the part that turns a cool idea into research. §6 ships a runnable harness implementing exactly
this. Design:

### 4.1 The four arms (ablation)

For each task, run and compare:

- **A. Single-large:** one call, full prompt, strongest model. *(quality ceiling + cost ceiling)*
- **B. Single-small:** one call, full prompt, small model. *(the naive-cheap baseline you must beat)*
- **C. Decompose→workers→aggregate, NO manager.** *(isolates the value of decomposition alone)*
- **D. Decompose→workers→aggregate→Nuance Manager.** *(the full system)*

The scientific claims live in the *differences*: **D − C** is the value of the Nuance Manager;
**C − B** is the value of decomposition; **A − D** is the remaining gap to the big model (ideally ~0 at
much lower cost). Also add **E. Self-MoA baseline** (N samples of the *small* model, aggregated) to
confront 2502.00674 head-on.

### 4.2 Metrics (report all four; never just accuracy)

1. **Task correctness** — for planning tasks, a **deterministic constraint-satisfaction score**: what
   fraction of the gold constraint set does the output plan satisfy? This is objective and needs no
   judge. *(This is why §2.1's constraint definition matters.)*
2. **Nuance preservation** — **ledger recall**: of the cross-chunk constraints that decomposition put
   at risk, what fraction survived in the final output? This directly measures the thing your thesis is
   about. Use the ACU/FineSurE style (§1.4): atomic, checkable units, recall-scored.
3. **Hallucination rate** — count of claims/items in the output *not* supported by the input context
   (FineSurE faithfulness axis). Decomposition should *lower* this vs. the big single call (your
   hypothesis); measure whether it does.
4. **Cost** — summed tokens + wall-clock + peak RAM across the whole pipeline (§3).

Plot quality (1,2) against cost (4). The compelling result is a Pareto frontier where **D dominates B**
(better *and* cheaper) and **approaches A** at a fraction of A's cost.

### 4.3 The two sweeps that make it publishable

- **Manager-size sweep:** hold workers fixed, vary the manager model (e2b → e4b → 8B → 31b-cloud).
  Find the smallest manager that closes most of the A−D gap. *This answers your "does the manager itself
  need to be large?" question with a curve, not an opinion.*
- **Chunking-strategy sweep:** naive category-split vs. dependency-aware split (§2.3). Show that better
  chunking shrinks the ledger and reduces the manager's workload. *This isolates your novel chunker.*

### 4.4 Tasks / data

Start with **your own domain** (day-planning with constraints) because you can generate gold constraint
sets programmatically — objective scoring, no expensive human eval. Build ~30–50 synthetic planning
instances of increasing dependency density (few cross-chunk rules → many). The **dependency-density
axis** is where your effect should appear: at low density, decomposition alone (C) suffices and the
manager adds little; at high density, the manager (D) should pull away from C. *Showing the effect grow
with dependency density is the cleanest possible evidence that the manager does what you claim.*
Then, for external validity, add a public long-context QA/summarization set (e.g. a subset of a
multi-document task) scored with FineSurE-style ACU recall.

### 4.5 Statistical hygiene

- Fix temperature low (0.2, matching your eval suite) or report across seeds; run each arm ≥3 times and
  report mean ± std — single runs of stochastic models prove nothing.
- Pre-register the four metrics before looking at results (write them down; don't pick the flattering
  one after the fact).
- Watch for the "103% coverage" trap (a metric that counts things nobody wants): ledger recall must
  only credit constraints that are *actually* satisfied in a *valid* plan, not merely mentioned.

---

## 5. Connection to Project Zora

Zora is the ideal testbed and you've already built most of the parts:

- `condense-manager.js` is your **compressor** — but note it currently condenses *rules/planning files
  for storage*, not the *planning prompt for a run*. The research needs the latter: a condense step in
  the planning path. Reuse the LLM-summarize pattern but add the **nuance ledger** extraction (§2.2).
- `auditor-agent.js` already produces a **constraint table** — that is 80% of your ledger extractor.
  Point it at *pre-decomposition* context to produce the at-risk list.
- `nuance-agent.js` already emits **patches with evidence** — that is your **repair** step. It's
  well-shaped; the missing piece is that it should check against the *ledger*, and loop until clean.
- The dual-LLM pattern (deepseek-r1 reason + qwen JSON) maps cleanly onto worker (reason) + validator
  (JSON schema) roles.

**Concrete integration path (smallest first):**
1. Add a `research/nuance_experiment` harness (done — §6) that reuses your Ollama client and context
   files, so the experiment runs against the *real* Zora models and data, not a toy.
2. If arm D beats B/C on your planning tasks, promote the dependency-aware chunker + ledger repair into
   the live planning pipeline behind a feature flag.
3. The MoA-for-multimodal research you're doing separately connects here: the **nuance ledger** idea
   (extract at-risk cross-modal relations before splitting a multimodal prompt, repair after) is a
   direct transfer. That's a nice thread to pull for the UW research portfolio.

---

## 6. The runnable harness (what I built)

Directory: `project-zora/research/nuance_experiment/`

- `README.md` — how to run it (as a **detached job**, never in the foreground — see the rule below).
- `tasks.jsonl` — seed planning tasks with **gold constraint sets** (objective scoring) and a
  dependency-density label.
- `metrics.py` — deterministic constraint-satisfaction scoring + ledger recall + a hook for an
  LLM-judge (FineSurE-style) for the semantic constraints.
- `run_experiment.py` — implements arms A–E, checkpoints every result to `results/` so it is
  resumable, and prints a Pareto summary. Uses the same Ollama endpoint/patterns as `eval_suite_v2.py`.

It is **wired to the live models** (`gemma4:e2b`, `gemma4:e4b`, `gemma4:31b-cloud`, `glm-5.2:cloud`)
and the real `context/` files, but **it has not been run to completion yet** (a full sweep is a
long job and must be launched detached — running it inside a tool call would get it SIGKILLed). The
harness is written to be resumable precisely so that's safe. See the README for the exact `job.mjs`
command.

---

## 7. Citation-hygiene note (important for a research portfolio)

Your existing `research/../research_reasoning_small_models.md` (in the repo root) cites, as its
headline source:

> "Lost in Thought: Quantifying Reasoning Decay in Sub-3B Parameter Models" (Pardesi, 2024) — a
> LinkedIn long-form article — with very specific figures (RDS = −12%, a "reasoning cliff" below 500M,
> "60% of failed CoT cases contain fabricated steps").

I could **not verify this source exists** (no arXiv/DOI/venue; a LinkedIn post is not a citable primary
source), and the oddly precise numbers are exactly the shape of a hallucinated citation. **For a UW
research portfolio, remove or heavily caveat it.** The *substance* of that doc (Selection-Inference,
distillation, cascading) is fine and those papers are real — it's specifically the "Pardesi/LinkedIn"
headline claim and its statistics that you should not repeat in anything you submit. I've added a banner
to that file pointing here; I did **not** delete your content.

**New rule worth adopting:** every citation in a research doc gets an arXiv ID / DOI, and a blog/
LinkedIn post is evidence of an *idea to check*, never a *source to cite*. The `curl` recipe I used to
verify against the arXiv API is in the harness README so you (or R2-D2) can re-run it.

---

## 8. What I recommend you do next (ranked)

1. **Reframe the thesis** from "small agents beat big models" (Self-MoA says: usually not) to "a
   dependency-aware decompose→reconcile pipeline matches a big model at a fraction of the cost, and the
   effect grows with cross-chunk dependency density." Narrower, defensible, testable.
2. **Adopt the constraint = unit-of-nuance definition** (§2.1). Nothing else is measurable without it.
3. **Run the four-arm experiment** (§4, §6) on your own planning tasks first (objective scoring).
4. **Run the manager-size sweep** (§4.3) — the answer to "must the manager be big?" is the crux of the
   whole cost argument and the most interesting single result you can produce.
5. **Build the dependency-aware chunker** (§2.3) — it's a clean, novel, publishable sub-result and it's
   where most of the real gain will come from.
6. **Fix the citation hygiene** (§7) before any of this goes in a portfolio.

---

## Appendix A. Verified references

All IDs verified against `export.arxiv.org/api` on 2026-07-15.

- Wang et al., *Mixture-of-Agents Enhances Large Language Model Capabilities*, arXiv:2406.04692 (2024).
- Li et al., *Rethinking Mixture-of-Agents: Is Mixing Different Large Language Models Beneficial?*
  (Self-MoA), arXiv:2502.00674 (2025).
- Li et al., *More Agents Is All You Need*, arXiv:2402.05120 (2024).
- *When Agents Disagree: The Selection Bottleneck in Multi-Agent LLM Pipelines*, arXiv:2603.20324 (2026).
- Zhang et al., *Chain of Agents: LLMs Collaborating on Long-Context Tasks*, arXiv:2406.02818 (2024).
- Jiang et al., *LLMLingua: Compressing Prompts for Accelerated Inference*, arXiv:2310.05736 (2023).
- Pan et al., *LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt
  Compression*, arXiv:2403.12968 (2024).
- Xu et al., *RECOMP: Improving Retrieval-Augmented LMs with Compression and Selective Augmentation*,
  arXiv:2310.04408 (2023).
- Zhou et al., *Least-to-Most Prompting Enables Complex Reasoning*, arXiv:2205.10625 (2022).
- Ning et al., *Skeleton-of-Thought: Prompting LLMs for Efficient Parallel Generation*,
  arXiv:2307.15337 (2023).
- Wang et al., *Self-Consistency Improves Chain of Thought Reasoning*, arXiv:2203.11171 (2022).
- Du et al., *Improving Factuality and Reasoning in Language Models through Multiagent Debate*,
  arXiv:2305.14325 (2023).
- Liu et al., *Lost in the Middle: How Language Models Use Long Contexts*, arXiv:2307.03172 (2023).
- Fabbri et al., *SummEval: Re-evaluating Summarization Evaluation*, arXiv:2007.12626 (2020).
- Liu et al., *Revisiting the Gold Standard: Grounding Summarization Evaluation with Robust Human
  Evaluation* (Atomic Content Units / RoSE), arXiv:2212.07981 (2022).
- Song et al., *FineSurE: Fine-grained Summarization Evaluation using LLMs*, arXiv:2407.00908 (2024).

(Author attributions above are best-effort; verify the exact author list from each arXiv page before
citing in a submission. The IDs and titles are verified.)
