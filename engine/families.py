"""Specialized BioStats analyses. Inputs are long-format observational records.

Every test calls a SciPy/statsmodels implementation; only preparation,
validation, and post-processing live here. Do not alter historical v0.3 logic.
"""
import numpy as np
import pandas as pd
import scipy
import statsmodels
from scipy import stats
from scipy.optimize import curve_fit
from statsmodels.stats.multitest import multipletests
from statsmodels.formula.api import ols
from statsmodels.stats.anova import anova_lm, AnovaRM
from statsmodels.duration.survfunc import SurvfuncRight, survdiff


def _family_meta(fn, arguments=None, extra=None):
    return dict(language='Python', python_packages={'scipy':scipy.__version__, 'statsmodels':statsmodels.__version__, 'numpy':np.__version__, 'pandas':pd.__version__},
                primary_function=fn,primary_arguments=arguments or {},posthoc_function=extra,posthoc_arguments={})


def _rows(payload, minimum=2):
    rows=payload.get('records', [])
    if not isinstance(rows,list) or len(rows)<minimum or not all(isinstance(r,dict) for r in rows):
        raise ValueError('Enter at least %d complete data rows' % minimum)
    return rows


def _number(value, desc, positive=False, nonnegative=False):
    try: v=float(value)
    except (ValueError,TypeError): raise ValueError(f'{desc} must be numerical')
    if not np.isfinite(v) or (positive and v<=0) or (nonnegative and v<0):
        raise ValueError(f'{desc} must be finite' + (' and positive' if positive else ' and >= 0' if nonnegative else ''))
    return v


def _summaries(df, group='group', val='value'):
    summaries=[]
    for n,frame in df.groupby(group,sort=False):
        a=frame[val].to_numpy(dtype=float)
        summaries.append(dict(group=str(n),n=len(a),mean=float(np.mean(a)),sd=float(np.std(a,ddof=1)) if len(a)>1 else 0.0,sem=float(stats.sem(a)) if len(a)>1 else 0.0,median=float(np.median(a))))
    return summaries


def _base(payload,label,fn,args,limitations,df=None):
    return dict(app_version='0.6.0',family=payload['family'],test_id=payload['test'],label=label,
                alpha=float(payload.get('alpha',0.05)),alternative='two-sided',
                group_summaries=_summaries(df) if df is not None and 'group' in df and 'value' in df else [],
                posthoc=None,significant=None,effect_size=None,statistic=None,df=[],p_value=None,
                engine=_family_meta(fn,args),limitations=limitations)


def _validate_groups(values,label='Group'):
    if any(not str(v).strip() for v in values):raise ValueError(f'{label} must not be blank')
    if len(set(values))<2:raise ValueError(f'At least two distinct {label.lower()} levels are required')


