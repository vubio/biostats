import {runStatisticalTest} from './stats.js';
import {renderPlot,figureSvg,figurePng,downloadText,downloadDataUrl,defaultChartSettings} from './charts.js';
import {newProject,openProject,isProjectOpen,currentProject,projectFolderName,saveNewRecord,loadRecord,makeReport,escapeHtml,formatP,APP_VERSION} from './projects.js';
import {examples,examplesFor,isPairedTest,isTTest} from './examples.js';
import {METHODS,FAMILY_NAMES,isSpecial,specialHeaders,defaultLongRows,validateSpecialTable,familyForTest} from './families.js';
import {renderSpecial} from './plots-special.js';

const $=id=>document.getElementById(id);
const PAGE_SIZE=50;
let rows=[];                      // Canonical, editable values: always used for statistics
let groups=[];                    // Validated numeric projection of those rows
let familyData=null;               // Validated long-format records for specialized analyses
let subjectIds=[];
let gridPage=0;
let provenance={kind:'manual',filename:null};
let importedRowsSnapshot=null;    // Used only to detect changes, never uploaded
let lastAnalysis=null;
let lastDataSignature=null;
const plotEl=$('plot');
let drawTimer=null;
let previewRevision=0;
let chosenPairs=new Set();
const pairKey=(a,b)=>JSON.stringify([a,b].sort());
const entryTest=()=>$('test-select').value;
const entryFamily=()=>$('analysis-family').value;
const special=()=>isSpecial(entryTest());
const validDataset=()=>special()?Boolean(familyData?.records?.length):Boolean(groups.length);
const paired=()=>isPairedTest(entryTest());
const name=()=>$('dataset-name').value.trim()||'Untitled experiment';
const note=()=>$('data-sheet').value.trim();
const alpha=()=>Number($('alpha').value);
const alternative=()=>isTTest(entryTest())?$('alternative').value:'two-sided';

