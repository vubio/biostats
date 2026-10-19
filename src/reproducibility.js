// Reproducible minimal Python replay of the selected scientific method.
// Underlying tests ALWAYS call SciPy/statsmodels. No p-value formulas are rewritten.
// This export is not a verbatim source-code extractor; it assembles only the
// relevant package calls and arguments that the engine recorded for this analysis.
const pythonString=x=>JSON.stringify(String(x??''));
const pyJson=x=>`json.loads(${pythonString(JSON.stringify(x))})`;
const common=`#!/usr/bin/env python3
"""BioStats: focused, independently runnable analysis replay.
Install: python -m pip install numpy pandas scipy statsmodels matplotlib
Place input.csv beside this script. Run: python reproduce.py
Run this script with the *recorded* package versions for closest numerical agreement.
For the exact archived appearance, use the saved original figure.svg.
"""
import csv
import json
from pathlib import Path
import numpy as np
import pandas as pd
import scipy
import statsmodels
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy import stats

HERE = Path(__file__).resolve().parent
INPUT = HERE / 'input.csv'
if not INPUT.exists():
    raise SystemExit('input.csv is required. Export/retain exact analyzed values; the original source cannot be reconstructed from a hash.')
with INPUT.open(newline='',encoding='utf-8-sig') as f:
    table = list(csv.reader(f))
if not table or len(table)<2:
    raise SystemExit('input.csv has no measurements.')

`;
const readGroups=`labels = [x.strip() for x in table[0]]
groups = {}
for col, label in enumerate(labels):
    groups[label] = np.array([float(row[col]) for row in table[1:]
                              if col < len(row) and str(row[col]).strip()],dtype=float)
for label, values in groups.items():
    print(f'{label}: n={len(values)}; mean={values.mean():.6g}; SD={values.std(ddof=1) if len(values)>1 else 0:.6g}')
`;
const parseXY=`import re
records = []
for name, values in groups.items():
    m = re.fullmatch(r'(.+?)\\s*\\|\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)', name)
    if not m:
        raise ValueError(f'Expected Condition | Dose, received {name!r}')
    condition, dose = m.group(1).strip(), float(m.group(2))
    records.extend({'factor_a':condition,'factor_b':str(dose),'dose':dose,'value':float(v)} for v in values)
df = pd.DataFrame(records)
`;
const plotGeneric=`
# The plot below is scientifically equivalent, but not pixel-identical to
# the original interactive Plotly figure (saved separately as figure.svg).
fig, ax = plt.subplots(figsize=(7,4.5))
for index,(condition, block) in enumerate(df.groupby('factor_a',sort=False)):
    summary=block.groupby('dose',sort=True).value.agg(['mean','std','count'])
    x=summary.index.to_numpy(float)
    y=summary['mean'].to_numpy(float)
    err=summary['std'].fillna(0).to_numpy(float)
    if ERROR_BARS == 'sem': err=err / np.sqrt(summary['count'].to_numpy(float))
    if ERROR_BARS == 'none': err=np.zeros_like(err)
    if SHOW_LINES:
        ax.errorbar(x,y,yerr=err,marker='o',capsize=3,label=condition)
    else:
        ax.errorbar(x,y,yerr=err,linestyle='none',marker='o',capsize=3,label=condition)
    if SHOW_MARKERS:
        ax.scatter(block.dose.to_numpy(float),block.value.to_numpy(float),s=17,alpha=.35,zorder=3)
    if SHOW_LABELS:
        for xx,yy in zip(x,y): ax.annotate(f'{yy:.3g}',(xx,yy),xytext=(0,8),textcoords='offset points',ha='center',fontsize=9)
ax.set(xlabel=X_TITLE,ylabel=Y_TITLE)
if Y_MAX is not None: ax.set_ylim(top=Y_MAX)
if SHOW_LEGEND: ax.legend(frameon=False)
fig.tight_layout()
fig.savefig(HERE/'reproduced_figure.svg')
print('Wrote reproduced_figure.svg (the frozen original is figure.svg)')
`;
export function buildReproductionPython(record){
  const ds=record.dataset||{}, s=record.graph?.settings||{}, result=record.statistics||{};
  const test=ds.test_id||result.test_id;
  let code=common+`# Original method: ${String(result.label||test).replace(/[\r\n]/g,' ')}\n`;
  code+=`# Package versions from the archived calculation:\nRECORDED_PACKAGES = ${pyJson(result.engine?.python_packages||{})}\n`;
  code+=`print('Recorded Python packages:',RECORDED_PACKAGES)\nprint('Installed versions:', {'scipy':scipy.__version__, 'statsmodels':statsmodels.__version__})\n`;
  code+=`# Analysis source: ${pythonString(ds.name||'experiment')}\n`;
  if(['summary','anova','welch_anova','kruskal','ttest','welch_ttest','paired_ttest','two_factor_xy'].includes(test)) {
    code+=readGroups;
    if(test==='two_factor_xy') {
      code+=parseXY;
      code+=`from statsmodels.formula.api import ols\nfrom statsmodels.stats.anova import anova_lm\n`;
      code+=`counts=df.groupby(['factor_a','factor_b']).size()\n`;
      code+=`assert counts.min()>=2 and counts.nunique()==1, 'Balanced independent replicates required by this analysis'\n`;
      code+=`model=ols('value ~ C(factor_a) * C(factor_b)', data=df).fit()\nprint(anova_lm(model,typ=2))\n`;
    } else if (test==='anova'){
      code+=`from statsmodels.stats.multicomp import pairwise_tukeyhsd\n`;
      code+=`v=list(groups.values())\nprint('Ordinary ANOVA:',stats.f_oneway(*v))\n`;
      code+=`print(pairwise_tukeyhsd(np.concatenate(v),np.concatenate([[name]*len(x) for name,x in groups.items()]),alpha=${Number(result.alpha||.05)}))\n`;
    } else if(test==='welch_anova'){
      code+=`from statsmodels.stats.oneway import anova_oneway\nfrom statsmodels.stats.multitest import multipletests\nfrom itertools import combinations\n`;
      code+=`print('Welch ANOVA:',anova_oneway(list(groups.values()),use_var='unequal',welch_correction=True))\n`;
      code+=`pairs=list(combinations(groups,2))\nraw=[stats.ttest_ind(groups[a],groups[b],equal_var=False).pvalue for a,b in pairs]\n`;
      code+=`print('Pairwise Welch, Holm:',list(zip(pairs,multipletests(raw,method='holm')[1])))\n`;
    } else if(test==='kruskal'){
      code+=`from statsmodels.stats.multitest import multipletests\nfrom itertools import combinations\n`;
      code+=`print('Kruskal-Wallis:',stats.kruskal(*groups.values()))\n`;
      code+=`pairs=list(combinations(groups,2))\nraw=[stats.mannwhitneyu(groups[a],groups[b],alternative='two-sided',method='auto').pvalue for a,b in pairs]\n`;
      code+=`print('Pairwise Mann-Whitney U, Holm:',list(zip(pairs,multipletests(raw,method='holm')[1])))\n`;
    } else if(test==='ttest'||test==='welch_ttest'||test==='paired_ttest'){
      code+=`a,b=list(groups.values())\n`;
      if(test==='paired_ttest')code+=`print('Paired t test:',stats.ttest_rel(a,b,alternative=${pythonString(result.alternative||'two-sided')}))\n`;
      else code+=`print('Unpaired t test:',stats.ttest_ind(a,b,equal_var=${test==='ttest'?'True':'False'},alternative=${pythonString(result.alternative||'two-sided')}))\n`;
    } else code+=`print('Descriptive summaries: no hypothesis-test P values calculated.')\n`;
    const conditionXY=Boolean(ds.preset_id)||test==='two_factor_xy'||s.type==='dose-line'&&Object.keys(result.engine?.primary_arguments||{}).length===0;
    if(conditionXY){
      if(test!=='two_factor_xy'){
        code+=`# If headers are Condition | Dose, plot separate condition curves.\n`;
        code+=`import re\nif all(re.fullmatch(r'(.+?)\\s*\\|\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)',h) for h in groups):\n`;
        code+=parseXY.split('\n').filter(Boolean).map(x=>'    '+x).join('\n')+'\n';
        code+=`else:\n    df=pd.DataFrame([{'factor_a':'Dose series','dose':float(name),'value':float(v)} for name,arr in groups.items() for v in arr])\n`;
      }
      code+=`NORMALIZATION=${pythonString(s.normalization||'raw')}\nREFERENCE=${pythonString(s.reference||'')}\n`;
      code+=`ERROR_BARS=${pythonString(s.error||'sd')}\nSHOW_LINES=${s.showLines!==false?'True':'False'}\n`;
      code+=`SHOW_LEGEND=${s.showLegend!==false?'True':'False'}\nSHOW_MARKERS=${s.showMarkers!==false?'True':'False'}\nSHOW_LABELS=${s.showPointLabels?'True':'False'}\nY_MAX=${s.yMax==null?'None':Number(s.yMax)}\nX_TITLE=${pythonString(s.xTitle||'Dose')}\nY_TITLE=${pythonString(s.yTitle||'Measurement')}\n`;
      code+=`if NORMALIZATION!='raw':\n`;
      code+=`    if NORMALIZATION=='perCondition100':\n`;
      code+=`        baselines={k:float(part[part.dose==part.dose.min()].value.mean()) for k,part in df.groupby('factor_a')}\n`;
      code+=`        df['value']=[100*v/baselines[c] for c,v in zip(df.factor_a,df.value)]\n`;
      code+=`    else:\n`;
      code+=`        parts=REFERENCE.split('|');ref={'factor_a':parts[0].strip(),'dose':float(parts[1])} if len(parts)==2 and parts[1].strip() else None\n`;
      code+=`        if ref is None: ref=df.iloc[0]\n`;
      code+=`        ref_mean=df[(df.factor_a==ref['factor_a']) & (df.dose==ref['dose'])].value.mean()\n`;
      code+=`        df['value']=100*df.value/ref_mean\n`;
      code+=plotGeneric;
    }
  } else if(['two_factor','time_independent'].includes(test)) {
    code+=`from statsmodels.formula.api import ols\nfrom statsmodels.stats.anova import anova_lm\n`;
    code+=`df=pd.DataFrame(table[1:],columns=table[0]).rename(columns={table[0][0]:'factor_a',table[0][1]:'factor_b',table[0][2]:'value'})\n`;
    code+=`df['value']=pd.to_numeric(df['value'])\nprint(anova_lm(ols('value ~ C(factor_a) * C(factor_b)',data=df).fit(),typ=2))\n`;
  } else if(test==='time_repeated'){
    code+=`from statsmodels.stats.anova import AnovaRM\n`;
    code+=`df=pd.DataFrame(table[1:],columns=table[0]).rename(columns={table[0][0]:'subject',table[0][1]:'time',table[0][2]:'value'})\n`;
    code+=`df['value']=pd.to_numeric(df['value'])\nprint(AnovaRM(df,'value','subject',within=['time']).fit())\n`;
  } else if(test==='survival_logrank'){
    code+=`from statsmodels.duration.survfunc import SurvfuncRight,survdiff\n`;
    code+=`df=pd.DataFrame(table[1:],columns=table[0]).rename(columns={table[0][0]:'subject',table[0][1]:'group',table[0][2]:'time',table[0][3]:'event'})\n`;
    code+=`df['time']=pd.to_numeric(df['time']);df['event']=pd.to_numeric(df['event'])\n`;
    code+=`print('Overall log-rank:',survdiff(df.time.to_numpy(),df.event.to_numpy(),df.group.to_numpy()))\n`;
    code+=`for group,part in df.groupby('group'):print(group,SurvfuncRight(part.time.to_numpy(),part.event.to_numpy()).surv_prob)\n`;
  } else if(test==='dose_4pl'){
    code+=`from scipy.optimize import curve_fit\n`;
    code+=`df=pd.DataFrame(table[1:],columns=table[0]).rename(columns={table[0][0]:'group',table[0][1]:'dose',table[0][2]:'value'})\n`;
    code+=`df[['dose','value']]=df[['dose','value']].astype(float)\n`;
    code+=`def four_pl(dose,bottom,top,log_ic50,hill):\n    return bottom+(top-bottom)/(1+(dose/(10**log_ic50))**hill)\n`;
    code+=`for group,part in df.groupby('group',sort=False):\n`;
    code+=`    x=part.dose.to_numpy();y=part.value.to_numpy();lo,hi=np.percentile(y,[10,90])\n`;
    code+=`    fit,cov=curve_fit(four_pl,x,y,p0=[float(lo),float(hi),float(np.median(np.log10(x))),1.],bounds=([-np.inf,-np.inf,np.log10(x.min())-1,0.05],[np.inf,np.inf,np.log10(x.max())+1,6.]),maxfev=30000)\n`;
    code+=`    print(group,'Relative IC50:',10**fit[2], 'Bottom/Top/Hill:',fit[0],fit[1],fit[3])\n`;
  } else {
    code+=`raise RuntimeError('This method needs a specialized replay exporter; consult the archived function/arguments.')\n`;
  }
  return code;
}
export function reproducibilitySection(python){
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  return `<section><h2>Focused executable Python replay</h2><p>Run with the archived input.csv and the recorded package versions. This is a compact replay of the same SciPy/statsmodels operations and selected Plotly data transformations; it is not a byte-for-byte extraction of library internals. The frozen figure.svg remains the authoritative original visual.</p><pre style="white-space:pre-wrap;background:#f4f7fa;padding:16px;border:1px solid #dce3e8;font-size:11px"><code>${esc(python)}</code></pre></section>`;
}
