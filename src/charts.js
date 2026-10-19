import {normalizedGroups,numericDoseCoordinates} from './presets.js';
export const PLOTLY_VERSION = '3.7.0';
const palettes = {
  journal: ['#4782b7', '#218c87', '#d29a56', '#a17ab3', '#8c9586', '#df7f6a'],
  mono: ['#202a32', '#6b7379', '#afb4b8', '#424c52', '#d2d7d9', '#8a949e'],
  bright: ['#3366d5', '#e06a3f', '#1f9b55', '#a044ab', '#b78b16', '#df3382']
};
const average = a => a.reduce((x,y)=>x+y,0)/a.length;
const sd = a => a.length<2?0:Math.sqrt(a.reduce((s,x)=>s+(x-average(a))**2,0)/(a.length-1));
const niceP = p => p == null ? 'n/a' : p < .0001 ? p.toExponential(1) : p.toPrecision(3);
const stars = (p, alpha) => p >= alpha ? 'ns' : p < .0001 ? '****' : p < .001 ? '***' : p < .01 ? '**' : '*';
export const defaultChartSettings = () => ({type:'dots',error:'sd',palette:'journal',yMax:null,yTitle:'Measurement',title:'',fontSize:15,width:800,height:550,
  annotationMode:'none',annotationFormat:'stars',shownPairs:[],xTitle:'Group',normalization:'raw',reference:null,
  showLines:true,showMarkers:true,showLegend:false,showPointLabels:false});

