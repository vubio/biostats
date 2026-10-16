"""BioStats 0.1.0 computational engine.

Uses established scientific libraries. No custom approximations for p values.
The browser records the exact function names, arguments and versions.
"""
import json
from datetime import datetime, timezone

import numpy as np
import scipy
import statsmodels
from scipy import stats
from statsmodels.stats.oneway import anova_oneway
from statsmodels.stats.multicomp import pairwise_tukeyhsd


APP_VERSION = "0.1.0"


def _finite_number(x):
    value = float(x)
    if not np.isfinite(value):
        raise ValueError("All measurements must be finite numerical values")
    return value


def analyze(payload):
    """Analyze independent groups; return only JSON-serializable values."""
    if isinstance(payload, str):
        payload = json.loads(payload)
    groups = payload["groups"]
    test = payload["test"]
    alpha = float(payload.get("alpha", 0.05))
    if not (0 < alpha < 1):
        raise ValueError("Alpha must be between 0 and 1")
    if len(groups) < 2:
        raise ValueError("At least two groups are required")
    names = [str(g["name"]) for g in groups]
    if len(set(names)) != len(names):
        raise ValueError("Group names must be unique")
    data = [np.array([_finite_number(v) for v in g["values"]], dtype=float) for g in groups]
    if any(len(a) < 2 for a in data):
        raise ValueError("At least two observations are required per group")
    if test in ("ttest", "welch_ttest") and len(groups) != 2:
        raise ValueError("A two-group t test requires exactly two groups")
    if test in ("anova", "welch_anova", "kruskal") and len(groups) < 3:
        raise ValueError("Select a two-group test for exactly two groups")
    if any(not np.isfinite(a).all() for a in data):
        raise ValueError("Measurements must be finite")

    summaries = []
    for name, values in zip(names, data):
        n = len(values)
        sd = float(np.std(values, ddof=1))
        summaries.append({"group": name, "n": n, "mean": float(np.mean(values)),
                          "sd": sd, "sem": float(sd / np.sqrt(n)),
                          "median": float(np.median(values))})

    comps = []
    effect = None
    df = None
    func = None
    args = {}
    if test == "anova":
        out = stats.f_oneway(*data)
        stat = float(out.statistic)
        p_value = float(out.pvalue)
        df = [len(data) - 1, sum(len(a) for a in data) - len(data)]
        label = "Ordinary one-way ANOVA"
        func = "scipy.stats.f_oneway"
        args = {"assumption": "independent groups, equal population variances"}
        grand_mean = float(np.mean(np.concatenate(data)))
        ss_between = sum(len(a) * (float(np.mean(a)) - grand_mean) ** 2 for a in data)
        ss_within = sum(float(np.sum((a - np.mean(a)) ** 2)) for a in data)
        effect = {"name": "eta_squared", "value": float(ss_between / (ss_between + ss_within)) if ss_between + ss_within > 0 else None}
        measurements = np.concatenate(data)
        labels = np.concatenate([[name] * len(a) for name, a in zip(names, data)])
        post = pairwise_tukeyhsd(measurements, labels, alpha=alpha)
        # Pair ordering in statsmodels follows sorted unique group names.
        sorted_names = sorted(names)
        idx = 0
        for i in range(len(sorted_names) - 1):
            for j in range(i + 1, len(sorted_names)):
                ci = post.confint[idx]
                comps.append({"group1": sorted_names[i], "group2": sorted_names[j],
                              "difference": float(post.meandiffs[idx]),
                              "p_adjusted": float(post.pvalues[idx]),
                              "ci_low": float(ci[0]), "ci_high": float(ci[1]),
                              "reject": bool(post.reject[idx])})
                idx += 1
    elif test == "welch_anova":
        out = anova_oneway(data, use_var="unequal", welch_correction=True)
        stat, p_value = float(out.statistic), float(out.pvalue)
        df = [float(out.df[0]), float(out.df[1])]
        label = "Welch's one-way ANOVA"
        func = "statsmodels.stats.oneway.anova_oneway"
        args = {"use_var": "unequal", "welch_correction": True}
    elif test == "kruskal":
        out = stats.kruskal(*data)
        stat, p_value = float(out.statistic), float(out.pvalue)
        df = [len(data) - 1]
        label = "Kruskal–Wallis H test"
        func = "scipy.stats.kruskal"
        args = {"nan_policy": "propagate", "tie_correction": "included by scipy"}
    elif test in ("ttest", "welch_ttest"):
        equal_var = test == "ttest"
        out = stats.ttest_ind(data[0], data[1], equal_var=equal_var, alternative="two-sided")
        stat, p_value = float(out.statistic), float(out.pvalue)
        df = [float(out.df)]
        label = "Student's unpaired t test" if equal_var else "Welch's unpaired t test"
        func = "scipy.stats.ttest_ind"
        args = {"equal_var": equal_var, "alternative": "two-sided"}
    else:
        raise ValueError("Unrecognized test: " + str(test))
    if not (np.isfinite(stat) and np.isfinite(p_value)):
        raise ValueError("Test is undefined for these data; inspect variability and group values")

    return {
        "app_version": APP_VERSION,
        "test_id": test,
        "label": label,
        "statistic": stat,
        "p_value": p_value,
        "df": df,
        "alpha": alpha,
        "significant": bool(p_value < alpha),
        "group_summaries": summaries,
        "posthoc": {"method": "Tukey HSD", "comparisons": comps} if comps else None,
        "effect_size": effect,
        "engine": {
            "language": "Python",
            "python_packages": {"scipy": scipy.__version__, "statsmodels": statsmodels.__version__, "numpy": np.__version__},
            "primary_function": func,
            "primary_arguments": args,
            "posthoc_function": "statsmodels.stats.multicomp.pairwise_tukeyhsd" if comps else None,
            "posthoc_arguments": {"alpha": alpha} if comps else None,
        },
        "limitations": "Independent samples only; no automatic assumption validation. "
                       "No post hoc procedure yet for Welch or Kruskal–Wallis." if test != "anova" else
                       "Independent samples only; no automatic assumption validation.",
    }


def run_from_json(payload_json):
    return json.dumps(analyze(payload_json), allow_nan=False)