def _factorial(payload, timecourse=False):
    records=_rows(payload,8)
    akey,bkey=('Group','Time') if timecourse else ('Factor A','Factor B')
    clean=[]
    for i,r in enumerate(records,2):
        a=str(r.get('a','')).strip(); b=str(r.get('b','')).strip()
        if not a or not b:raise ValueError(f'Row {i}: factor labels cannot be blank')
        clean.append({'factor_a':a,'factor_b':b,'value':_number(r.get('value'),f'Row {i} value')})
    df=pd.DataFrame(clean)
    _validate_groups(df.factor_a.tolist(),akey);_validate_groups(df.factor_b.tolist(),bkey)
    counts=df.groupby(['factor_a','factor_b']).size()
    levels_a=sorted(df.factor_a.unique()); levels_b=sorted(df.factor_b.unique())
    if len(counts)!=len(levels_a)*len(levels_b):raise ValueError('Each factor combination (cell) must contain observations')
    if counts.min()<2:raise ValueError('At least two independent biological replicates in EVERY factor combination are required')
    if len(set(counts))!=1:raise ValueError('This first factorial ANOVA module requires a balanced design (the same n in every factor combination)')
    model=ols('value ~ C(factor_a) * C(factor_b)',data=df).fit()
    table=anova_lm(model,typ=2)
    labels=[('C(factor_a)',akey),('C(factor_b)',bkey),('C(factor_a):C(factor_b)',f'{akey} × {bkey}')]
    effects=[]
    for key,name in labels:
        row=table.loc[key]
        f,p=float(row['F']),float(row['PR(>F)'])
        if not np.isfinite(f) or not np.isfinite(p):raise ValueError('ANOVA could not estimate one or more factor effects')
        effects.append(dict(effect=name,statistic=f,p_value=p,df=[float(row['df']),float(table.loc['Residual','df'])]))
    result=_base(payload,('Independent time-course (group × time) two-way ANOVA' if timecourse else 'Balanced independent two-factor ANOVA'),
                 'statsmodels.formula.api.ols + statsmodels.stats.anova.anova_lm',
                 {'model':'value ~ C(factor_a)*C(factor_b)','typ':2,'balanced':True,'replicates_per_cell':int(counts.iloc[0])},
                 'Independent observations are assumed for EVERY row. This method must NOT be used for repeated observations of the same animal. Interpret main effects with caution when the interaction is present.')
    result.update(primary_effect=effects[-1]['effect'],effects=effects,statistic=effects[-1]['statistic'],p_value=effects[-1]['p_value'],df=effects[-1]['df'],
                  significant=effects[-1]['p_value']<result['alpha'],group_summaries=[dict(group=f'{a} | {b}',**{k:v for k,v in _summaries(pd.DataFrame({'group':[a+' | '+b]*len(frame),'value':frame.value}),group='group')[0].items() if k!='group'}) for (a,b),frame in df.groupby(['factor_a','factor_b'],sort=True)],
                  plot_data=[dict(a=a,b=b,mean=float(frame.value.mean()),sd=float(frame.value.std(ddof=1)),n=len(frame)) for (a,b),frame in df.groupby(['factor_a','factor_b'],sort=True)])
    return result


def _repeated_time(payload):
    records=_rows(payload,6)
    clean=[]
    for i,r in enumerate(records,2):
        subject=str(r.get('subject','')).strip();time=str(r.get('time','')).strip()
        if not subject or not time:raise ValueError(f'Row {i}: Subject ID and Time are required')
        clean.append(dict(subject=subject,time=time,value=_number(r.get('value'),f'Row {i} value')))
    df=pd.DataFrame(clean)
    if df.duplicated(['subject','time']).any():raise ValueError('Each subject/time combination must have ONE measurement')
    n_subject=df.subject.nunique(); n_time=df.time.nunique()
    if n_subject<3 or n_time<2:raise ValueError('Use at least three matched subjects measured at two or more time points')
    if len(df)!=n_subject*n_time:raise ValueError('Complete repeated-measures data required: every subject needs every time point')
    model=AnovaRM(df,'value','subject',within=['time']).fit()
    table=model.anova_table.iloc[0]
    f,p=float(table['F Value']),float(table['Pr > F'])
    if not np.isfinite(f) or not np.isfinite(p):raise ValueError('Repeated-measures ANOVA could not be computed')
    res=_base(payload,'One-factor repeated-measures ANOVA (time)','statsmodels.stats.anova.AnovaRM',
              {'depvar':'value','subject':'subject','within':['time'],'balanced_complete':True},
              'Repeated measurements are matched using Subject ID. This is a within-subject time effect, NOT a group-by-time interaction test. Check residuals and sphericity; no Greenhouse–Geisser correction is provided.')
    res.update(statistic=f,p_value=p,df=[float(table['Num DF']),float(table['Den DF'])],significant=p<res['alpha'],
               plot_data=[dict(time=t,mean=float(f.value.mean()),sd=float(f.value.std(ddof=1)),n=len(f)) for t,f in df.groupby('time',sort=False)],
               subject_curves=[dict(subject=k,points=[dict(time=row.time,value=float(row.value)) for row in frame.itertuples()]) for k,frame in df.groupby('subject',sort=False)])
    return res


