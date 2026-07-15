"""
run_experiment.py -- test the core Project Zora research claim:

  Does  decompose -> small workers -> aggregate -> Nuance Manager  match a single
  large model, more cheaply, and does the gain grow with cross-chunk dependency density?

Arms (see research/nuance-manager-architecture.md sec 4.1):
  A  single_large   one call, full context, strongest model            (quality/cost ceiling)
  B  single_small   one call, full context, small model                (naive-cheap baseline)
  C  decomp_noNM    chunk -> workers -> rule-blind aggregate            (decomposition alone)
  D  decomp_NM      chunk -> workers -> aggregate -> Nuance Manager     (the full system)
  E  self_moa       N samples of the small model, aggregated            (confronts Self-MoA 2502.00674)

Scoring is deterministic (metrics.py). Results checkpoint per (task, arm, seed) into results/
so the run is fully RESUMABLE -- re-running skips finished cells. This is why it is safe to
launch as a detached job (which you MUST -- a full sweep outlives a tool-call timeout).

Usage (ALWAYS detached -- never in a foreground tool call):
  node C:\\Users\\shaya\\.openclaw\\scripts\\job.mjs start \\
    --name "zora nuance exp" \\
    --cmd "python run_experiment.py --arms A,B,C,D,E --seeds 3" \\
    --cwd C:\\Users\\shaya\\.openclaw\\workspace\\project-zora\\research\\nuance_experiment

Quick smoke (1 task, 1 seed, cheap arms only) is fine inline:
  python run_experiment.py --arms B,C,D --seeds 1 --limit 1
"""
import argparse
import json
import os
import re
import sys
import time
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
RESULTS_DIR = os.path.join(HERE, "results")
TASKS_PATH = os.path.join(HERE, "tasks.jsonl")
TIMEOUT_SEC = int(os.environ.get("ZORA_TIMEOUT", "300"))

# Model roles -- edit to taste / sweep. These names exist on this box (ollama /api/tags).
MODELS = {
    "small": os.environ.get("ZORA_SMALL", "gemma4:e2b"),
    "mid":   os.environ.get("ZORA_MID",   "gemma4:e4b"),
    "large": os.environ.get("ZORA_LARGE", "gemma4:31b-cloud"),
}
# The Nuance Manager model is swept separately so you can answer "how small can the manager be?"
MANAGER_MODEL = os.environ.get("ZORA_MANAGER", MODELS["large"])
SELF_MOA_N = int(os.environ.get("ZORA_MOA_N", "3"))

BLOCKS = ("morning", "afternoon", "evening")

PLAN_SCHEMA_HINT = (
    'Output ONLY a JSON object with exactly these keys: "morning", "afternoon", "evening". '
    'Each value is a list of item id strings. Schedule each relevant item into exactly one block. '
    'No prose, no markdown fences.'
)


# ----------------------------------------------------------------------------- ollama
def call(model, system, prompt, num_predict=700, temperature=0.2):
    t0 = time.time()
    payload = {
        "model": model, "system": system, "prompt": prompt, "stream": False,
        "options": {"temperature": temperature, "num_predict": num_predict, "num_ctx": 8192},
    }
    try:
        r = requests.post(OLLAMA_URL, json=payload, timeout=TIMEOUT_SEC)
        r.raise_for_status()
        d = r.json()
        return {"text": d.get("response", ""), "latency": round(time.time() - t0, 2),
                "prompt_tokens": d.get("prompt_eval_count", 0), "gen_tokens": d.get("eval_count", 0),
                "ok": True, "error": None}
    except Exception as e:
        return {"text": "", "latency": round(time.time() - t0, 2), "prompt_tokens": 0,
                "gen_tokens": 0, "ok": False, "error": str(e)}


def strip_think(t):
    return re.sub(r"<think>[\s\S]*?</think>", "", t or "", flags=re.I).strip()


def extract_json(text):
    """Balanced-bracket extraction of the first JSON object/array; strips think tags first."""
    text = strip_think(text)
    if not text:
        return None
    text = re.sub(r"```(?:json)?", "", text).replace("```", "")
    start = min([i for i in (text.find("{"), text.find("[")) if i != -1] or [-1])
    if start < 0:
        return None
    opener = text[start]
    closer = "}" if opener == "{" else "]"
    depth = 0; instr = False; esc = False
    for i in range(start, len(text)):
        c = text[i]
        if esc: esc = False; continue
        if c == "\\" and instr: esc = True; continue
        if c == '"': instr = not instr; continue
        if instr: continue
        if c == opener: depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                try: return json.loads(text[start:i + 1])
                except Exception: return None
    return None


