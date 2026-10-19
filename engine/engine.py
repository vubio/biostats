"""BioStats 0.4.0 computational engine.

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
from statsmodels.stats.multitest import multipletests


APP_VERSION = "0.6.0"


def _finite_number(x):
    value = float(x)
    if not np.isfinite(value):
        raise ValueError("All measurements must be finite numerical values")
    return value


def analyze(payload):
    """Analyze independent groups; return only JSON-serializable values."""
    if isinstance(payload, str):
        payload = json.loads(payload)
    if payload.get("family", "groups") != "groups":
        return analyze_family(payload)
    groups = payload["groups"]
    test = payload["test"]
    alternative = payload.get("alternative", "two-sided")
    if alternative not in ("two-sided", "greater", "less"):
        raise ValueError("Alternative must be two-sided, greater, or less")
    if test not in ("ttest", "welch_ttest", "paired_ttest") and alternative != "two-sided":
        raise ValueError("One-sided alternatives apply only to t tests")
    alpha = float(payload.get("alpha", 0.05))
    if not (0 < alpha < 1):
        raise ValueError("Alpha must be between 0 and 1")
    if len(groups) < 2:
        raise ValueError("At least two groups are required")
    names = [str(g["name"]) for g in groups]
    if len(set(names)) != len(names):
        raise ValueError("Group names must be unique")
    data = [np.array([_finite_number(v) for v in g["values"]], dtype=float) for g in groups]
    if any(len(a) < (1 if test == 'summary' else 2) for a in data):
        raise ValueError('At least one observation is required for descriptive summaries; inferential tests require at least two per group')
    if test in ("ttest", "welch_ttest", "paired_ttest") and len(groups) != 2:
        raise ValueError("A two-group t test requires exactly two groups")
    if test in ("anova", "welch_anova", "kruskal") and len(groups) < 3:
        raise ValueError("Select a two-group test for exactly two groups")
    if test == "paired_ttest" and len(data[0]) != len(data[1]):
        raise ValueError("Paired groups must contain equal numbers of observations")
    if any(not np.isfinite(a).all() for a in data):
        raise ValueError("Measurements must be finite")

    summaries = []
    for name, values in zip(names, data):
        n = len(values)
        sd = float(np.std(values, ddof=1)) if n>1 else None
        summaries.append({"group": name, "n": n, "mean": float(np.mean(values)),
                          "sd": sd, "sem": float(sd / np.sqrt(n)) if n>1 else None,
                          "median": float(np.median(values))})

    comps = []
    posthoc_method = None
    posthoc_function = None
    posthoc_arguments = None
    effect = None
    df = None
    func = None
    args = {}
    if test == 'summary':
        return {'app_version': APP_VERSION, 'test_id': test, 'label':'Descriptive group summary (no hypothesis test)',
          'statistic':None,'p_value':None,'df':[],'alpha':alpha,'alternative':'two-sided',
          'significant':None,'group_summaries':summaries,'posthoc':None,'effect_size':None,
          'engine':{'language':'Python','python_packages':{'numpy':np.__version__, 'scipy':scipy.__version__, 'statsmodels':statsmodels.__version__},
          'primary_function':'numpy.mean / numpy.std','primary_arguments':{'ddof':1,'single_measurement_sd':None},
          'posthoc_function':None,'posthoc_arguments':None},
          'limitations':'Descriptive summary only; no P value or inferential comparison. SD/SEM are undefined for one replicate. Technical wells are not automatically independent biological replicates.'}
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
        posthoc_method = "Tukey HSD (all pairs; familywise adjusted)"
        posthoc_function = "statsmodels.stats.multicomp.pairwise_tukeyhsd"
        posthoc_arguments = {"alpha": alpha}
        # Pair ordering in statsmodels follows sorted unique group names.
        sorted_names = sorted(names)
        idx = 0
        for i in range(len(sorted_names) - 1):
            for j in range(i + 1, len(sorted_names)):
                ci = post.confint[idx]
                comps.append({"group1": sorted_names[i], "group2": sorted_names[j],
                              "difference": float(post.meandiffs[idx]),
                              "p_raw": None, "p_adjusted": float(post.pvalues[idx]),
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
        out = stats.ttest_ind(data[0], data[1], equal_var=equal_var, alternative=alternative)
        stat, p_value = float(out.statistic), float(out.pvalue)
        df = [float(out.df)]
        label = "Student's unpaired t test" if equal_var else "Welch's unpaired t test"
        func = "scipy.stats.ttest_ind"
        args = {"equal_var": equal_var, "alternative": alternative}
    elif test == "paired_ttest":
        out = stats.ttest_rel(data[0], data[1], alternative=alternative)
        stat, p_value = float(out.statistic), float(out.pvalue)
        df = [float(out.df)]
        label = "Paired t test"
        func = "scipy.stats.ttest_rel"
        args = {"alternative": alternative, "matching": "row-wise pairs, first group minus second group",
                "subject_ids_recorded": bool(payload.get("subject_ids"))}
    else:
        raise ValueError("Unrecognized test: " + str(test))
    if not (np.isfinite(stat) and np.isfinite(p_value)):
        raise ValueError("Test is undefined for these data; inspect variability and group values")

    # The omnibus tests do not identify which groups differ. For the Welch and
    # Kruskal branches, conduct established pairwise tests and adjust *all*
    # possible pairwise P values as one Holm family. This is NOT Games–Howell
    # or Dunn's test; the distinction is reported explicitly.
    if test in ("welch_anova", "kruskal"):
        pairs = []
        raw = []
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                if test == "welch_anova":
                    out = stats.ttest_ind(data[i], data[j], equal_var=False, alternative="two-sided")
                    method = "Welch independent t tests + Holm adjustment"
                    function = "scipy.stats.ttest_ind"
                    params = {"equal_var": False, "alternative": "two-sided"}
                else:
                    out = stats.mannwhitneyu(data[i], data[j], alternative="two-sided", method="auto")
                    method = "Pairwise Mann–Whitney U + Holm adjustment (not Dunn's)"
                    function = "scipy.stats.mannwhitneyu"
                    params = {"alternative": "two-sided", "method": "auto"}
                if not np.isfinite(out.pvalue):
                    raise ValueError("A pairwise comparison is undefined for these data")
                raw.append(float(out.pvalue))
                pairs.append((i,j,float(out.statistic),float(out.df) if hasattr(out, "df") else None))
        adjusted = multipletests(raw, alpha=alpha, method="holm")[1]
        for (i,j,teststat,pair_df),p,p_adj in zip(pairs,raw,adjusted):
            comps.append({"group1": names[i], "group2": names[j], "difference": float(np.mean(data[j])-np.mean(data[i])),
                          "p_raw": p, "p_adjusted": float(p_adj), "statistic": teststat,
                          "df": pair_df, "ci_low": None, "ci_high": None, "reject": bool(p_adj < alpha)})
        posthoc_method = method
        posthoc_function = function + " + statsmodels.stats.multitest.multipletests"
        posthoc_arguments = {"pairwise_test": params, "adjustment": "holm", "adjusted_family": "all pairwise comparisons", "pairs": len(pairs)}
    elif test in ("ttest", "welch_ttest", "paired_ttest"):
        comps = [{"group1":names[0], "group2":names[1], "difference":float(np.mean(data[1])-np.mean(data[0])),
                  "p_raw":p_value, "p_adjusted":p_value, "ci_low":None, "ci_high":None,
                  "reject":bool(p_value < alpha), "statistic":stat, "df":df[0]}]
        posthoc_method = "Single planned comparison (no multiplicity adjustment)"
        posthoc_function = func
        posthoc_arguments = args

    return {
        "app_version": APP_VERSION,
        "test_id": test,
        "label": label,
        "statistic": stat,
        "p_value": p_value,
        "df": df,
        "alpha": alpha,
        "alternative": alternative,
        "subject_ids": payload.get("subject_ids") if test == "paired_ttest" else None,
        "significant": bool(p_value < alpha),
        "group_summaries": summaries,
        "posthoc": {"method": posthoc_method, "comparisons": comps,
                    "family": "all_pairs" if test in ("anova", "welch_anova", "kruskal") else "single"} if comps else None,
        "effect_size": effect,
        "engine": {
            "language": "Python",
            "python_packages": {"scipy": scipy.__version__, "statsmodels": statsmodels.__version__, "numpy": np.__version__},
            "primary_function": func,
            "primary_arguments": args,
            "posthoc_function": posthoc_function,
            "posthoc_arguments": posthoc_arguments,
        },
        "limitations": ("Matched measurements: the paired t test assumes approximately normal paired differences; "
                        "matching is by row and is not an independent-samples test." if test == "paired_ttest" else
                        "Independent samples; check distributions, variance, and the experimental unit. "
                        "Welch ANOVA is followed by pairwise Welch t tests with Holm adjustment across all pairs (not Games–Howell). Kruskal–Wallis is followed by pairwise Mann–Whitney U tests with Holm adjustment (not Dunn's); pairwise rank tests address distributional differences, not necessarily medians. Only prespecified comparisons should be interpreted." if test in ("welch_anova", "kruskal") else
                        "Independent samples; assess assumptions and biological replication."),
    }


def run_from_json(payload_json):
    return json.dumps(analyze(payload_json), allow_nan=False)