// groups must contain validated numerical values, *not* the user's raw worksheet.
// The plot spec is deterministic and shared by browser preview and vector SVG export.
export function plotSpec(groups, s, comparisons = [], alpha = .05) {
  if (!Array.isArray(groups)||groups.length<2||groups.some(g=>!g.values?.length)) throw Error('No valid numeric groups to plot.');
  const plotGroups=normalizedGroups(groups,s.normalization||'raw',s.reference);
  if(s.type==='dose-line')return doseLineSpec(plotGroups,s,comparisons,alpha);
  groups=plotGroups;
  const colors = palettes[s.palette] || palettes.journal;
  const traces=[];
  const dataMinimum=Math.min(...groups.flatMap(g=>g.values));
  const dataMaximum=Math.max(...groups.flatMap(g=>g.values));
  const span=Math.max(1, dataMaximum-dataMinimum);
  const bounds=groups.map(g=>{
    const m=average(g.values),e=s.error==='sem'?sd(g.values)/Math.sqrt(g.values.length):s.error==='sd'?sd(g.values):0;
    return {mean:m,error:e,highest:Math.max(...g.values,m+e),lowest:Math.min(...g.values,m-e)};
  });
  groups.forEach((g,i)=>{
    const values = g.values;
    const {mean,error:variability}=bounds[i];
    const color=colors[i%colors.length];
    if (s.type==='bar') {
      traces.push({type:'bar',x:[i+1],y:[mean],marker:{color,opacity:.5,line:{color,width:1.4}},width:.52,
        error_y:{type:'data',array:[variability],visible:s.error!=='none',color:'#2f3c44',thickness:1.5,width:7},hovertemplate:'Mean: %{y:.3g}<extra></extra>',showlegend:false});
    } else if(s.type==='box') {
      traces.push({type:'box',x:Array(values.length).fill(i+1),y:values,boxpoints:false,fillcolor:color+'33',line:{color,width:1.5},marker:{color},showlegend:false,hovertemplate:'%{y:.3g}<extra></extra>'});
    } else {
      traces.push({type:'scatter',mode:'markers',x:[i+1],y:[mean],marker:{symbol:'line-ew',size:24,color:'#1b2c37',line:{width:2,color:'#1b2c37'}},showlegend:false,
        error_y:{type:'data',array:[variability],visible:s.error!=='none',color:'#1b2c37',thickness:1.4,width:8},hoverinfo:'skip'});
    }
    const jitter=values.map((_,j)=>((j*0.61803398875+i*0.314159)%1-.5)*.31);
    if(s.showMarkers!==false)traces.push({type:'scatter',mode:'markers',name:g.name,x:values.map((_,j)=>i+1+jitter[j]),y:values,marker:{color,size:8,opacity:.92,line:{color:'#ffffff',width:.5}},showlegend:!!s.showLegend,hovertemplate:`${g.name}: %{y:.3g}<extra></extra>`});
  });
  if(s.showPointLabels){groups.forEach((g,i)=>traces.push({type:'scatter',mode:'text',x:[i+1],y:[bounds[i].mean],text:[bounds[i].mean.toPrecision(3)],textposition:'top center',showlegend:false,hoverinfo:'skip'}));}
  const f=Number(s.fontSize)||15;
  const yLower=Math.min(0,...bounds.map(b=>b.lowest))- (dataMinimum < 0 ? span*.06 : 0);
  const yTop=Math.max(...bounds.map(b=>b.highest));
  const lineOffset=Math.max(span*.095,Math.max(1,Math.abs(yTop))*.055);
  const shapes=[],annotations=[];
  if (comparisons.length>15) throw Error('More than 15 comparison brackets would overlap. Select a smaller subset in the graph settings (the full matrix remains available).');
  // Put overlapping brackets at distinct heights; label their adjusted P values explicitly.
  comparisons.forEach((c,k)=>{
    const i=groups.findIndex(g=>g.name===c.group1),j=groups.findIndex(g=>g.name===c.group2);
    if(i<0||j<0) return;
    const x0=Math.min(i,j)+1,x1=Math.max(i,j)+1;
    const bracketBase=yTop+lineOffset*(1+k*1.20);
    const stem=lineOffset*.22;
    shapes.push({type:'path',path:`M ${x0},${bracketBase-stem} L ${x0},${bracketBase} L ${x1},${bracketBase} L ${x1},${bracketBase-stem}`,
      line:{color:'#344650',width:1.2}});
    annotations.push({x:(x0+x1)/2,y:bracketBase+lineOffset*.08,xref:'x',yref:'y',text:s.annotationFormat==='p' ? `P(adj)=${niceP(c.p_adjusted)}` : s.annotationFormat==='raw' ?
        (c.p_raw==null?`P(adj)=${niceP(c.p_adjusted)}`:`P(raw)=${niceP(c.p_raw)}`) : stars(c.p_adjusted,alpha),
      showarrow:false,font:{size:Math.max(10,f-1),color:'#26343d'},yanchor:'bottom',bgcolor:'rgba(255,255,255,0.88)'});
  });
  const topAuto=Math.max(yTop+lineOffset*.2,yTop+lineOffset*(1+(comparisons.length-1)*1.2+1.1));
  const layout={template:'none',paper_bgcolor:'#ffffff',plot_bgcolor:'#ffffff',
    font:{family:'Arial, sans-serif',size:f,color:'#26343d'},title:{text:s.title||'',font:{size:f+2},x:.5},
    xaxis:{type:'linear',title:{text:s.xTitle&&s.xTitle!=='Group'?s.xTitle:''},tickmode:'array',tickvals:groups.map((_,i)=>i+1),ticktext:groups.map(g=>g.name),range:[0.4,groups.length+0.6],showgrid:false,showline:true,linewidth:1.4,linecolor:'#26343d',ticks:'',zeroline:false},
    yaxis:{title:{text:s.yTitle||'Measurement',standoff:14},showgrid:false,showline:true,linewidth:1.4,linecolor:'#26343d',zeroline:false,range:[yLower,s.yMax!=null?Number(s.yMax):topAuto]},
    shapes,annotations,
    margin:{l:90,r:28,t:s.title?58:36,b:78},showlegend:!!s.showLegend,hovermode:'closest',barmode:'group',boxmode:'group'};
  const config={responsive:true,displaylogo:false,modeBarButtonsToRemove:['toImage','lasso2d','select2d'],scrollZoom:false};
  return {traces,layout,config};
}
// Generic numeric X-axis plot for concentration and other quantitative dose series.
// Group headers must be numeric. Original observations are never overwritten.
export function doseLineSpec(groups,s,comparisons=[],alpha=.05){
  const x=numericDoseCoordinates(groups);
  const order=x.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v);
  const sorted=order.map(z=>groups[z.i]),xs=order.map(z=>z.v);
  const colors=palettes[s.palette]||palettes.journal;
  const avg=a=>a.reduce((u,v)=>u+v,0)/a.length;
  const dev=a=>a.length<2?0:Math.sqrt(a.reduce((u,v)=>u+(v-avg(a))**2,0)/(a.length-1));
  const means=sorted.map(g=>avg(g.values));
  const errors=sorted.map(g=>s.error==='none'?0:s.error==='sem'?dev(g.values)/Math.sqrt(g.values.length):dev(g.values));
  const color=colors[0],traces=[];
  const wantLines=s.showLines!==false;
  traces.push({type:'scatter',mode:[wantLines?'lines':'', 'markers'].filter(Boolean).join('+'),
    name:'Mean'+(s.error==='none'?'':` ± ${String(s.error).toUpperCase()}`),x:xs,y:means,
    line:{color,width:2.6},marker:{color,size:9,symbol:'circle'},showlegend:!!s.showLegend,
    error_y:s.error==='none'?undefined:{type:'data',array:errors,visible:true,width:5,thickness:1.4},
    text:s.showPointLabels?means.map(v=>v.toPrecision(3)):undefined,textposition:'top center',
    hovertemplate:'Dose %{x}<br>Mean %{y:.5g}<extra></extra>'});
  if(s.showPointLabels)traces[0].mode+='+text';
  if(s.showMarkers!==false){
    const differences=xs.slice(1).map((v,i)=>v-xs[i]).filter(v=>v>0);
    const minGap=differences.length?Math.min(...differences):1;
    const jitter=minGap*.12;
    sorted.forEach((g,i)=>traces.push({type:'scatter',mode:'markers',name:`${g.name}: replicates`,showlegend:false,
      x:g.values.map((_,j)=>xs[i]+(((j*.61803398875)%1)-.5)*jitter),y:g.values,
      marker:{color,size:6,opacity:.5},hovertemplate:`Dose ${g.name}<br>Replicate %{y:.5g}<extra></extra>`}));
  }
  const values=sorted.flatMap(g=>g.values);
  const lo=Math.min(...values),hi=Math.max(...values),span=Math.max(1,hi-lo);
  let top=Math.max(hi,...means.map((v,i)=>v+errors[i]))+span*.13;
  const yBottom=Math.min(0,lo-span*.06);
  const shapes=[],annotations=[];
  const rawBounds=sorted.map((g,i)=>Math.max(...g.values,means[i]+errors[i]));
  if(comparisons.length>15)throw Error('Select no more than 15 comparison brackets.');
  comparisons.forEach((c,k)=>{
    const i=sorted.findIndex(g=>g.name===c.group1),j=sorted.findIndex(g=>g.name===c.group2);
    if(i<0||j<0)return;
    const base=Math.max(top,rawBounds[i],rawBounds[j])+span*.16*(k+1);
    const b0=xs[Math.min(i,j)],b1=xs[Math.max(i,j)],stem=span*.045;
    shapes.push({type:'path',path:`M ${b0},${base-stem} L ${b0},${base} L ${b1},${base} L ${b1},${base-stem}`,line:{color:'#344650',width:1.2}});
    const p=c.p_adjusted,fmt=p==null?'n/a':p<.0001?p.toExponential(1):p.toPrecision(3);
    const label=s.annotationFormat==='p'?`P(adj)=${fmt}`:s.annotationFormat==='raw'?(c.p_raw==null?`P(adj)=${fmt}`:`P(raw)=${c.p_raw.toPrecision(3)}`):(p>=alpha?'ns':p<.0001?'****':p<.001?'***':p<.01?'**':'*');
    annotations.push({x:(b0+b1)/2,y:base+stem*.15,text:label,xref:'x',yref:'y',showarrow:false,font:{size:Math.max(10,Number(s.fontSize||15)-1)},bgcolor:'#ffffff'});
    top=Math.max(top,base+stem*2);
  });
  const minX=xs[0],maxX=xs.at(-1),gap=Math.max((maxX-minX)*.08,.001);
  const layout={template:'none',paper_bgcolor:'#fff',plot_bgcolor:'#fff',
    font:{family:'Arial, sans-serif',size:s.fontSize||15,color:'#26343d'},
    title:{text:s.title||'',x:.5},xaxis:{title:{text:s.xTitle||'Concentration'},range:[minX-gap,maxX+gap],
      tickmode:'array',tickvals:xs,ticktext:sorted.map(g=>g.name),showline:true,linecolor:'#26343d',showgrid:false,zeroline:false},
    yaxis:{title:{text:s.yTitle||'Response'},range:[yBottom,s.yMax==null?top:Number(s.yMax)],showline:true,linecolor:'#26343d',showgrid:false,zeroline:false},
    margin:{l:90,r:28,t:s.title?58:36,b:s.showLegend?102:78},showlegend:!!s.showLegend,
    legend:{orientation:'h',y:-.25,x:0},shapes,annotations,hovermode:'closest'};
  return {traces,layout,config:{responsive:true,displaylogo:false,modeBarButtonsToRemove:['toImage','lasso2d','select2d']}};
}
export async function renderPlot(el, groups, s, comparisons = [], alpha = .05) {
  if (!window.Plotly) throw new Error('Graph library unavailable. Check internet connection.');
  const {traces,layout,config}=plotSpec(groups,s,comparisons,alpha);
  await window.Plotly.react(el,traces,layout,config);
}
export async function figureSvg(el, settings) {
  if (!window.Plotly || !el?.data) throw new Error('Create a plot first');
  const dataUrl=await window.Plotly.toImage(el,{format:'svg',width:settings.width,height:settings.height});
  return await (await fetch(dataUrl)).text();
}
export async function figurePng(el, settings){
  return window.Plotly.toImage(el,{format:'png',width:settings.width,height:settings.height,scale:2});
}
export function downloadText(name, content, type='text/plain') {
  const blob = new Blob([content],{type});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export function downloadDataUrl(filename,url) {
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
}
