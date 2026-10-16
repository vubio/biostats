"""Initial basic checks against independent reference tests; not publication-grade validation."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from engine import analyze

DATA=[{'name':'Control','values':[42,49,55,47,52]},
      {'name':'Drug A','values':[58,65,61,70,63]},
      {'name':'Drug B','values':[76,82,89,80,85]}]

def check(test, groups=DATA):
    out=analyze({'groups':groups,'test':test,'alpha':.05})
    assert 0<=out['p_value']<=1
    assert isinstance(out['engine']['python_packages']['scipy'],str)
    return out

def test_anova():
    result=check('anova')
    assert len(result['posthoc']['comparisons'])==3
    assert result['p_value']<.001

def test_welch():
    result=check('welch_anova')
    assert len(result['df'])==2

def test_kruskal():
    check('kruskal')

def test_ttest():
    check('ttest',DATA[:2]);check('welch_ttest',DATA[:2])

def test_reject_incorrect_group_count():
    try:
        check('ttest',DATA)
        assert False
    except ValueError:
        pass
