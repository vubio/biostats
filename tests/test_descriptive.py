from engine.engine import analyze

def test_descriptive_single_well_no_p():
    r=analyze({'test':'summary','groups':[{'name':'0','values':[100]},{'name':'0.05','values':[80]}]})
    assert r['p_value'] is None
    assert r['statistic'] is None
    assert r['group_summaries'][0]['n']==1
    assert r['group_summaries'][0]['sd'] is None

def test_descriptive_3_wells():
    r=analyze({'test':'summary','groups':[{'name':'0','values':[100,110,90]},{'name':'0.05','values':[80,75,85]}]})
    assert r['group_summaries'][0]['mean']==100
    assert r['group_summaries'][1]['mean']==80
