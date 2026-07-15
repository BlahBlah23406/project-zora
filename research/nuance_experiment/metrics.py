"""
metrics.py -- objective, deterministic scoring for the Nuance-Manager experiment.

A "plan" is a dict: {"morning": [ids], "afternoon": [ids], "evening": [ids]}.
Every gold constraint is a small, checkable spec (see tasks.jsonl). Correctness and
nuance-preservation are therefore computed by CODE, not by an LLM judge -- so the
numbers can't be gamed by a model that merely *talks about* a constraint without
satisfying it. (See research/nuance-manager-architecture.md sec 4.2 for the rationale,
and the "103% coverage" trap it avoids.)
"""

BLOCK_ORDER = {"morning": 0, "afternoon": 1, "evening": 2}
BLOCKS = ("morning", "afternoon", "evening")


def normalize_plan(plan):
    """Coerce a model's (possibly messy) plan dict into {block: [ids]} with lowercased keys."""
    out = {b: [] for b in BLOCKS}
    if not isinstance(plan, dict):
        return out
    for k, v in plan.items():
        kb = str(k).strip().lower()
        if kb in out and isinstance(v, list):
            out[kb] = [str(x).strip() for x in v if str(x).strip()]
    return out


def _present(plan, item):
    return any(item in plan[b] for b in BLOCKS)


def _block_of(plan, item):
    for b in BLOCKS:
        if item in plan[b]:
            return b
    return None


def check_constraint(plan, c):
    """Return True if the plan satisfies gold constraint `c`. Deterministic."""
    t = c.get("type")
    if t == "require_present":
        return _present(plan, c["item"])
    if t == "mutual_exclusion":
        # at most one of the listed items may be scheduled
        return sum(1 for it in c["items"] if _present(plan, it)) <= 1
    if t == "forbid_in_block":
        return c["item"] not in plan.get(c["block"], [])
    if t == "order_before":
        ba, bb = _block_of(plan, c["first"]), _block_of(plan, c["second"])
        # only enforceable if both are scheduled; if the dependent (second) is present,
        # the prerequisite (first) must be present and in an earlier-or-equal block.
        if bb is None:
            return True  # dependent not scheduled -> vacuously fine
        if ba is None:
            return False  # dependent scheduled but prerequisite missing
        return BLOCK_ORDER[ba] < BLOCK_ORDER[bb]
    if t == "not_same_block":
        blocks = [_block_of(plan, it) for it in c["items"]]
        present = [b for b in blocks if b is not None]
        return len(present) == len(set(present))  # no two share a block
    # unknown constraint type -> do not silently pass
    return False


def score(plan_raw, gold_constraints):
    """
    Returns a dict of the four experiment metrics for one (task, arm) output.
      - correctness:   fraction of ALL gold constraints satisfied
      - ledger_recall: fraction of CROSS-CHUNK constraints satisfied (the nuance metric)
      - n_violations:  count of violated gold constraints
      - detail:        per-constraint pass/fail (for debugging)
    """
    plan = normalize_plan(plan_raw)
    detail = []
    for c in gold_constraints:
        ok = check_constraint(plan, c)
        detail.append({"desc": c.get("desc", c.get("type")), "cross_chunk": bool(c.get("cross_chunk")), "ok": ok})

    total = len(gold_constraints)
    passed = sum(1 for d in detail if d["ok"])
    cross = [d for d in detail if d["cross_chunk"]]
    cross_passed = sum(1 for d in cross if d["ok"])

    return {
        "correctness": passed / total if total else 1.0,
        "ledger_recall": (cross_passed / len(cross)) if cross else None,
        "n_violations": total - passed,
        "normalized_plan": plan,
        "detail": detail,
    }


if __name__ == "__main__":
    # tiny self-test
    p = {"morning": ["task_prep"], "afternoon": ["evt_class", "task_hw"], "evening": ["proj_zora"]}
    gold = [
        {"type": "require_present", "item": "task_hw", "cross_chunk": True},
        {"type": "mutual_exclusion", "items": ["evt_meeting", "evt_class"], "cross_chunk": True},
        {"type": "order_before", "first": "task_prep", "second": "proj_zora", "cross_chunk": True},
        {"type": "not_same_block", "items": ["proj_robotics", "proj_zora"], "cross_chunk": True},
    ]
    import json
    print(json.dumps(score(p, gold), indent=2))
