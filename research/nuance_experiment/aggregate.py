import json, glob
from collections import defaultdict

results = defaultdict(list)
for f in sorted(glob.glob("results/*.json")):
    with open(f) as fh:
        d = json.load(fh)
    arm = d.get("arm", "?")
    density = d.get("density", "?")
    corr = d.get("correctness", 0)
    ledger = d.get("ledger_recall", 0)
    viol = d.get("n_violations", 0)
    n_calls = d.get("cost", {}).get("n_calls", 0)
    prompt_tok = d.get("cost", {}).get("prompt_tokens", 0)
    gen_tok = d.get("cost", {}).get("gen_tokens", 0)
    total_tok = prompt_tok + gen_tok
    failed = d.get("cost", {}).get("any_call_failed", False)
    results[(arm, density)].append((corr, ledger, viol, total_tok, n_calls, failed))

arms = ["single_small", "single_large", "decomp_noNM", "decomp_NM", "self_moa"]
densities = ["low", "mid", "high"]

header = "{:<16} {:<8} {:>6} {:>7} {:>5} {:>7} {:>6} {:>5}  n".format(
    "arm", "density", "corr", "ledger", "viol", "tokens", "calls", "fails"
)
print(header)
print("=" * 72)
for arm in arms:
    for density in densities:
        rows = results.get((arm, density), [])
        if not rows:
            continue
        n = len(rows)
        ac = sum(r[0] for r in rows) / n
        al = sum(r[1] for r in rows) / n
        av = sum(r[2] for r in rows) / n
        at = sum(r[3] for r in rows) / n
        acalls = sum(r[4] for r in rows) / n
        af = sum(1 for r in rows if r[5])
        print(
            "{:<16} {:<8} {:>6.2f} {:>7.2f} {:>5.1f} {:>7.0f} {:>6.1f} {:>5}  {}".format(
                arm, density, ac, al, av, at, acalls, af, n
            )
        )
    print()