def _survival(payload):
    records=_rows(payload,4)
    clean=[]
    for i,r in enumerate(records,2):
        subject=str(r.get('subject','')).strip(); group=str(r.get('group','')).strip()
        if not subject or not group:raise ValueError(f'Row {i}: subject and group are required')
        time=_number(r.get('time'),f'Row {i} follow-up time',nonnegative=True)
        ev=_number(r.get('event'),f'Row {i} event indicator')
        if ev not in (0,1):raise ValueError(f'Row {i}: Event must be 1 (event) or 0 (censored)')
        clean.append(dict(subject=subject,group=group,time=time,event=int(ev)))
    df=pd.DataFrame(clean)
    if df.subject.duplicated().any():raise ValueError('Survival Subject IDs must be globally unique; one row per subject')
    groups=list(dict.fromkeys(df.group.tolist()));_validate_groups(groups)
    if df.event.sum()==0:raise ValueError('No events: the log-rank test cannot compare survival')
    chi,p=survdiff(df.time.to_numpy(),df.event.to_numpy(),df.group.to_numpy())
    if not np.isfinite(chi) or not np.isfinite(p):raise ValueError('Log-rank statistic is undefined for these data')
    res=_base(payload,'Kaplan–Meier survival and log-rank test','statsmodels.duration.survfunc.SurvfuncRight + survdiff',
              {'method':'logrank','event_code':1,'censored_code':0},'Log-rank tests compare entire survival curves under independent censoring. Censored patients/animals are NOT events. Hazard ratios are not calculated by this module.')
    surv=[]
    for name,frame in df.groupby('group',sort=False):
        km=SurvfuncRight(frame.time.to_numpy(),frame.event.to_numpy())
        surv.append({'name':name,'n':len(frame),'events':int(frame.event.sum()),'censored':int(len(frame)-frame.event.sum()),
                     'curve':[{'time':float(t),'survival':float(s)} for t,s in zip(km.surv_times,km.surv_prob)],
                     'censors':[float(t) for t in frame.loc[frame.event==0,'time']]})
    res.update(statistic=float(chi),p_value=float(p),df=[len(groups)-1],significant=p<res['alpha'],survival=surv)
    if len(groups)>2:
        pairs=[];raw=[]
        for i in range(len(groups)):
            for j in range(i+1,len(groups)):
                sub=df.loc[df.group.isin([groups[i],groups[j]])]
                _,q=survdiff(sub.time.to_numpy(),sub.event.to_numpy(),sub.group.to_numpy())
                raw.append(float(q));pairs.append((groups[i],groups[j]))
        adj=multipletests(raw,method='holm')[1]
        comps=[dict(group1=a,group2=b,difference=None,p_raw=float(p0),p_adjusted=float(p1),ci_low=None,ci_high=None,reject=bool(p1<res['alpha'])) for (a,b),p0,p1 in zip(pairs,raw,adj)]
        res['posthoc']={'method':'Pairwise log-rank tests; Holm adjustment across all group pairs','comparisons':comps,'family':'all_pairs'}
        res['engine']['posthoc_function']='statsmodels.duration.survfunc.survdiff + statsmodels.stats.multitest.multipletests'
        res['engine']['posthoc_arguments']={'method':'holm'}
    return res


def _four_pl(x,bottom,top,log_ic50,hill):
    return bottom+(top-bottom)/(1+np.power(10.0,np.clip(hill*(np.log10(x)-log_ic50),-200,200)))