# ----------------------------------------------------------------------------- context rendering
def render_full_context(task):
    ctx = task["context"]
    lines = [f"Today: {task['date']}", "", "EVENTS:"]
    for e in ctx.get("events", []):
        lines.append(f'  {e["id"]}: {e.get("start","?")}-{e.get("end","?")} strict={e.get("strict",False)}')
    lines.append("TASKS:")
    for t in ctx.get("tasks", []):
        lines.append(f'  {t["id"]}: due_in_h={t.get("due_in_h","?")}')
    lines.append("PROJECTS:")
    for p in ctx.get("projects", []):
        lines.append(f'  {p["id"]}')
    lines.append("RULES:")
    for r in task.get("rules", []):
        lines.append(f"  - {r}")
    return "\n".join(lines)


def all_item_ids(task):
    ctx = task["context"]
    ids = [e["id"] for e in ctx.get("events", [])]
    ids += [t["id"] for t in ctx.get("tasks", [])]
    ids += [p["id"] for p in ctx.get("projects", [])]
    return ids


def category_chunks(task):
    """Naive category split (Calendar / Tasks / Projects) -- the README's original design.
    Deliberately rule-BLIND at the worker level: this is what severs cross-chunk nuance."""
    ctx = task["context"]
    return {
        "calendar": [f'{e["id"]}: {e.get("start","?")}-{e.get("end","?")} strict={e.get("strict",False)}'
                     for e in ctx.get("events", [])],
        "tasks":    [f'{t["id"]}: due_in_h={t.get("due_in_h","?")}' for t in ctx.get("tasks", [])],
        "projects": [p["id"] for p in ctx.get("projects", [])],
    }


# ----------------------------------------------------------------------------- arms
def arm_single(task, model, seed):
    sysmsg = "You are a day planner. " + PLAN_SCHEMA_HINT
    prompt = render_full_context(task) + "\n\nSchedule every relevant item into morning/afternoon/evening, respecting ALL rules."
    res = call(model, sysmsg, prompt, temperature=0.2 + 0.05 * seed)
    return extract_json(res["text"]) or {}, [res]


def _worker_place(task, chunk_name, items, seed):
    sysmsg = ("You place scheduling items into day blocks. "
              'Output ONLY JSON: {"morning":[ids],"afternoon":[ids],"evening":[ids]}. No prose.')
    prompt = (f"Today: {task['date']}\nYou handle only the '{chunk_name}' items below. "
              f"Place each into a sensible block.\n\nITEMS:\n" + "\n".join(f"  {x}" for x in items))
    res = call(MODELS["small"], sysmsg, prompt, num_predict=400, temperature=0.2 + 0.05 * seed)
    return extract_json(res["text"]) or {}, res


def _aggregate(partials):
    """Rule-BLIND structural merge of worker outputs -- identical in arms C and D so that
    D minus C isolates exactly the Nuance Manager's contribution."""
    plan = {b: [] for b in BLOCKS}
    for part in partials:
        if not isinstance(part, dict):
            continue
        for b in BLOCKS:
            for it in (part.get(b) or []):
                it = str(it).strip()
                if it and it not in plan[b]:
                    plan[b].append(it)
    return plan


def arm_decomp(task, seed, use_manager):
    calls = []
    chunks = category_chunks(task)
    partials = []
    for name, items in chunks.items():
        if not items:
            continue
        part, res = _worker_place(task, name, items, seed)
        calls.append(res)
        partials.append(part)
    plan = _aggregate(partials)
    if not use_manager:
        return plan, calls
    # Nuance Manager: sees the RULES (the cross-chunk nuance the workers never saw) + the merged
    # plan, and repairs violations. Mirrors backend/nuance-agent.js (patch-with-evidence), but here
    # it emits a corrected plan directly so scoring stays deterministic.
    sysmsg = ("You are a Nuance Manager. The plan below was assembled by small agents that each saw "
              "only part of the context and NONE of the rules. Fix any rule violation. "
              + PLAN_SCHEMA_HINT)
    rules = "\n".join(f"  - {r}" for r in task.get("rules", []))
    prompt = (f"Today: {task['date']}\n\nALL RULES:\n{rules}\n\n"
              f"ALL ITEM IDS: {', '.join(all_item_ids(task))}\n\n"
              f"MERGED PLAN (may violate rules):\n{json.dumps(plan)}\n\n"
              "Return the corrected plan that satisfies every rule. Keep valid placements; change only what must change.")
    res = call(MANAGER_MODEL, sysmsg, prompt, num_predict=700, temperature=0.1)
    calls.append(res)
    fixed = extract_json(res["text"])
    return (fixed if isinstance(fixed, dict) and fixed else plan), calls