function message(text,error=false){const b=$('message');b.hidden=false;b.textContent=text;b.classList.toggle('error',error);}
function clearMessage(){$('message').hidden=true;}
function invalidate(){
  lastAnalysis=null;lastDataSignature=null;
  chosenPairs.clear();
  $('comparison-panel').hidden=true;
  $('analysis-results').className='results-placeholder';
  $('analysis-results').textContent='Dataset or analysis settings changed. Run statistics again on the current table.';
}
function signature(){return JSON.stringify({rows,name:name(),note:note(),family:entryFamily(),test:entryTest(),alternative:alternative(),alpha:alpha()});}
function csvCell(v){const t=String(v??'');return /[",\r\n\t]/.test(t)?`"${t.replaceAll('"','""')}"`:t;}
function canonicalCsv(data){return data.map(row=>row.map(csvCell).join(',')).join('\n')+'\n';}
async function sha256(str){const data=new TextEncoder().encode(str);return hashBytes(data);}
async function hashBytes(bytes){const h=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function parseRows(input){
  const clean=input.replace(/^\uFEFF/,'');
  if(!clean.trim())throw Error('Paste data or create a blank table first.');
  const firstLine=clean.split(/\r?\n/)[0];
  const sep=firstLine.includes('\t')?'\t':',';
  let quoted=false,cell='',row=[],out=[];
  for(let i=0;i<clean.length;i++){
    const c=clean[i];
    if(c==='"'){if(quoted&&clean[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===sep&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&clean[i+1]==='\n')i++;row.push(cell);out.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw Error('Unmatched quotation mark in CSV.');
  row.push(cell);out.push(row);
  // Remove empty trailing rows (common with CSV export and Excel).
  while(out.length>1&&out.at(-1).every(v=>String(v).trim()===''))out.pop();
  return out.map(r=>r.map(v=>String(v??'')));
}
function validateTable(data){
  if(!data.length)throw Error('Enter a dataset first.');
  const isPaired=paired();
  const labels=(isPaired?data[0].slice(1):data[0]).map(s=>s.trim());
  if(isPaired&&data[0][0]?.trim().toLowerCase()!=='subject id')throw Error('Paired tables must begin with the “Subject ID” column. Create a paired template or import a paired table.');
  if(labels.length<2||labels.some(x=>!x))throw Error('Enter at least two named measurement columns.');
  if(new Set(labels).size!==labels.length)throw Error('Group names must be unique.');
  if((isTTest(entryTest())||isPaired)&&labels.length!==2)throw Error('This test requires exactly two measurement columns.');
  if(!isTTest(entryTest())&&labels.length<3)throw Error('Choose at least three groups for this omnibus test.');
  const expected=labels.length+(isPaired?1:0),values=labels.map(()=>[]),ids=[];
  data.slice(1).forEach((row,index)=>{
    if(row.slice(expected).some(x=>String(x).trim()!==''))throw Error(`Extra value at row ${index+2}.`);
    const cells=labels.map((_,i)=>String(row[i+(isPaired?1:0)]??'').trim());
    const identifier=isPaired?String(row[0]??'').trim():'';
    if(isPaired){
      if(!identifier&&!cells.some(Boolean))return; // Empty end-of-table row
      if(!identifier||cells.some(x=>!x))throw Error(`Paired row ${index+2} needs an ID and both measurements. Do not re-pair values by skipping individual cells.`);
      if(ids.includes(identifier))throw Error(`Repeated Subject ID “${identifier}”.`);
      ids.push(identifier);
    }
    cells.forEach((cell,i)=>{
      if(!cell)return;
      const number=Number(cell);
      if(!Number.isFinite(number))throw Error(`Non-numeric measurement “${cell}” in row ${index+2}, column ${labels[i]}.`);
      values[i].push(number);
    });
  });
  if(values.some(v=>v.length<2))throw Error('At least two numerical measurements are required in every group.');
  if(isPaired&&values[0].length!==values[1].length)throw Error('Every matched subject needs both measurements.');
  return {groups:labels.map((label,i)=>({name:label,values:values[i]})),subjectIds:ids};
}
function fileChanged(){return importedRowsSnapshot!==null&&JSON.stringify(rows)!==importedRowsSnapshot;}
function sourceDescription(){
  if(provenance.kind==='import')return `${provenance.filename} (${provenance.bytes} bytes) · ${fileChanged()?'Edited after import':'Unchanged after import'}`;
  if(provenance.kind==='example')return `${provenance.example_title} · ${fileChanged()?'Edited example':'Unchanged example'}`;
  return 'Manually entered dataset';
}
function renderGrid(){
  const el=$('data-preview');el.replaceChildren();
  if(!rows.length){el.textContent='No data yet. Use Create blank table, Load example, or Import.';$('table-navigation').hidden=true;return;}
  const width=rows[0].length, dataN=Math.max(0,rows.length-1),pages=Math.max(1,Math.ceil(dataN/PAGE_SIZE));
  gridPage=Math.min(gridPage,pages-1);
  const start=1+gridPage*PAGE_SIZE,end=Math.min(rows.length,start+PAGE_SIZE);
  const table=document.createElement('table');table.className='preview-table editable-grid';
  const head=document.createElement('thead');const tr=document.createElement('tr');
  const corner=document.createElement('th');corner.textContent='#';tr.append(corner);
  rows[0].forEach((v,i)=>{
    const cell=document.createElement('th');const input=document.createElement('input');input.value=v;
    input.dataset.row='0';input.dataset.col=String(i);input.setAttribute('aria-label',`Column ${i+1} header`);
    if((paired()&&i===0)||special()){input.readOnly=true;input.title='This analysis requires fixed column headers; create a new template to change the method.';}
    cell.append(input);tr.append(cell);
  });head.append(tr);table.append(head);
  const body=document.createElement('tbody');
  for(let ri=start;ri<end;ri++){
    const tr=document.createElement('tr');const line=document.createElement('td');line.className='row-index';line.textContent=String(ri);tr.append(line);
    for(let ci=0;ci<width;ci++){
      const cell=document.createElement('td');const input=document.createElement('input');
      input.value=rows[ri]?.[ci]??'';input.dataset.row=String(ri);input.dataset.col=String(ci);
      input.setAttribute('aria-label',`Row ${ri}, column ${ci+1}`);input.autocomplete='off';
      cell.append(input);tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body);el.append(table);
  $('table-navigation').hidden=dataN<=PAGE_SIZE;
  $('page-info').textContent=`Rows ${Math.max(1,start)}–${Math.max(1,end-1)} of ${dataN}`;
  $('prev-page').disabled=gridPage===0;$('next-page').disabled=gridPage>=pages-1;
  $('add-group').disabled=special()||paired()||rows[0].length>=40;
  $('remove-row').disabled=rows.length<=2;
}
async function reproject({strict=false}={}){
  const revision=++previewRevision;
  if(!rows.length){groups=[];subjectIds=[];familyData=null;plotEl.replaceChildren();plotEl.textContent='Create a dataset to display a graph.';return;}
  let parsed;
  try { parsed=special()?validateSpecialTable(rows,entryTest()):validateTable(rows); }
  catch(e){
    if(revision===previewRevision){
      groups=[];subjectIds=[];familyData=null;plotEl.replaceChildren();
      plotEl.textContent=`Data preview unavailable: ${e.message}`;
      $('edit-state').textContent=`Check table: ${e.message}`;
    }
    if(strict)throw e;
    return;
  }
  if(revision!==previewRevision)return;
  if(special()){familyData=parsed;groups=[];subjectIds=[];}else{groups=parsed.groups;subjectIds=parsed.subjectIds;familyData=null;}
  $('edit-state').textContent=special()?`${parsed.rows} complete observational rows · ${sourceDescription()}`:`${groups.length} groups · ${Math.max(...groups.map(g=>g.values.length))} max observations/group · ${sourceDescription()}`;
  // A plotting-library failure is distinct from invalid data. Never erase a
  // statistically valid dataset with a generic "complete the table" message.
  await draw();
}
function refreshLater(){clearTimeout(drawTimer);drawTimer=setTimeout(()=>reproject(),350);}
async function replaceGrid(newRows,newSource,sourceSnapshot=null){
  rows=newRows.map(r=>r.map(v=>String(v??'')));
  const size=rows.reduce((maximum,row)=>Math.max(maximum,row.length),0);rows=rows.map(r=>Array.from({length:size},(_,i)=>r[i]??''));
  provenance=newSource;importedRowsSnapshot=sourceSnapshot??(newSource.kind==='manual'?null:JSON.stringify(rows));
  gridPage=0;invalidate();renderGrid();await reproject();
}
async function blankTable(){
  const t=paired();const headers=t?['Subject ID','Before','After']:(isTTest(entryTest())?['Control','Treatment']:['Control','Drug A','Drug B']);
  const data=special()?defaultLongRows(entryTest()):[headers,...Array.from({length:6},(_,i)=>headers.map((_,j)=>t&&j===0?`Subject ${i+1}`:''))];
  await replaceGrid(data,{kind:'manual',filename:null});$('data-input').value='';message('Blank editable table created. Type directly into any cell.');
}
function readSettings(){
  const max=$('y-max').value.trim(),width=Number($('plot-width').value)||800,fs=Number($('font-size').value)||15;
  if(max!==''&&(!Number.isFinite(Number(max))||Number(max)<=0))throw Error('Y-axis maximum must be positive.');
  if(!Number.isInteger(width)||width<300||width>2400)throw Error('Export width must be 300–2400 px.');
  if(fs<8||fs>32)throw Error('Font size must be 8–32 px.');
  return {...defaultChartSettings(),type:$('plot-type').value,error:$('error-type').value,palette:$('palette').value,yMax:max===''?null:Number(max),yTitle:$('y-title').value,title:$('figure-title').value,fontSize:fs,width,
    annotationMode:$('annotation-mode').value,annotationFormat:$('annotation-format').value,shownPairs:selectedComparisons().map(c=>[c.group1,c.group2])};
}
function selectedComparisons(){
  if(!lastAnalysis || lastDataSignature!==signature())return [];
  const cs=lastAnalysis.posthoc?.comparisons||[];
  const mode=$('annotation-mode').value;
  if(mode==='none')return [];
  if(mode==='control')return cs.filter(c=>c.group1===groups[0]?.name||c.group2===groups[0]?.name);
  if(mode==='all')return cs;
  return cs.filter(c=>chosenPairs.has(pairKey(c.group1,c.group2)));
}
async function draw({strict=false}={}){
  if(!validDataset())return;
  try{
    if(special()){
      $('annotation-warning').textContent='';
      await renderSpecial(plotEl,entryTest(),familyData.records,readSettings(),lastDataSignature===signature()?lastAnalysis:null);
      return;
    }
    const selections=selectedComparisons();
    if(selections.length>15)throw Error(`${selections.length} pairs selected. Maximum 15 graph brackets; select a subset in the comparison matrix. All P values remain accessible in the results.`);
    $('annotation-warning').textContent='';
    await renderPlot(plotEl,groups,readSettings(),selections,alpha());
  }catch(e){
    $('annotation-warning').textContent=e.message;
    message(`Graphing error: ${e.message}. Numerical data remain intact.`,true);
    if(strict)throw e;
  }
}
function matrixP(v){return v==null?'—':formatP(v);}
function renderComparisonMatrix(){
  const panel=$('comparison-panel');const comparisons=lastAnalysis?.posthoc?.comparisons||[];
  panel.hidden=!comparisons.length;
  const dest=$('comparison-matrix');dest.replaceChildren();
  if(!comparisons.length)return;
  const headings=special()?['Group 1','Group 2','Raw P','Adjusted P']:['Graph','Group 1','Group 2','Mean difference (2 − 1)','Raw P','Adjusted P'];
  const table=document.createElement('table');table.className='results-table';
  const header=document.createElement('thead');const hrow=document.createElement('tr');
  headings.forEach(h=>{const th=document.createElement('th');th.textContent=h;hrow.append(th);});header.append(hrow);table.append(header);
  const body=document.createElement('tbody');
  comparisons.forEach(c=>{
    const tr=document.createElement('tr');
    if(!special()){const td=document.createElement('td');const ch=document.createElement('input');ch.type='checkbox';ch.className='pair-checkbox';ch.dataset.pair=pairKey(c.group1,c.group2);
      ch.setAttribute('aria-label',`Display ${c.group1} versus ${c.group2} on figure`);ch.checked=chosenPairs.has(pairKey(c.group1,c.group2));td.append(ch);tr.append(td);}
    for(const value of (special()?[c.group1,c.group2,matrixP(c.p_raw),matrixP(c.p_adjusted)]:[c.group1,c.group2,c.difference.toPrecision(5),matrixP(c.p_raw),matrixP(c.p_adjusted)])){
      const td=document.createElement('td');td.textContent=value;tr.append(td);
    }
    body.append(tr);
  });
  table.append(body);dest.append(table);
  $('comparison-note').textContent=special()?`Method: ${lastAnalysis.posthoc.method}. Holm adjustment includes all ${comparisons.length} survival comparisons. Graph brackets are not currently used for Kaplan–Meier curves.`:`Method: ${lastAnalysis.posthoc.method}. All ${comparisons.length} pairs are in the adjustment family (for multi-group tests), even if only some brackets are displayed. Tukey HSD does not provide a separate unadjusted pairwise P value.`;
  dest.hidden=!$('show-matrix').checked;
  syncPairChecks();
}
function syncPairChecks(){
  const mode=$('annotation-mode').value;
  const selected=new Set(selectedComparisons().map(c=>pairKey(c.group1,c.group2)));
  document.querySelectorAll('.pair-checkbox').forEach(ch=>{ch.checked=selected.has(ch.dataset.pair);});
}
function resultHtml(r){
  const primary=r.p_value==null?'No hypothesis-test P value':`${r.primary_effect?escapeHtml(r.primary_effect)+': ':''}P = ${formatP(r.p_value)}`;
  const statistic=r.statistic==null?'':`Statistic = ${Number(r.statistic).toPrecision(6)} · df = ${(r.df||[]).map(x=>Number(x).toPrecision(5)).join(', ')} · α = ${r.alpha}`;
  const summaries=(r.group_summaries||[]).map(x=>`<tr><td>${escapeHtml(x.group)}</td><td>${x.n}</td><td>${x.mean.toPrecision(5)}</td><td>${x.sd.toPrecision(5)}</td></tr>`).join('');
  const summaryTable=summaries?`<table class="results-table"><thead><tr><th>Group / cell</th><th>n</th><th>Mean</th><th>SD</th></tr></thead><tbody>${summaries}</tbody></table>`:'';
  const effects=r.effects?.length?`<h3>Factor-level effects</h3><table class="results-table"><thead><tr><th>Effect</th><th>F</th><th>Numerator / denominator df</th><th>P</th></tr></thead><tbody>${r.effects.map(x=>`<tr><td>${escapeHtml(x.effect)}</td><td>${x.statistic.toPrecision(5)}</td><td>${x.df.join(' / ')}</td><td>${formatP(x.p_value)}</td></tr>`).join('')}</tbody></table>`:'';
  const survival=r.survival?.length?`<h3>Survival observations</h3><table class="results-table"><thead><tr><th>Group</th><th>Animals / subjects</th><th>Events</th><th>Censored</th></tr></thead><tbody>${r.survival.map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${x.n}</td><td>${x.events}</td><td>${x.censored}</td></tr>`).join('')}</tbody></table>`:'';
  const fit=r.fits?.length?`<h3>Fitted curves (relative IC50)</h3><table class="results-table"><thead><tr><th>Curve</th><th>IC50 (input dose units)</th><th>Approximate 95% CI</th><th>Hill slope</th><th>R²</th></tr></thead><tbody>${r.fits.map(x=>`<tr><td>${escapeHtml(x.group)}</td><td>${x.ic50.toPrecision(5)}</td><td>${x.ci95_approx?.map(v=>v.toPrecision(4)).join(' – ')||'Unavailable'}</td><td>${x.hill.toPrecision(4)}</td><td>${x.r_squared.toPrecision(4)}</td></tr>`).join('')}</tbody></table>`:'';
  const comp=r.posthoc?.comparisons?.length?`<p class="hint">Pairwise comparisons are in the matrix below. Adjusted P values account for the displayed comparison family.</p>`:'';
  const pkg=r.engine.python_packages||{};
  return `<div class="result-card"><strong>${escapeHtml(r.label)}</strong><div class="value">${primary}</div><p>${statistic}</p></div>${effects}${summaryTable}${survival}${fit}${comp}<p class="hint">${escapeHtml(r.engine.primary_function)} · SciPy ${escapeHtml(pkg.scipy)} · statsmodels ${escapeHtml(pkg.statsmodels)}.</p><p class="hint">${escapeHtml(r.limitations)}</p>`;
}

async function runAnalysis(){
  await reproject({strict:true});
  const input=special()?{family:entryFamily(),test:entryTest(),records:structuredClone(familyData.records),alpha:alpha()}:{groups:structuredClone(groups),test:entryTest(),alpha:alpha(),alternative:alternative(),subject_ids:paired()?structuredClone(subjectIds):null};
  const sig=signature();$('run-stats').disabled=true;
  try{
    const result=await runStatisticalTest(input,status=>{$('analysis-running').textContent=status;$('engine-status').textContent=status;});
    if(sig!==signature())throw Error('Data changed while the analysis was running. Run it again.');
    lastAnalysis=result;lastDataSignature=sig;$('analysis-results').className='';$('analysis-results').innerHTML=resultHtml(result);
    chosenPairs.clear();renderComparisonMatrix();await draw();
    $('engine-status').textContent='Python statistical engine ready';$('engine-status').className='status-pill ready';
    message('Statistics calculated from the current editable table. Save to preserve results.');
  }finally{$('run-stats').disabled=false;$('analysis-running').textContent='';}
}
function ensureResults(){if(!lastAnalysis)throw Error('Run a statistical analysis first.');if(signature()!==lastDataSignature)throw Error('Your data or settings changed. Rerun the test before saving or exporting its report.');}
async function makeCurrentRecord(){
  ensureResults();const processed=canonicalCsv(rows),preserve=$('store-values').checked;
  return {schema_version:'1.1.0',created_at:new Date().toISOString(),
    software:{name:'BioStats',version:APP_VERSION,runtime:'Pyodide 0.28.3',source_page:location.origin+location.pathname,
      source_git_commit:'recorded by the deployment release when available'},
    dataset:{name:name(),note:note(),family:entryFamily(),test_id:entryTest(),groups:preserve&&!special()?structuredClone(groups):undefined,records:preserve&&special()?structuredClone(familyData.records):undefined,
      processed_sha256:await sha256(processed),processed_values_stored:preserve,
      source:{...provenance,modified_after_import:provenance.kind==='import'?fileChanged():null,
        modified_after_example:provenance.kind==='example'?fileChanged():null,
        original_file_unmodified:true}},
    graph:{settings:readSettings(),renderer:'Plotly.js',renderer_version:'3.7.0'},statistics:(()=>{const result=structuredClone(lastAnalysis);if(!preserve){delete result.subject_curves;if(result.survival)result.survival.forEach(curve=>{delete curve.censors});}return result;})()};
}
async function save(){
  if(!isProjectOpen())throw Error('Create or open a local project folder first.');
  const rec=await makeCurrentRecord();
  if(!rec.dataset.processed_values_stored){
    const yes=confirm('You chose not to save the analyzed numerical values. The original P values and SVG remain viewable, but exact recalculation might be impossible without the external data. Continue?');
    if(!yes)return;
  }
  await draw({strict:true}); // preserve the currently selected brackets and last-minute graph settings
  const svg=await figureSvg(plotEl,rec.graph.settings);
  await saveNewRecord({record:rec,svg,processedCsv:rec.dataset.processed_values_stored?canonicalCsv(rows):null});
  showSaved();message(`Analysis saved with ${rec.dataset.processed_values_stored?'':'NO '}numeric input copy; original source files were never modified.`);
}
function showSaved(){
  const p=currentProject();$('project-name').textContent=p?.project_name||'No project selected';
  $('project-path').textContent=p?`Local project: ${projectFolderName()} · ${p.analyses.length} saved analyses`:'Choose an empty local folder to create a project.';
  const el=$('saved-analyses');el.replaceChildren();
  if(!p||!p.analyses.length){el.innerHTML='<p class="muted">No analyses saved yet.</p>';return;}
  for(const rec of [...p.analyses].reverse()){
    const row=document.createElement('div');row.className='saved-row';const heading=document.createElement('div');
    const strong=document.createElement('strong');strong.textContent=rec.name;
    const small=document.createElement('small');small.textContent=`${rec.test} · ${rec.p_value==null?'fit (no P)':`P=${formatP(rec.p_value)}`} · BioStats ${rec.app_version} · ${new Date(rec.date).toLocaleString()}`;
    heading.append(strong,small);
    const actions=document.createElement('div');actions.className='saved-actions';
    const button=document.createElement('button');button.className='btn btn-soft';button.textContent='View frozen original';button.onclick=()=>handle(()=>viewFrozen(rec.id));
    actions.append(button);row.append(heading,actions);el.append(row);
  }
}
async function viewFrozen(id){
  const {analysis,svg}=await loadRecord(id);
  const dialog=document.createElement('dialog');dialog.className='frozen-dialog';
  const heading=document.createElement('h2');heading.textContent=`Frozen original: ${analysis.dataset.name}`;
  const intro=document.createElement('p');intro.textContent=`${analysis.statistics.label} · ${analysis.statistics.p_value==null?'No hypothesis-test P value':`P=${formatP(analysis.statistics.p_value)}`} · BioStats ${analysis.software.version} · ${analysis.created_at}`;
  const img=document.createElement('img');const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));img.src=url;img.alt='Original preserved vector figure';img.style.width='100%';
  const tools=document.createElement('div');tools.className='inline-actions';
  const download=document.createElement('button');download.className='btn btn-primary';download.textContent='Download original SVG';download.onclick=()=>downloadText(`${id}.svg`,svg,'image/svg+xml');
  const close=document.createElement('button');close.className='btn btn-soft';close.textContent='Close';close.onclick=()=>dialog.close();
  tools.append(download,close);dialog.append(heading,intro,img,tools);
  dialog.addEventListener('close',()=>{URL.revokeObjectURL(url);dialog.remove();});document.body.append(dialog);dialog.showModal();
}
function handle(fn){Promise.resolve().then(fn).catch(e=>{if(e.name==='AbortError')return;message(e?.message||String(e),true);});}
function populateTestOptions(){
  const f=entryFamily(),methods=METHODS[f];if(!methods)throw Error('Unknown analysis family');
  const prev=entryTest();const sel=$('test-select');sel.replaceChildren();
  methods.forEach(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;sel.append(o)});
  if(methods.some(x=>x[0]===prev))sel.value=prev;
}
function showMethodControls(){
  const long=special();
  $('annotation-mode').disabled=long;$('annotation-format').disabled=long;
  $('y-max').disabled=entryTest()==='survival_logrank';
  $('annotation-description').hidden=long;
  $('plot-type').disabled=long;
  $('add-group').disabled=long||paired();
}
function fillExampleOptions(){
  const opts=examplesFor(entryTest());const list=$('example-select');list.replaceChildren();
  opts.forEach(e=>{const o=document.createElement('option');o.value=e.id;o.textContent=e.title;list.append(o);});
  $('alternative-field').hidden=!isTTest(entryTest());
  $('template-hint').textContent=special()?`Required long-format columns: ${specialHeaders(entryTest()).join(' | ')}. Each row describes one biological observation; repeated-measures rows share a Subject ID.`:paired()?'Matched format: first column is Subject ID; the next two columns are measurements on the SAME subject. Every pair must occupy one row.':'Independent format: first row gives group names; each subsequent cell is a measurement from an independent biological replicate. No row-wise pairing is implied.';
  showMethodControls();
  $('example-info').hidden=true;$('example-info-btn').setAttribute('aria-expanded','false');
  updateExampleInfo();
}
function updateExampleInfo(){
  const selected=examples.find(e=>e.id===$('example-select').value);
  $('example-info').textContent=selected?`${selected.summary} ${selected.rationale}`:'';
}
async function importData(file){
  const bytes=await file.arrayBuffer();let matrix,sheet=null;
  if(/\.xlsx?$/i.test(file.name)){
    if(!window.XLSX)throw Error('XLSX library unavailable. Reload the page.');
    const book=window.XLSX.read(bytes,{type:'array'});sheet=book.SheetNames[0];
    matrix=window.XLSX.utils.sheet_to_json(book.Sheets[sheet],{header:1,defval:'',raw:true}).map(r=>r.map(v=>String(v??'')));
  }else matrix=parseRows(await file.text());
  const source={kind:'import',filename:file.name,bytes:file.size,last_modified:new Date(file.lastModified).toISOString(),file_sha256:await hashBytes(bytes),sheet_name:sheet};
  await replaceGrid(matrix,source);$('data-input').value='';
  $('dataset-name').value=file.name.replace(/\.[^.]+$/,'');
  message(`Imported ${file.name}. You can edit every value. The original file remains unchanged.`);
}
function bind(){
  let previousTest=entryTest();
  $('analysis-family').addEventListener('change',()=>{
    if(rows.length&&!confirm('Switching analysis family will clear the current editable table. Save or copy your data first. Continue?')){ $('analysis-family').value=familyForTest(previousTest);return;}
    rows=[];groups=[];familyData=null;subjectIds=[];provenance={kind:'manual',filename:null};importedRowsSnapshot=null;
    populateTestOptions();previousTest=entryTest();invalidate();renderGrid();fillExampleOptions();reproject();
    $('annotation-mode').value='none';message(`Selected ${FAMILY_NAMES[entryFamily()]}. Load an example or create a method-specific table.`);
  });
  $('test-select').addEventListener('change',()=>{
    const next=entryTest();
    if(rows.length&&(isPairedTest(previousTest)!==isPairedTest(next)||specialHeaders(previousTest)?.join('|')!==specialHeaders(next)?.join('|'))&&!confirm('The selected test uses a different table format. Keep your current values elsewhere before switching. Clear the current table?')){$('test-select').value=previousTest;return;}
    if(rows.length&&(isPairedTest(previousTest)!==isPairedTest(next)||specialHeaders(previousTest)?.join('|')!==specialHeaders(next)?.join('|'))){
      rows=[];groups=[];familyData=null;subjectIds=[];importedRowsSnapshot=null;provenance={kind:'manual',filename:null};renderGrid();plotEl.textContent='Select a new example or create a blank table.';
    }
    previousTest=next;$('alternative').value='two-sided';invalidate();fillExampleOptions();reproject();
  });
  $('alpha').onchange=invalidate;$('alternative').onchange=invalidate;
  $('example-select').onchange=()=>{updateExampleInfo();$('example-info').hidden=true;$('example-info-btn').setAttribute('aria-expanded','false');};
  $('example-info-btn').onclick=()=>{const show=$('example-info').hidden;$('example-info').hidden=!show;$('example-info-btn').setAttribute('aria-expanded',String(show));};
  $('load-example').onclick=()=>handle(async()=>{
    const example=examples.find(e=>e.id===$('example-select').value);if(!example)throw Error('Choose an example.');
    $('alternative').value=example.alternative||'two-sided';
    $('dataset-name').value=example.title;$('data-sheet').value='Synthetic training values only; not experimental measurements';
    await replaceGrid(parseRows(example.csv),{kind:'example',example_id:example.id,example_title:example.title,filename:null});$('data-input').value='';
    message('Synthetic example loaded. All cells can now be edited.');
  });
  $('blank-table').onclick=()=>handle(blankTable);
  $('add-row').onclick=()=>handle(async()=>{
    if(!rows.length)return blankTable();rows.push(Array(rows[0].length).fill(''));gridPage=Math.floor((rows.length-2)/PAGE_SIZE);invalidate();renderGrid();refreshLater();
  });
  $('remove-row').onclick=()=>handle(async()=>{if(rows.length<3)throw Error('Keep at least one data row.');rows.pop();invalidate();renderGrid();refreshLater();});
  $('add-group').onclick=()=>handle(async()=>{
    if(special())throw Error('This analysis uses fixed long-format columns. Add a new row for another observation.');
    if(paired())throw Error('Paired t tests require exactly two measurement columns.');
    if(!rows.length)return blankTable();if(rows[0].length>=40)throw Error('Maximum 40 group columns in the editor.');
    rows.forEach((row,i)=>row.push(i===0?`Group ${row.length+1}`:''));invalidate();renderGrid();refreshLater();
  });
  $('prev-page').onclick=()=>{gridPage=Math.max(0,gridPage-1);renderGrid();};
  $('next-page').onclick=()=>{gridPage++;renderGrid();};
  $('data-preview').addEventListener('input',e=>{
    const inp=e.target.closest('input[data-row][data-col]');if(!inp)return;
    const ri=Number(inp.dataset.row),ci=Number(inp.dataset.col);rows[ri][ci]=inp.value;invalidate();refreshLater();
  });
  $('data-preview').addEventListener('paste',e=>{
    const inp=e.target.closest('input[data-row][data-col]');const text=e.clipboardData?.getData('text/plain');
    if(!inp||!text||!/[\t\r\n]/.test(text))return;
    e.preventDefault();let pasted=parseRows(text);
    const ri=Number(inp.dataset.row),ci=Number(inp.dataset.col);
    const newWidth=Math.max(rows[0].length,ci+Math.max(...pasted.map(x=>x.length)));
    if(special()&&newWidth>rows[0].length){message('Cannot add columns to this fixed long-format template.',true);return;}
    if(paired()&&newWidth>3){message('A paired table has exactly three columns: Subject ID, Before, After.',true);return;}
    if(newWidth>40){message('Maximum 40 columns supported.',true);return;}
    rows.forEach(row=>{while(row.length<newWidth)row.push('');});
    while(rows.length<ri+pasted.length)rows.push(Array(newWidth).fill(''));
    pasted.forEach((r,i)=>r.forEach((v,j)=>{if(ri+i===0&&(special()||(paired()&&ci+j===0)))return;rows[ri+i][ci+j]=v;}));
    invalidate();renderGrid();refreshLater();message('Pasted spreadsheet values into editable table.');
  });
  $('apply-data').onclick=()=>handle(async()=>{
    const text=$('data-input').value;
    await replaceGrid(parseRows(text),provenance.kind==='import'?provenance:{kind:'manual',filename:null},provenance.kind==='import'?importedRowsSnapshot:null);
    message('Table replaced with pasted values. The next analysis will use the new values.');
  });
  $('data-file').onchange=()=>handle(async()=>{const file=$('data-file').files[0];if(file)await importData(file);$('data-file').value='';});
  $('new-project').onclick=()=>handle(async()=>{await newProject();showSaved();message('Local project folder created.');});
  $('open-project').onclick=()=>handle(async()=>{await openProject();showSaved();message('Existing project opened. Frozen results were not recalculated.');});
  $('run-stats').onclick=()=>handle(runAnalysis);$('save-analysis').onclick=()=>handle(save);
  $('comparison-matrix').addEventListener('change',e=>{
    const checkbox=e.target.closest('input.pair-checkbox');if(!checkbox)return;
    // Carry the *currently visible* set forward when switching from an automatic mode.
    if($('annotation-mode').value!=='custom')chosenPairs=new Set(selectedComparisons().map(c=>pairKey(c.group1,c.group2)));
    if(checkbox.checked)chosenPairs.add(checkbox.dataset.pair);else chosenPairs.delete(checkbox.dataset.pair);
    $('annotation-mode').value='custom';syncPairChecks();draw();
  });
  $('show-matrix').onchange=()=>{$('comparison-matrix').hidden=!$('show-matrix').checked;};
  for(const key of ['annotation-mode','annotation-format'])$(key).onchange=()=>{syncPairChecks();draw();};
  for(const key of ['plot-type','error-type','palette','y-max','y-title','figure-title','font-size','plot-width']){
    $(key).addEventListener('input',refreshLater);$(key).addEventListener('change',refreshLater);
  }
  for(const key of ['dataset-name','data-sheet'])$(key).addEventListener('input',()=>{invalidate();});
  $('store-values').onchange=()=>{$('storage-warning').textContent=$('store-values').checked?
    'The exact analyzed numerical table will be saved as input.csv in the project (recommended for reproducibility).':
    'Numeric input will NOT be saved. The report will retain source-file metadata, input fingerprint, whether data were edited, and saved P values. Recalculation may not be possible.';};
  $('export-svg').onclick=()=>handle(async()=>{if(!validDataset())throw Error('Finish entering valid data first.');await draw({strict:true});downloadText('biostats_figure.svg',await figureSvg(plotEl,readSettings()),'image/svg+xml');message('Editable vector SVG exported.');});
  $('export-png').onclick=()=>handle(async()=>{if(!validDataset())throw Error('Finish entering valid data first.');await draw({strict:true});downloadDataUrl('biostats_figure.png',await figurePng(plotEl,readSettings()));});
  $('print-pdf').onclick=()=>handle(async()=>{
    if(!validDataset())throw Error('Finish entering valid data first.');
    await draw({strict:true});
    const svg=await figureSvg(plotEl,readSettings()),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    const holder=$('printable-figure');holder.replaceChildren();const img=document.createElement('img');img.src=url;img.alt='Vector figure';holder.append(img);
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('SVG printing failed'));});window.print();setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  $('download-report').onclick=()=>handle(async()=>{const rec=await makeCurrentRecord();downloadText('biostats_statistical_report.html',makeReport(rec),'text/html');});
}
populateTestOptions();bind();fillExampleOptions();showSaved();plotEl.textContent='Choose a method and load example, create a blank table, or import measurements.';
