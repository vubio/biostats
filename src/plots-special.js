// Specialized scientific figures with vector-compatible Plotly traces.
const colors=['#4782b7','#218c87','#d29a56','#a17ab3','#e06a3f','#417f5a'];
const avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
const spread=a=>a.length<2?0:Math.sqrt(a.reduce((s,v)=>s+(v-avg(a))**2,0)/(a.length-1));
const uniq=a=>[...new Set(a)];
function grouped(data,key){return uniq(data.map(x=>x[key])).map(name=>({name,values:data.filter(x=>x[key]===name)}));}
function meanTrace(points,color,name,error){
  const ys=points.map(p=>p.value);
  return {type:'scatter',mode:'lines+markers',name,x:points.map(p=>p.time),y:ys,line:{color,width:2.5},marker:{size:7},
    error_y:error==='none'?undefined:{type:'data',array:points.map(p=>p.err),visible:true,width:5,thickness:1.2},hovertemplate:'%{x}: %{y:.4g}<extra>%{fullData.name}</extra>'};
}
const sortedNum=(a,b)=>Number(a)-Number(b);
function byTime(data,timeField,valueField,error){
  const times=uniq(data.map(x=>x[timeField])).sort(sortedNum);
  return times.map(t=>{const vals=data.filter(x=>x[timeField]===t).map(x=>x[valueField]);let err=spread(vals);
    if(error==='sem')err/=Math.sqrt(vals.length);
    return {time:Number(t),value:avg(vals),err};});
}
function survivalPreview(df){
  return grouped(df,'group').map(({name,values},idx)=>{
    const events=uniq(values.filter(x=>x.event===1).map(x=>x.time)).sort(sortedNum);
    let survival=1;const curve=[{time:0,survival:1}];
    events.forEach(t=>{const risk=values.filter(x=>x.time>=t).length,ev=values.filter(x=>x.time===t&&x.event===1).length;
      survival*=1-ev/risk;curve.push({time:t,survival});});
    return {name,curve,censors:values.filter(x=>x.event===0).map(x=>x.time)};
  });
}
function getKmValue(curve,time){const c=curve.filter(x=>x.time<=time);return c.length?c.at(-1).survival:1;}
export function specialPlotSpec(test,records,settings,result=null){
  const traces=[];const palette=colors;const error=settings.error;
  if(test==='time_independent'){
    grouped(records,'a').forEach(({name,values},i)=>traces.push(meanTrace(byTime(values,'b','value',error),palette[i%palette.length],name,error)));
  }else if(test==='time_repeated'){
    const all=byTime(records,'time','value',error);
    grouped(records,'subject').forEach(({name,values})=>{
      const p=values.slice().sort((a,b)=>Number(a.time)-Number(b.time));
      traces.push({type:'scatter',mode:'lines',name:'Subject '+name,x:p.map(z=>Number(z.time)),y:p.map(z=>z.value),line:{color:'#a5b6c2',width:1},opacity:.35,showlegend:false,hoverinfo:'skip'});
    });
    traces.push(meanTrace(all,palette[0],'Mean ± '+error.toUpperCase(),error));
  }else if(test==='two_factor'){
    grouped(records,'a').forEach(({name,values},i)=>{
      const categories=uniq(records.map(x=>x.b)).sort();
      const points=categories.map(t=>{const z=values.filter(x=>x.b===t).map(x=>x.value);let err=spread(z);if(error==='sem')err/=Math.sqrt(z.length);return {time:t,value:avg(z),err};}).filter(z=>Number.isFinite(z.value));
      traces.push({...meanTrace(points,palette[i%palette.length],name,error),x:points.map(z=>z.time)});
    });
  }else if(test==='survival_logrank'){
    const kms=result?.survival||survivalPreview(records);
    kms.forEach((g,i)=>{
      const curve=[{time:0,survival:1},...g.curve];
      const times=curve.map(p=>p.time),probs=curve.map(p=>p.survival);
      traces.push({type:'scatter',mode:'lines',line:{shape:'hv',color:palette[i%palette.length],width:2.5},name:g.name,x:times,y:probs,hovertemplate:'Time %{x:.3g}<br>Survival %{y:.3f}<extra>%{fullData.name}</extra>'});
      traces.push({type:'scatter',mode:'markers',name:g.name+' censored',showlegend:false,
        marker:{symbol:'line-ns',size:11,color:palette[i%palette.length],line:{width:1.8,color:palette[i%palette.length]}},
        x:g.censors,y:g.censors.map(t=>getKmValue(curve,t)),hovertemplate:'Censored at %{x:.3g}<extra>'+g.name+'</extra>'});
    });
  }else if(test==='dose_4pl'){
    grouped(records,'group').forEach(({name,values},i)=>{
      const color=palette[i%palette.length];
      traces.push({type:'scatter',mode:'markers',name:name+' observations',x:values.map(x=>x.dose),y:values.map(x=>x.value),marker:{color,size:8},hovertemplate:'Dose %{x:.3g}<br>Response %{y:.3g}<extra>'+name+'</extra>'});
      const fit=result?.fits?.find(f=>f.group===name);
      if(fit)traces.push({type:'scatter',mode:'lines',name:name+` fit · IC50 ${fit.ic50.toPrecision(3)}`,x:fit.fitted.map(x=>x.dose),y:fit.fitted.map(x=>x.response),line:{color,width:2.5},hovertemplate:'Dose %{x:.3g}<br>Fit %{y:.3g}<extra>'+name+'</extra>'});
    });
  }else throw Error('Unsupported plot family');
  // Display settings are shared with the ordinary and dose-series graph editors.
  if(settings.showLines===false && ['time_independent','time_repeated','two_factor'].includes(test)){
    for(const t of traces){if(t.mode==='lines+markers')t.mode='markers';}
  }
  if(settings.showPointLabels){for(const t of traces){if(t.type==='scatter'&&Array.isArray(t.y)&&t.mode?.includes('markers')&&test!=='survival_logrank'){
    t.text=t.y.map(v=>Number(v).toPrecision(3));t.textposition='top center';t.mode+='+text';
  }}}
  const layout={template:'none' ,paper_bgcolor:'#fff',plot_bgcolor:'#fff',font:{family:'Arial, sans-serif',size:settings.fontSize||15,color:'#26343d'},
    title:{text:settings.title||'',x:.5},
    xaxis:{title:{text:settings.xTitle&&settings.xTitle!=='Group'?settings.xTitle:test==='two_factor'?'Factor B':test==='survival_logrank'?'Time':test==='dose_4pl'?'Concentration (log scale)':'Time'},
      type:test==='dose_4pl'?'log':test==='two_factor'?'category':'linear',showline:true,linecolor:'#26343d',showgrid:false,zeroline:false},
    yaxis:{title:{text:test==='survival_logrank'?'Survival probability':settings.yTitle||'Measurement'},showline:true,linecolor:'#26343d',showgrid:false,zeroline:false,...(test==='survival_logrank'?{range:[0,1.04]}:settings.yMax!=null?{range:[null,settings.yMax]}:{})},
    margin:{l:95,r:35,t:settings.title?60:30,b:80},hovermode:'closest',showlegend:!!settings.showLegend,legend:{orientation:'h',y:-.25,x:0}};
  return {traces,layout,config:{responsive:true,displaylogo:false,modeBarButtonsToRemove:['toImage','lasso2d','select2d']}};
}
export async function renderSpecial(el,test,records,settings,result){
  if(!window.Plotly)throw Error('Plotly unavailable');
  const {traces,layout,config}=specialPlotSpec(test,records,settings,result);
  await window.Plotly.react(el,traces,layout,config);
}
