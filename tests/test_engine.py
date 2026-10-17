"""Reference-level smoke tests for deterministic statistics; synthetic examples only."""
import math
from scipy import stats
from engine.engine import analyze


def test_paired_two_sided():
    a, b = [26, 31, 28, 30, 32], [21, 26, 25, 24, 28]
    inp = {'groups':[{'name':'Before','values':a},{'name':'After','values':b}],
           'subject_ids':[f'Mouse{i}' for i in range(5)],'test':'paired_ttest',
           'alpha':0.05,'alternative':'two-sided'}
    result = analyze(inp)
    assert result['p_value'] == stats.ttest_rel(a,b).pvalue
    assert result['engine']['primary_arguments']['matching'].startswith('row-wise')


def test_unpaired_directional():
    a, b = [39,42,40,44,41],[30,31,32,28,33]
    base = {'groups':[{'name':'Treatment','values':a},{'name':'Control','values':b}],
            'test':'ttest','alpha':0.05}
    right=analyze({**base,'alternative':'greater'})
    wrong=analyze({**base,'alternative':'less'})
    assert math.isclose(right['p_value'],stats.ttest_ind(a,b,alternative='greater').pvalue)
    assert right['p_value']<wrong['p_value']


def test_welch_two_sided():
    a,b=[18,19,20,21,22],[24,26,33,39,42,48]
    r=analyze({'groups':[{'name':'A','values':a},{'name':'B','values':b}],
               'test':'welch_ttest','alternative':'two-sided'})
    assert r['p_value']==stats.ttest_ind(a,b,equal_var=False).pvalue


def test_wrong_group_count_fails():
    import pytest
    with pytest.raises(ValueError):
        analyze({'groups':[{'name':'A','values':[1,2]},{'name':'B','values':[3,4]},{'name':'C','values':[5,6]}],
                 'test':'paired_ttest'})
