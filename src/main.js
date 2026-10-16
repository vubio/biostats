import {runStatisticalTest} from './stats.js';
import {renderPlot,figureSvg,figurePng,downloadText,downloadDataUrl,defaultChartSettings,plotSpec} from './charts.js';
import {newProject,openProject,isProjectOpen,currentProject,projectFolderName,saveNewRecord,loadRecord,makeReport,escapeHtml,formatP,APP_VERSION} from './projects.js';
const byId=id=>document.getElementById(id);
const SAMPLE='Control,Drug A,Drug B\n42,58,76\n49,65,82\n55,61,89\n47,70,80\n52,63,85';
let groups=[];
let lastAnalysis=null;
let lastInputs=null;
let lastDataSignature=null;
const plotEl=byId('plot');
function message(text,error=false){const b=byId('message');b.hidden=false;b.textContent=text;b.classList.toggle('error',error);}
function clearMessage(){byId('message').hidden=true;}
function titleStr(){return byId('dataset-name').value.trim()||'Untitled experiment';}
function noteStr(){return byId('data-sheet').value.trim();}
function alpha(){return Number(byId('alpha').value);}
function readSettings(){
  const ymax=byId('y-max').value.trim();
  const width=Number(byId('plot-width').value)||800;
  const fs=Number(byId('font-size').value)||15;
  if(ymax!==''&&(!Number.isFinite(Number(ymax))||Number(ymax)<=0))throw new Error('Y-axis max must be positive');
  if(!Number.isInteger(width)||width<300||width>2400)throw new Error('Export width must be 300–2400 px');
  if(fs<8||fs>32)throw new Error('Font size must be 8–32 pt');
  return {...defaultChartSettings(),type:byId('plot-type').value,error:byId('error-type').value,
    palette:byId('palette').value,yMax:ymax===''?null:Number(ymax),yTitle:byId('y-title').value,
    title:byId('figure-title').value,fontSize:fs,width};
}
function signature(){return JSON.stringify({groups,name:titleStr(),note:noteStr(),test:byId('test-select').value,alpha:alpha()});}
function parseRows(text){
  const clean=text.replace(/^\uFEFF/,'').trim();
  if(!clean)throw new Error('Paste a table or import CSV/XLSX first.');
  const sep=clean.split(/\r?\n/)[0].includes('\t')?'\t':',';
  const rows=[];let row=[];let field='';let quoted=false;
  for(let i=0;i<clean.length;i++){
    const c=clean[i];
    if(c==='"'){
      if(quoted&&clean[i+1]==='"'){field+='"';i++;}
      else quoted=!quoted;
    }else if(c===sep&&!quoted){row.push(field);field='';}
    else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&clean[i+1]==='\n')i++;row.push(field);rows.push(row);field='';row=[];}
    else field+=c;
  }
  if(quoted)throw new Error('CSV has an unmatched quotation mark');
  row.push(field);rows.push(row);
  return rows;
}
function parseData(text){
  const rows=parseRows(text);
  const headers=rows[0].map(x=>x.trim());
  if(headers.length<2)throw new Error('At least two group columns are needed');
  if(headers.some(x=>!x))throw new Error('Column headings cannot be blank');
  if(new Set(headers).size!==headers.length)throw new Error('Group headings must be distinct');
  const out=headers.map(name=>({name,values:[]}));
  rows.slice(1).forEach((row,ri)=>{
    row.forEach((cell,i)=>{
      if(i>=headers.length&&cell.trim())throw new Error(`Extra cell at row ${ri+2}`);
      if(i>=headers.length||cell.trim()==='')return;
      const num=Number(cell.trim());
      if(!Number.isFinite(num))throw new Error(`Non-numeric value "${cell}" at row ${ri+2}, column ${headers[i]}`);
      out[i].values.push(num);
    });
  });
  if(out.some(g=>g.values.length<2))throw new Error('Each group needs at least two numerical measurements');
  return out;
}
function csvEscape(x){const s=String(x);return /[",\n\t]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
function dataAsCsv(grps){
  const n=Math.max(...grps.map(g=>g.values.length));
  return [grps.map(g=>csvEscape(g.name)).join(','),...Array.from({length:n},(_,i)=>grps.map(g=>g.values[i]===undefined?'':csvEscape(g.values[i])).join(','))].join('\n')+'\n';
}
async function sha256(str){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
function renderPreview(){
  if(!groups.length){byId('data-preview').textContent='No data loaded.';return;}
  const max=Math.max(...groups.map(g=>g.values.length));
  const headers=groups.map(g=>`<th>${escapeHtml(g.name)} <small>(n=${g.values.length})</small></th>`).join('');
  const rows=Array.from({length:Math.min(max,14)},(_,i)=>`<tr>${groups.map(g=>`<td>${g.values[i]??''}</td>`).join('')}</tr>`).join('');
  byId('data-preview').innerHTML=`<table class="preview-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>${max>14?'<p class="hint" style="margin:10px">Showing the first 14 rows.</p>':''}`;
}
let pendingRender;
async function draw(){
  if(!groups.length){plotEl.textContent='Import a dataset to preview a graph.';return;}
  try{await renderPlot(plotEl,groups,readSettings());}catch(e){message(e.message,true);}
}
function scheduleDraw(){clearTimeout(pendingRender);pendingRender=setTimeout(draw,160);}
async function applyData(){
  groups=parseData(byId('data-input').value);
  renderPreview();
  // Old P-values are no longer displayed on a changed dataset.
  lastAnalysis=null;lastInputs=null;lastDataSignature=null;
  byId('analysis-results').className='results-placeholder';
  byId('analysis-results').textContent='Data changed. Run a fresh statistical analysis before saving a record.';
  await draw();clearMessage();
}
function resultHtml(r){
  const summaries=r.group_summaries.map(x=>`<tr><td>${escapeHtml(x.group)}</td><td>${x.n}</td><td>${x.mean.toPrecision(5)}</td><td>${x.sd.toPrecision(5)}</td></tr>`).join('');
  const comp=r.posthoc?.comparisons?.length?`<h3 class="hint">Tukey HSD — all pairs</h3><table class="results-table"><thead><tr><th>Comparison</th><th>Mean difference</th><th>Adjusted P</th></tr></thead><tbody>${r.posthoc.comparisons.map(c=>`<tr><td>${escapeHtml(c.group1)} → ${escapeHtml(c.group2)}</td><td>${c.difference.toPrecision(5)}</td><td>${formatP(c.p_adjusted)}</td></tr>`).join('')}</tbody></table>`:'';
  return `<div class="result-card"><strong>${escapeHtml(r.label)}</strong><div class="value">P = ${formatP(r.p_value)}</div><p>Statistic = ${r.statistic.toPrecision(6)} · df = ${r.df.map(x=>Number(x).toPrecision(5)).join(', ')} · α = ${r.alpha}</p></div><table class="results-table"><thead><tr><th>Group</th><th>n</th><th>Mean</th><th>SD</th></tr></thead><tbody>${summaries}</tbody></table>${comp}<p class="hint">Calculated with ${escapeHtml(r.engine.primary_function)} · SciPy ${escapeHtml(r.engine.python_packages.scipy)} · statsmodels ${escapeHtml(r.engine.python_packages.statsmodels)}.</p><p class="hint">${escapeHtml(r.limitations)}</p>`;
}
async function runAnalysis(){
  if(!groups.length)throw new Error('Import data first');
  const data={groups:structuredClone(groups),test:byId('test-select').value,alpha:alpha()};
  byId('run-stats').disabled=true;
  try{
    const result=await runStatisticalTest(data,t=>{
      byId('analysis-running').textContent=t;
      byId('engine-status').textContent=t;
    });
    lastAnalysis=result;lastInputs=structuredClone(groups);lastDataSignature=signature();
    byId('analysis-results').className='';byId('analysis-results').innerHTML=resultHtml(result);
    byId('engine-status').textContent='Python statistical engine ready';
    byId('engine-status').className='status-pill ready';
    message('Statistics calculated. Save this analysis to preserve its input values and frozen SVG.');
  }finally{byId('run-stats').disabled=false;byId('analysis-running').textContent='';}
}
function ensureResults(){
  if(!lastAnalysis||!lastInputs)throw new Error('Run a statistical analysis first.');
  if(signature()!==lastDataSignature)throw new Error('The dataset name, notes, test settings or data have changed since the calculation. Rerun the test before saving.');
}
async function recordForExport(){
  ensureResults();
  const settings=readSettings();
  return {schema_version:'1.0.0',created_at:new Date().toISOString(),
    software:{version:APP_VERSION,runtime:'Pyodide 0.28.3',source_page:location.href},
    dataset:{name:titleStr(),note:noteStr(),groups:lastInputs,sha256:await sha256(dataAsCsv(lastInputs))},
    graph:{settings,renderer:'Plotly.js',renderer_version:'3.7.0'},statistics:lastAnalysis};
}
async function save(){
  if(!isProjectOpen())throw new Error('Create or open a local project folder first.');
  const record=await recordForExport();
  const svg=await figureSvg(plotEl,record.graph.settings);
  await saveNewRecord({groups:lastInputs,settings:record.graph.settings,result:lastAnalysis,svg,
    description:{name:titleStr(),note:noteStr()},dataCsv:dataAsCsv(lastInputs),sha256:record.dataset.sha256});
  showSaved();message('Analysis, frozen SVG, data and HTML report were saved inside your local project folder.');
}
function showSaved(){
  const p=currentProject();
  byId('project-name').textContent=p?.project_name||'No project selected';
  byId('project-path').textContent=p?`Local project: ${projectFolderName()} · ${p.analyses.length} saved analyses`:'Choose an empty local folder to create a project.';
  const el=byId('saved-analyses');el.replaceChildren();
  if(!p){el.innerHTML='<p class="muted">Create or open a project folder to save analyses.</p>';return;}
  if(!p.analyses.length){el.innerHTML='<p class="muted">No analyses saved yet.</p>';return;}
  for(const rec of [...p.analyses].reverse()){
    const row=document.createElement('div');row.className='saved-row';
    const heading=document.createElement('div');
    const strong=document.createElement('strong');strong.textContent=rec.name;
    const small=document.createElement('small');small.textContent=`${rec.test} · P=${formatP(rec.p_value)} · BioStats ${rec.app_version} · ${new Date(rec.date).toLocaleString()}`;
    heading.append(strong,small);
    const actions=document.createElement('div');actions.className='saved-actions';
    const button=document.createElement('button');button.className='btn btn-soft';button.textContent='View frozen original';
    button.addEventListener('click',()=>handle(()=>viewFrozen(rec.id)));
    actions.append(button);row.append(heading,actions);el.append(row);
  }
}
async function viewFrozen(id){
  const {analysis,svg}=await loadRecord(id);
  const dialog=document.createElement('dialog');dialog.style.cssText='max-width:min(880px,95vw);max-height:92vh;width:880px;border:1px solid #cbd5e1;border-radius:15px;padding:18px;box-shadow:0 18px 55px #1a2c3b33;';
  const title=document.createElement('h2');title.textContent=`Frozen original: ${analysis.dataset.name}`;
  const intro=document.createElement('p');intro.style.color='#506376';intro.textContent=`${analysis.statistics.label} · P=${formatP(analysis.statistics.p_value)} · BioStats ${analysis.software.version} · ${analysis.created_at}`;
  const img=document.createElement('img');const blob=new Blob([svg],{type:'image/svg+xml'});const url=URL.createObjectURL(blob);img.src=url;img.alt='Original preserved vector figure';img.style.cssText='width:100%;max-height:58vh;object-fit:contain;border:1px solid #e2e8f0;border-radius:9px;';
  const foot=document.createElement('div');foot.style.cssText='display:flex;gap:10px;margin-top:16px;flex-wrap:wrap';
  const svgBtn=document.createElement('button');svgBtn.className='btn btn-primary';svgBtn.textContent='Download frozen SVG';svgBtn.onclick=()=>downloadText(`${id}.svg`,svg,'image/svg+xml');
  const close=document.createElement('button');close.className='btn btn-soft';close.textContent='Close';close.onclick=()=>dialog.close();
  foot.append(svgBtn,close);dialog.append(title,intro,img,foot);
  dialog.addEventListener('close',()=>{URL.revokeObjectURL(url);dialog.remove();});document.body.append(dialog);dialog.showModal();
}
function handle(fn){Promise.resolve().then(fn).catch(e=>{
  if(e.name==='AbortError')return;
  message(e?.message||String(e),true);
});}
function bind(){
  byId('load-example').onclick=()=>handle(async()=>{byId('dataset-name').value='Example: mouse measurement (synthetic)';byId('data-sheet').value='Demonstration values only; not experimental evidence';byId('data-input').value=SAMPLE;await applyData();});
  byId('apply-data').onclick=()=>handle(applyData);
  byId('new-project').onclick=()=>handle(async()=>{await newProject();showSaved();message('Project folder created. Research project files stay on your computer.');});
  byId('open-project').onclick=()=>handle(async()=>{await openProject();showSaved();message('Existing project opened. Saved results will not be recalculated.');});
  byId('run-stats').onclick=()=>handle(runAnalysis);
  byId('save-analysis').onclick=()=>handle(save);
  byId('data-file').onchange=()=>handle(async()=>{
    const file=byId('data-file').files[0];if(!file)return;
    let text;
    if(/\.xlsx?$/.test(file.name.toLowerCase())){
      if(!window.XLSX)throw new Error('Excel reader not loaded. Check internet connection.');
      const book=window.XLSX.read(await file.arrayBuffer(),{type:'array'});
      const sheet=book.Sheets[book.SheetNames[0]];
      const rows=window.XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});
      text=rows.map(row=>row.map(csvEscape).join(',')).join('\n');
    }else text=await file.text();
    byId('data-input').value=text;
    byId('dataset-name').value=file.name.replace(/\.[^.]+$/,'');
    await applyData();
    message(`Imported ${file.name}. Review the group and replicate structure before analysis.`);
    byId('data-file').value='';
  });
  for(const key of ['plot-type','error-type','palette','y-max','y-title','figure-title','font-size','plot-width']){
    const el=byId(key);el.addEventListener('input',scheduleDraw);el.addEventListener('change',scheduleDraw);
  }
  for(const key of ['dataset-name','data-sheet','test-select','alpha']){
    byId(key).addEventListener('change',()=>{if(lastDataSignature!==null&&signature()!==lastDataSignature)message('Analysis settings changed. Rerun the test before saving a new record.');});
  }
  byId('export-svg').onclick=()=>handle(async()=>{
    if(!groups.length)throw new Error('Load a dataset first');
    const svg=await figureSvg(plotEl,readSettings());
    downloadText('biostats_figure.svg',svg,'image/svg+xml');
    message('Vector SVG downloaded. To archive it with statistics, use Save analysis + figure to project.');
  });
  byId('export-png').onclick=()=>handle(async()=>{
    if(!groups.length)throw new Error('Load a dataset first');
    const url=await figurePng(plotEl,readSettings());downloadDataUrl('biostats_figure.png',url);
  });
  byId('print-pdf').onclick=()=>handle(async()=>{
    if(!groups.length)throw new Error('Load a dataset first');
    const svg=await figureSvg(plotEl,readSettings());
    const blob=new Blob([svg],{type:'image/svg+xml'}),url=URL.createObjectURL(blob);
    const holder=byId('printable-figure');holder.replaceChildren();
    const img=document.createElement('img');img.src=url;img.alt='Vector figure for printing';holder.append(img);
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('SVG print rendering failed'));});
    window.print();setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  byId('download-report').onclick=()=>handle(async()=>{
    const record=await recordForExport();
    downloadText('biostats_statistical_report.html',makeReport(record),'text/html');
  });
}
bind();showSaved();
plotEl.textContent='Load example data or import your spreadsheet to display a figure.';