def _dose(payload):
    records=_rows(payload,6)
    clean=[]
    for i,r in enumerate(records,2):
        group=str(r.get('group','')).strip()
        if not group:raise ValueError(f'Row {i}: curve group required')
        clean.append(dict(group=group,dose=_number(r.get('dose'),f'Row {i} dose',positive=True),value=_number(r.get('value'),f'Row {i} response')))
    df=pd.DataFrame(clean)
    fits=[]
    for name,frame in df.groupby('group',sort=False):
        x=frame.dose.to_numpy();y=frame.value.to_numpy()
        if len(x)<6 or len(np.unique(x))<5:raise ValueError(f'{name}: use at least six observations at five distinct POSITIVE concentrations')
        if np.std(y)==0:raise ValueError(f'{name}: response has no variation')
        ylo,yhi=np.percentile(y,[10,90]);mid=np.median(np.log10(x))
        # Bottom < top and Hill > 0: decreasing 4PL curve only. Fits that
        # cannot locate a transition within the experimental doses are rejected.
        try:
            params,cov=curve_fit(_four_pl,x,y,p0=[float(ylo),float(yhi),float(mid),1.0],
                 bounds=([-np.inf,-np.inf,np.log10(min(x))-1,0.05],[np.inf,np.inf,np.log10(max(x))+1,6.0]),maxfev=30000)
        except (RuntimeError,ValueError) as e:raise ValueError(f'{name}: nonlinear fit failed ({e}). Inspect the dose range and monotonic response.')
        bottom,top,log_ic50,hill=(float(z) for z in params)
        if top<=bottom:raise ValueError(f'{name}: no decreasing dose–response curve detected; 4PL IC50 not meaningful')
        if log_ic50<np.log10(min(x))-0.05 or log_ic50>np.log10(max(x))+0.05:
            raise ValueError(f'{name}: IC50 falls outside the measured dose range; include concentrations on both sides of the transition')
        fitted=_four_pl(x,*params);sse=float(np.sum((y-fitted)**2));sst=float(np.sum((y-np.mean(y))**2))
        se=float(np.sqrt(cov[2,2])) if np.isfinite(cov[2,2]) and cov[2,2]>=0 else None
        # Approximate Wald CI for log10(IC50); exploratory and unreliable at parameter bounds.
        ci=[float(10**(log_ic50-1.96*se)),float(10**(log_ic50+1.96*se))] if se is not None and se<10 else None
        grid=np.geomspace(min(x),max(x),100)
        fits.append(dict(group=name,n=len(x),ic50=float(10**log_ic50),log10_ic50=log_ic50,
                         ci95_approx=ci,hill=hill,bottom=bottom,top=top,r_squared=1-sse/sst,
                         fitted=[dict(dose=float(t),response=float(v)) for t,v in zip(grid,_four_pl(grid,*params))]))
    res=_base(payload,'4-parameter logistic dose–response fit (relative IC50)','scipy.optimize.curve_fit',
              {'model':'bottom+(top-bottom)/(1+(dose/IC50)^Hill)','hill_bounds':[0.05,6.0],'dose_strictly_positive':True,'response':'decreasing','ci95':'approximate log-IC50 Wald'},
              'IC50 is the fitted halfway-response concentration (not necessarily the dose giving an absolute 50% viability). Decreasing sigmoid only; concentrations must be positive and in consistent units. Reported CI is an approximate Wald interval; interpret carefully with limited replicates. No between-curve P value is calculated.')
    res.update(fits=fits)
    return res


def analyze_family(payload):
    if isinstance(payload,str):
        import json
        payload=json.loads(payload)
    if not (0<float(payload.get('alpha',0.05))<1):raise ValueError('Alpha must be between 0 and 1')
    mode=payload.get('test')
    if mode=='time_independent':return _factorial(payload,timecourse=True)
    if mode=='time_repeated':return _repeated_time(payload)
    if mode=='two_factor':return _factorial(payload,timecourse=False)
    if mode=='survival_logrank':return _survival(payload)
    if mode=='dose_4pl':return _dose(payload)
    raise ValueError('Unsupported analysis type')
