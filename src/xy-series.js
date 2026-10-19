// Shared grouped-XY table and plot helpers. Not a separate statistical test.
const SPLIT = ' | ';
const finite = x => String(x??'').trim()!=='' && Number.isFinite(Number(x));
export function parseConditionNames(text) {
  const names=String(text).split(',').map(x=>x.trim()).filter(Boolean);
  if (!names.length || names.length>8 || new Set(names).size!==names.length || names.some(n=>n.includes('|')))
    throw Error('Enter 1–8 unique condition labels separated by commas; labels cannot contain |.');
  return names;
}
export function conditionHeaders(names, doses=['0','0.05','0.1','0.2']) {
  if (!names.length||names.length>8 || doses.length<2) throw Error('Choose conditions and at least two doses.');
  return names.flatMap(name=>doses.map(dose=>`${name}${SPLIT}${dose}`));
}
export function blankConditionRows(names,n=3,doses=['0','0.05','0.1','0.2']) {
  if (!Number.isInteger(n)||n<1||n>24) throw Error('Replicates must be 1–24.');
  const headers=conditionHeaders(names,doses);
  if(headers.length>40)throw Error('The editor supports at most 40 condition × dose columns (e.g. 8 conditions × 4 doses).');
  return [headers, ...Array.from({length:n},()=>headers.map(()=>''))];
}
export function demoConditionRows(names,n=3,orientation='columns',doses=['0','0.05','0.1','0.2']){
  const rows=blankConditionRows(names,n,doses);
  // Deliberately synthetic and deterministic; neither biological inference nor actual GPX4-knockout values.
  const baseline=[104000,92500,68500,31000];
  for(let r=0;r<n;r++) for(let ci=0;ci<names.length;ci++) for(let di=0;di<doses.length;di++){
    const factor=ci===0?1:Math.max(.12,1-ci*(.075+di*.11));
    const jitter=1+(((r*7+di*3+ci*5)%11)-5)*.012;
    rows[r+1][ci*doses.length+di]=String(Math.round(baseline[di%baseline.length]*factor*jitter));
  }
  if(orientation!=='rows')return rows;
  const first=['Dose (µM)'];
  names.forEach(name=>{for(let r=0;r<n;r++)first.push(`${name} Rep ${r+1}`);});
  const byDose=doses.map((dose,di)=>[dose,...names.flatMap((_,ci)=>Array.from({length:n},(_,r)=>rows[r+1][ci*doses.length+di]))]);
  return [first,...byDose];
}
export function parseConditionColumns(groups) {
  if (!Array.isArray(groups)||!groups.length)return null;
  const parsed=[];
  for(const g of groups){
    const match=/^(.+?)\s*\|\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/.exec(String(g.name));
    if(!match)return null;
    const dose=Number(match[2]);if(!Number.isFinite(dose))throw Error('Dose must be a finite numeric value');
    parsed.push({condition:match[1].trim(),dose,values:g.values.slice(),name:g.name});
  }
  const keys=new Set();
  for(const x of parsed){const k=JSON.stringify([x.condition,x.dose]);if(keys.has(k))throw Error(`Duplicate condition/dose pair: ${x.condition}, ${x.dose}`);keys.add(k);}
  const conditions=[...new Set(parsed.map(x=>x.condition))],doses=[...new Set(parsed.map(x=>x.dose))].sort((a,b)=>a-b);
  for(const condition of conditions) for(const dose of doses){
    if(!keys.has(JSON.stringify([condition,dose])))throw Error(`Missing dose ${dose} in ${condition}; use the same dose points for each curve.`);
  }
  return {conditions,doses,columns:parsed};
}
export function conditionRecords(groups){
  const p=parseConditionColumns(groups);
  if(!p || p.conditions.length<2 || p.doses.length<2)throw Error('Condition × dose ANOVA needs at least 2 conditions and 2 doses with headers like WT | 0.05.');
  return p.columns.flatMap(g=>g.values.map(value=>({a:g.condition,b:String(g.dose),value:Number(value)})));
}
export function normalizeXYGroups(groups,mode,reference){
  if(mode==='raw')return groups.map(g=>({...g,values:g.values.slice()}));
  const parsed=parseConditionColumns(groups);
  if(!parsed){
    if(mode==='perCondition100') mode='control100';
    const r=groups.find(g=>g.name===reference)||groups[0];
    const mean=r.values.reduce((s,v)=>s+v,0)/r.values.length;
    if(!Number.isFinite(mean)||mean===0)throw Error('Normalization denominator is zero.');
    return groups.map(g=>({...g,values:g.values.map(v=>100*v/mean)}));
  }
  const zeroDose=parsed.doses.includes(0)?0:parsed.doses[0];
  const shared=parsed.columns.find(g=>g.name===reference)||parsed.columns.find(g=>g.condition===parsed.conditions[0]&&g.dose===zeroDose);
  return groups.map(g=>{
    const entry=parsed.columns.find(x=>x.name===g.name);
    const baseline=mode==='perCondition100' ? parsed.columns.find(x=>x.condition===entry.condition&&x.dose===zeroDose):shared;
    if(!baseline)throw Error('Normalization control not found.');
    const mean=baseline.values.reduce((s,v)=>s+v,0)/baseline.values.length;
    if(!Number.isFinite(mean)||mean===0)throw Error(`Normalization reference ${baseline.name} has zero mean.`);
    return {...g,values:g.values.map(v=>100*v/mean)};
  });
}
export function maybeConditionTranspose(rows){
  if(!Array.isArray(rows)||rows.length<3)return false;
  const head=rows[0].map(v=>String(v).trim());
  if(!/^dose(?:\s*\(.*?\))?$/i.test(head[0]))return false;
  const regs=head.slice(1);
  const reg=/^(.+?)\s+(?:rep(?:licate)?\s*)?(\d+)$/i;
  return regs.length>0&&regs.every(h=>reg.test(h))&&rows.slice(1).every(r=>finite(r[0]));
}
export function transposeConditionRows(rows){
  if(!maybeConditionTranspose(rows))throw Error('Expected a Dose column with condition replicate headers, e.g. WT Rep 1, KO Rep 1.');
  const head=rows[0].slice(1).map(v=>String(v).trim());
  const rx=/^(.+?)\s+(?:rep(?:licate)?\s*)?(\d+)$/i;
  const columns=head.map(h=>{const m=rx.exec(h);return {condition:m[1].trim(),rep:Number(m[2])};});
  const conditions=[...new Set(columns.map(c=>c.condition))];
  const doses=rows.slice(1).map(r=>String(r[0]).trim());
  const reps=Math.max(...columns.map(c=>c.rep));
  const out=blankConditionRows(conditions,reps,doses);
  for(let ci=0;ci<conditions.length;ci++)for(let ri=1;ri<=reps;ri++){
    const col=columns.findIndex(c=>c.condition===conditions[ci]&&c.rep===ri);
    if(col<0)continue;
    for(let di=0;di<doses.length;di++) out[ri][ci*doses.length+di]=String(rows[di+1][col+1]??'');
  }
  return out;
}
const palettes={journal:['#4782b7','#218c87','#d29a56','#a17ab3','#8c9586','#df7f6a','#70539a','#9b6338'],mono:['#202a32','#6b7379','#afb4b8','#424c52','#d2d7d9','#8a949e'],bright:['#3366d5','#e06a3f','#1f9b55','#a044ab','#b78b16','#df3382']};
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const sd=a=>a.length<2?0:Math.sqrt(a.reduce((s,v)=>s+(v-mean(a))**2,0)/(a.length-1));
export function multiLinePlotSpec(groups,s){
  const parsed=parseConditionColumns(groups);
  if(!parsed)return null;
  const traces=[],colors=palettes[s.palette]||palettes.journal;
  const gap=parsed.doses.length>1?Math.min(...parsed.doses.slice(1).map((x,i)=>x-parsed.doses[i])):1;
  parsed.conditions.forEach((condition,i)=>{
    const color=colors[i%colors.length];const cols=parsed.doses.map(d=>parsed.columns.find(x=>x.condition===condition&&x.dose===d));
    const means=cols.map(c=>mean(c.values));
    const errors=cols.map(c=>s.error==='none'?0:s.error==='sem'?sd(c.values)/Math.sqrt(c.values.length):sd(c.values));
    const mode=[s.showLines===false?'':'lines', 'markers',s.showPointLabels?'text':''].filter(Boolean).join('+');
    traces.push({type:'scatter',name:condition,mode,x:parsed.doses,y:means,
      line:{color,width:2.4},marker:{color,size:9,symbol:i%2?'square':'circle'},
      text:s.showPointLabels?means.map(v=>v.toPrecision(3)):undefined,textposition:'top center',
      error_y:s.error==='none'?undefined:{type:'data',array:errors,visible:true,width:5,thickness:1.4},
      showlegend:s.showLegend!==false,hovertemplate:`${condition}<br>Dose %{x:.4g}<br>Mean %{y:.5g}<extra></extra>`});
    if(s.showMarkers!==false)cols.forEach((g,j)=>{
      traces.push({type:'scatter',mode:'markers',name:`${condition} replicates`,showlegend:false,
        x:g.values.map((_,k)=>parsed.doses[j]+((k*.61803398875)%1-.5)*gap*.10),y:g.values,
        marker:{color,size:6,opacity:.45,symbol:i%2?'square':'circle'},hovertemplate:`${condition} | ${g.dose}<br>%{y:.5g}<extra></extra>`});
    });
  });
  const vals=parsed.columns.flatMap(c=>c.values),lo=Math.min(...vals),hi=Math.max(...vals),span=Math.max(1,hi-lo);
  const xLo=parsed.doses[0],xHi=parsed.doses.at(-1),pad=Math.max((xHi-xLo)*.06,.001);
  return {traces,layout:{template:'none',paper_bgcolor:'#fff',plot_bgcolor:'#fff',
    title:{text:s.title||'',x:.5},font:{family:'Arial, sans-serif',size:s.fontSize||15,color:'#26343d'},
    xaxis:{title:{text:s.xTitle||'Dose'},range:[xLo-pad,xHi+pad],tickmode:'array',tickvals:parsed.doses,showline:true,linecolor:'#26343d',showgrid:false,zeroline:false},
    yaxis:{title:{text:s.yTitle||'Response'},range:[Math.min(0,lo-span*.06),s.yMax==null?hi+span*.18:Number(s.yMax)],showline:true,linecolor:'#26343d',showgrid:false,zeroline:false},
    margin:{l:95,r:30,t:s.title?60:35,b:s.showLegend?115:80},legend:{orientation:'h',y:-.27,x:0},
    showlegend:s.showLegend!==false,hovermode:'closest'},config:{responsive:true,displaylogo:false,modeBarButtonsToRemove:['toImage','lasso2d','select2d']}};
}
