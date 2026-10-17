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
  annotationMode:'none',annotationFormat:'stars',shownPairs:[]});

// groups must contain validated numerical values, *not* the user's raw worksheet.
// The plot spec is deterministic and shared by browser preview and vector SVG export.
export function plotSpec(groups, s, comparisons = [], alpha = .05) {
  if (!Array.isArray(groups)||groups.length<2||groups.some(g=>!g.values?.length)) throw Error('No valid numeric groups to plot.');
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
    traces.push({type:'scatter',mode:'markers',x:values.map((_,j)=>i+1+jitter[j]),y:values,marker:{color,size:8,opacity:.92,line:{color:'#ffffff',width:.5}},showlegend:false,hovertemplate:`${g.name}: %{y:.3g}<extra></extra>`});
  });
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
    xaxis:{type:'linear',tickmode:'array',tickvals:groups.map((_,i)=>i+1),ticktext:groups.map(g=>g.name),range:[0.4,groups.length+0.6],showgrid:false,showline:true,linewidth:1.4,linecolor:'#26343d',ticks:'',zeroline:false},
    yaxis:{title:{text:s.yTitle||'Measurement',standoff:14},showgrid:false,showline:true,linewidth:1.4,linecolor:'#26343d',zeroline:false,range:[yLower,s.yMax!=null?Number(s.yMax):topAuto]},
    shapes,annotations,
    margin:{l:90,r:28,t:s.title?58:36,b:78},showlegend:false,hovermode:'closest',barmode:'group',boxmode:'group'};
  const config={responsive:true,displaylogo:false,modeBarButtonsToRemove:['toImage','lasso2d','select2d'],scrollZoom:false};
  return {traces,layout,config};
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