def arm_self_moa(task, seed):
    """N samples of the SMALL model, aggregated by per-item majority block. Confronts Self-MoA."""
    calls = []
    samples = []
    for k in range(SELF_MOA_N):
        plan, cs = arm_single(task, MODELS["small"], seed * 10 + k)
        samples.append(plan)
        calls.extend(cs)
    # majority vote: for each item, the block it most often landed in
    tally = {}
    for s in samples:
        for b in BLOCKS:
            for it in (s.get(b) or []) if isinstance(s, dict) else []:
                tally.setdefault(str(it), {}).setdefault(b, 0)
                tally[str(it)][b] += 1
    plan = {b: [] for b in BLOCKS}
    for it, counts in tally.items():
        best = max(counts, key=counts.get)
        plan[best].append(it)
    return plan, calls


ARMS = {
    "A": ("single_large", lambda t, s: arm_single(t, MODELS["large"], s)),
    "B": ("single_small", lambda t, s: arm_single(t, MODELS["small"], s)),
    "C": ("decomp_noNM",  lambda t, s: arm_decomp(t, s, use_manager=False)),
    "D": ("decomp_NM",    lambda t, s: arm_decomp(t, s, use_manager=True)),
    "E": ("self_moa",     lambda t, s: arm_self_moa(t, s)),
}


# ----------------------------------------------------------------------------- driver
def main():
    import metrics
    ap = argparse.ArgumentParser()
    ap.add_argument("--arms", default="A,B,C,D,E")
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--limit", type=int, default=0, help="max tasks (0 = all)")
    args = ap.parse_args()

    os.makedirs(RESULTS_DIR, exist_ok=True)
    tasks = [json.loads(l) for l in open(TASKS_PATH, encoding="utf-8") if l.strip()]
    if args.limit:
        tasks = tasks[:args.limit]
    arm_keys = [a.strip().upper() for a in args.arms.split(",") if a.strip()]

    print(f"[exp] models={MODELS} manager={MANAGER_MODEL} arms={arm_keys} seeds={args.seeds} tasks={len(tasks)}")
    agg = {}  # (arm_name, density) -> list of metric dicts
    for task in tasks:
        for ak in arm_keys:
            arm_name, fn = ARMS[ak]
            for seed in range(args.seeds):
                ckpt = os.path.join(RESULTS_DIR, f"{task['id']}__{arm_name}__seed{seed}.json")
                if os.path.exists(ckpt):
                    rec = json.load(open(ckpt, encoding="utf-8"))
                else:
                    try:
                        plan, calls = fn(task, seed)
                    except Exception as e:
                        plan, calls = {}, [{"ok": False, "error": f"arm raised: {e}"}]
                    m = metrics.score(plan, task["gold_constraints"])
                    cost = {
                        "n_calls": len(calls),
                        "latency_s": round(sum(c.get("latency", 0) for c in calls), 2),
                        "prompt_tokens": sum(c.get("prompt_tokens", 0) for c in calls),
                        "gen_tokens": sum(c.get("gen_tokens", 0) for c in calls),
                        "any_call_failed": any(not c.get("ok", False) for c in calls),
                    }
                    rec = {"task": task["id"], "density": task["dependency_density"], "arm": arm_name,
                           "seed": seed, "correctness": m["correctness"], "ledger_recall": m["ledger_recall"],
                           "n_violations": m["n_violations"], "cost": cost, "detail": m["detail"]}
                    json.dump(rec, open(ckpt, "w", encoding="utf-8"), indent=2)
                    print(f"  {task['id']:18} {arm_name:14} seed{seed}  "
                          f"corr={rec['correctness']:.2f} ledger={rec['ledger_recall']} "
                          f"tok={cost['prompt_tokens']+cost['gen_tokens']:6} calls={cost['n_calls']}"
                          + ("  [CALL FAILED]" if cost["any_call_failed"] else ""))
                agg.setdefault((arm_name, task["dependency_density"]), []).append(rec)

    # ------- summary
    print("\n" + "=" * 78)
    print(f"{'arm':14} {'density':8} {'corr':>6} {'ledger':>7} {'viol':>5} {'tokens':>8} {'calls':>6}")
    print("-" * 78)
    def mean(xs):
        xs = [x for x in xs if x is not None]
        return sum(xs) / len(xs) if xs else float("nan")
    for (arm_name, density), recs in sorted(agg.items()):
        print(f"{arm_name:14} {density:8} "
              f"{mean([r['correctness'] for r in recs]):6.2f} "
              f"{mean([r['ledger_recall'] for r in recs]):7.2f} "
              f"{mean([r['n_violations'] for r in recs]):5.1f} "
              f"{mean([r['cost']['prompt_tokens']+r['cost']['gen_tokens'] for r in recs]):8.0f} "
              f"{mean([r['cost']['n_calls'] for r in recs]):6.1f}")
    print("=" * 78)
    print("Interpretation: D - C = Nuance Manager value; C - B = decomposition value; "
          "A - D = gap to the big model. Watch these grow with density (low->high).")
    print(f"Per-cell JSON in: {RESULTS_DIR}")


if __name__ == "__main__":
    main()
