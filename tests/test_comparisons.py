"""Independent numerical reference checks for multi-group pairwise comparisons."""
import math
from itertools import combinations
import pytest
from scipy import stats
from statsmodels.stats.multitest import multipletests
from engine.engine import analyze

BASE = [[40,42,45,39,43],[50,52,54,51,53],[55,59,58,57,60],[69,73,71,74,72]]


def payload(method, values=BASE):
    return {'test': method, 'groups':[{'name':f'G{i}', 'values':a} for i,a in enumerate(values)],'alpha':.05}


def test_tukey_complete_four_groups_and_no_separate_raw_p():
    result = analyze(payload('anova'))
    assert len(result['posthoc']['comparisons']) == 6
    assert result['posthoc']['family']=='all_pairs'
    assert 'Tukey' in result['posthoc']['method']
    assert all(x['p_raw'] is None for x in result['posthoc']['comparisons'])
    assert all(0 <= x['p_adjusted'] <= 1 for x in result['posthoc']['comparisons'])


def test_welch_holm_adjusted_over_all_six_pairs():
    result=analyze(payload('welch_anova'))
    raw=[stats.ttest_ind(BASE[i], BASE[j],equal_var=False).pvalue for i,j in combinations(range(4),2)]
    expected=multipletests(raw, method='holm')[1]
    assert len(result['posthoc']['comparisons'])==6
    for c,p,q in zip(result['posthoc']['comparisons'], raw,expected):
        assert math.isclose(c['p_raw'],p,rel_tol=1e-12)
        assert math.isclose(c['p_adjusted'],q,rel_tol=1e-12)
    assert result['engine']['posthoc_arguments']['adjustment']=='holm'


def test_kruskal_holm_mannwhitney_all_pairs():
    result=analyze(payload('kruskal'))
    raw=[stats.mannwhitneyu(BASE[i],BASE[j],method='auto').pvalue for i,j in combinations(range(4),2)]
    expected=multipletests(raw,method='holm')[1]
    for c,q in zip(result['posthoc']['comparisons'], expected):
        assert math.isclose(c['p_adjusted'],q,rel_tol=1e-12)
    assert "Dunn" in result['posthoc']['method']


def test_paired_ttest_has_one_comparison_matching_primary():
    result=analyze({'test':'paired_ttest','groups':[{'name':'Before','values':[30,28,32]},
                {'name':'After','values':[26,25,29]}],'alternative':'two-sided'})
    c=result['posthoc']['comparisons'][0]
    assert c['p_adjusted']==result['p_value']
    assert c['p_raw']==result['p_value']
