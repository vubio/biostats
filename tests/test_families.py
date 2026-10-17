"""Numerical reference and design-constraint tests for specialty modules."""
import math
import numpy as np
import pandas as pd
import pytest
from scipy import stats
from statsmodels.formula.api import ols
from statsmodels.stats.anova import anova_lm
from statsmodels.duration.survfunc import survdiff
from engine.families import analyze_family


def run(test, records):
    return analyze_family({'test':test,'family':test,'alpha':.05,'records':records})


def factorial_records():
    return [{'a':a,'b':b,'value':14+3*i+4*j+2*i*j+noise} for i,a in enumerate(['Vehicle','Drug'])
      for j,b in enumerate(['Low','High']) for noise in [-1.1,-.3,.3,1.1]]


def test_two_factor_reference():
    data=factorial_records(); res=run('two_factor',data)
    df=pd.DataFrame([{'a':r['a'],'b':r['b'],'value':r['value']} for r in data]); ref=anova_lm(ols('value ~ C(a)*C(b)',data=df).fit(),typ=2)
    for key,entry in zip(['C(a)','C(b)','C(a):C(b)'],res['effects']):
        assert math.isclose(entry['statistic'],ref.loc[key,'F'],rel_tol=1e-10)
        assert math.isclose(entry['p_value'],ref.loc[key,'PR(>F)'],rel_tol=1e-10)


def test_independent_group_time_and_unbalanced_rejected():
    data=[{'a':g,'b':str(t),'value':20+3*i+4*t+2*i*t+k*.8} for i,g in enumerate(['Control','Drug']) for t in [0,1,2] for k in range(3)]
    x=run('time_independent',data)
    assert len(x['effects'])==3
    with pytest.raises(ValueError,match='balanced'):run('time_independent',data[:-1])


def test_repeated_within_subject_and_missing_rejected():
    records=[{'subject':f'Mouse{i}','time':str(t),'value':i+t*(1+i*.5)} for i in range(1,7) for t in [0,1,2]]
    x=run('time_repeated',records)
    assert x['p_value']<.05 and x['df']==[2.,10.]
    with pytest.raises(ValueError,match='Complete'):run('time_repeated',records[:-1])


def test_logrank_reference_and_censoring():
    records=[{'subject':f'{g}{i}','group':g,'time':i*3+k*4,'event':int(i<6)} for k,g in enumerate(['Control','A','B']) for i in range(1,9)]
    x=run('survival_logrank',records)
    stat,p=survdiff(np.array([r['time'] for r in records]),np.array([r['event'] for r in records]),np.array([r['group'] for r in records]))
    assert math.isclose(x['statistic'],stat) and math.isclose(x['p_value'],p)
    assert len(x['posthoc']['comparisons'])==3
    assert sum(g['censored'] for g in x['survival'])==9
    with pytest.raises(ValueError,match='globally unique'):run('survival_logrank',records+[{**records[0], 'time':100}])


def test_4pl_known_ic50():
    doses=np.geomspace(.01,30,15)
    records=[{'group':'Drug A','dose':float(d),'value':float(10+90/(1+(d/.8)**1.25))} for d in doses]
    x=run('dose_4pl',records)
    assert x['p_value'] is None
    assert x['fits'][0]['ic50']==pytest.approx(.8,rel=1e-5)
    assert x['fits'][0]['hill']==pytest.approx(1.25,rel=1e-5)
    assert x['fits'][0]['r_squared']>.9999
    with pytest.raises(ValueError,match='positive'):run('dose_4pl',records+[{'group':'Drug A','dose':0,'value':90}])


def test_reject_non_decreasing_dose_curve():
    doses=np.geomspace(.01,10,10)
    records=[{'group':'Drug','dose':float(d),'value':float(10+80*d/(1+d))} for d in doses]
    with pytest.raises(ValueError):run('dose_4pl',records)
