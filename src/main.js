import {runStatisticalTest} from './stats.js';
import {renderPlot,figureSvg,figurePng,downloadText,downloadDataUrl,defaultChartSettings} from './charts.js';
import {newProject,openProject,isProjectOpen,currentProject,projectFolderName,saveNewRecord,loadRecord,makeReport,escapeHtml,formatP,APP_VERSION} from './projects.js';
import {examples,examplesFor,isPairedTest,isTTest} from './examples.js';
import {METHODS,FAMILY_NAMES,isSpecial,specialHeaders,defaultLongRows,validateSpecialTable,familyForTest} from './families.js';
import {renderSpecial} from './plots-special.js';
import {PRESETS,getPreset,blankPresetRows,teachingPreset,suggestDoseTranspose,transposeDoseRows,transposeTable,normalizedGroups} from './presets.js';
import {parseConditionNames,blankConditionRows,demoConditionRows,parseConditionColumns,conditionRecords,normalizeXYGroups,maybeConditionTranspose,transposeConditionRows} from './xy-series.js';
import {buildReproductionPython} from './reproducibility.js';
import {interactionGuide} from './statistical-guidance.js';

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
let plotQueue=Promise.resolve(); // Ensure rapid Plotly.react calls cannot finish out of order.
let datasetValid=false; // Prevent export or analysis of a stale preview.
let lastPreviewValid=false;
let chosenPairs=new Set();
let tableTransforms=[];
let selectedPreset='';
const pairKey=(a,b)=>JSON.stringify([a,b].sort());
const entryTest=()=>$('test-select').value;
const entryFamily=()=>$('analysis-family').value;
const special=()=>isSpecial(entryTest());
const validDataset=()=>datasetValid&&(special()?Boolean(familyData?.records?.length):Boolean(groups.length));
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
  renderInterpretationGuide();
}
function signature(){return JSON.stringify({rows,name:name(),note:note(),family:entryFamily(),test:entryTest(),alternative:alternative(),alpha:alpha()});}
const presetConditions=()=>parseConditionNames($('condition-labels').value);
const hasCompositeXY=()=>Boolean(groups.length&&parseConditionColumns(groups));
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
  if(maybeConditionTranspose(data)||suggestDoseTranspose(data))throw Error('Dose values appear in rows. Use the one-click transpose suggestion before analysis.');
  const isPaired=paired();
  const labels=(isPaired?data[0].slice(1):data[0]).map(s=>s.trim());
  if(isPaired&&data[0][0]?.trim().toLowerCase()!=='subject id')throw Error('Paired tables must begin with the “Subject ID” column. Create a paired template or import a paired table.');
  if(labels.length<2||labels.some(x=>!x))throw Error('Enter at least two named measurement columns.');
  if(new Set(labels).size!==labels.length)throw Error('Group names must be unique.');
  if((isTTest(entryTest())||isPaired)&&labels.length!==2)throw Error('This test requires exactly two measurement columns.');
  if(!isTTest(entryTest())&&entryTest()!=='summary'&&entryTest()!=='two_factor_xy'&&labels.length<3)throw Error('Choose at least three groups for this omnibus test.');
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
  if(values.some(v=>v.length<(entryTest()==='summary'?1:2)))throw Error(entryTest()==='summary'?'Enter at least one measurement per dose.':'Inferential tests require at least two independent measurements in every group. For technical-only wells, use Descriptive summary.');
  if(isPaired&&values[0].length!==values[1].length)throw Error('Every matched subject needs both measurements.');
  const prepared=labels.map((label,i)=>({name:label,values:values[i]}));
  if(entryTest()==='two_factor_xy')conditionRecords(prepared); // enforce Condition | Dose labels before inference
  return {groups:prepared,subjectIds:ids};
}
function fileChanged(){return importedRowsSnapshot!==null&&JSON.stringify(rows)!==importedRowsSnapshot;}
function sourceDescription(){
  if(provenance.kind==='import')return `${provenance.filename} (${provenance.bytes} bytes) · ${fileChanged()?'Edited after import':'Unchanged after import'}`;
  if(provenance.kind==='example')return `${provenance.example_title} · ${fileChanged()?'Edited example':'Unchanged example'}`;
  return 'Manually entered dataset';
}
function updateTransposeUI(){
  const suggestion=$('transpose-suggestion');if(!suggestion)return;
  const suggest=entryFamily()==='groups'&&!paired()&&(maybeConditionTranspose(rows)||suggestDoseTranspose(rows));
  suggestion.hidden=!suggest;
  $('transpose-hint').textContent=suggest?'Detected dose rows with replicate columns. Click to convert to editable dose columns, preserving each condition and replicate.':' ';
  $('transpose-table').disabled=special()||paired()||!rows.length;
}
function updateReferenceOptions(){
  const select=$('normalization-reference'),names=(rows[0]||[]).slice(paired()?1:0).map(x=>String(x).trim()).filter(Boolean);
  const previous=select.value;select.replaceChildren();
  names.forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;select.append(o)});
  if(names.includes(previous))select.value=previous;
  else if(names.includes('WT | 0'))select.value='WT | 0';
  else if(names.includes('0'))select.value='0';
  const mode=$('normalization-mode').value;
  $('normalization-reference').disabled=mode==='raw'||mode==='perCondition100'||special();
  $('normalization-note').textContent=mode==='perCondition100'?'Each condition uses its own mean at zero dose (or lowest available dose) as 100%. Raw measurements are unchanged for statistics.':mode==='control100'?`All curves use the SAME reference “${select.value||'first group'}” as 100%; this preserves between-condition baseline differences. Statistics use raw measurements.`:'Raw values are plotted. Statistics use the current unmodified numerical measurements.';
}
function renderGrid(){
  const el=$('data-preview');el.replaceChildren();
  if(!rows.length){el.textContent='No data yet. Use Create blank table, Load example, or Import.';$('table-navigation').hidden=true;updateTransposeUI();updateReferenceOptions();return;}
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
  updateTransposeUI();updateReferenceOptions();
}
async function reproject({strict=false}={}){
  const revision=++previewRevision;
  if(!rows.length){datasetValid=false;lastPreviewValid=false;groups=[];subjectIds=[];familyData=null;plotEl.replaceChildren();plotEl.textContent='Create a dataset to display a graph.';$('preview-status').textContent='No data to preview.';return;}
  let parsed;
  try { parsed=special()?validateSpecialTable(rows,entryTest()):validateTable(rows); }
  catch(e){
    if(revision===previewRevision){
      datasetValid=false;
      // Keep the previous SVG/Plotly preview visually available while editing.
      // It is marked stale and is NEVER eligible for export or statistical analysis.
      if(!lastPreviewValid){plotEl.replaceChildren();plotEl.textContent='Complete a valid table to preview a figure.';}
      $('preview-status').textContent=(lastPreviewValid?'Previous valid graph retained — NOT updated to the current table. ':'Preview pending. ')+e.message+' Fill missing values, load an example, or click Refresh graph.';
      $('preview-status').className='preview-status preview-stale';
      $('edit-state').textContent=`Check table: ${e.message}`;
    }
    if(strict)throw e;
    return;
  }
  if(revision!==previewRevision)return;
  datasetValid=true;
  if(special()){familyData=parsed;groups=[];subjectIds=[];}else{groups=parsed.groups;subjectIds=parsed.subjectIds;familyData=null;}
  $('edit-state').textContent=special()?`${parsed.rows} complete observational rows · ${sourceDescription()}`:`${groups.length} groups · ${Math.max(...groups.map(g=>g.values.length))} max observations/group · ${sourceDescription()}`;
  // A plotting-library failure is distinct from invalid data. Never erase a
  // statistically valid dataset with a generic "complete the table" message.
  try{await draw({strict:true});}catch(e){
    datasetValid=false;
    $('preview-status').textContent='Graph rendering failed: '+e.message+'. Try Refresh graph after checking the graph settings.';
    $('preview-status').className='preview-status preview-stale';
    if(strict)throw e;
    return;
  }
  if(revision!==previewRevision)return;
  lastPreviewValid=true;
  $('preview-status').textContent='Graph updated from the current editable measurements.';
  $('preview-status').className='preview-status';
}
function refreshLater(){clearTimeout(drawTimer);drawTimer=setTimeout(()=>handle(()=>reproject()),350);}
async function replaceGrid(newRows,newSource,sourceSnapshot=null){
  clearTimeout(drawTimer);
  ++previewRevision;
  datasetValid=false;lastPreviewValid=false;groups=[];familyData=null;subjectIds=[];
  if(window.Plotly&&plotEl.data)window.Plotly.purge(plotEl);
  plotEl.replaceChildren();
  $('preview-status').textContent='Loading table and building graph…';
  $('preview-status').className='preview-status';
  rows=newRows.map(r=>r.map(v=>String(v??'')));
  const size=rows.reduce((maximum,row)=>Math.max(maximum,row.length),0);rows=rows.map(r=>Array.from({length:size},(_,i)=>r[i]??''));
  provenance=newSource;importedRowsSnapshot=sourceSnapshot??(newSource.kind==='manual'?null:JSON.stringify(rows));
  gridPage=0;tableTransforms=[];invalidate();renderGrid();await reproject();
}
async function blankTable(){
  if(selectedPreset){await replaceGrid(blankConditionRows(presetConditions(),Number($('replicate-count').value)),{kind:'manual',filename:null});$('data-input').value='';message('Blank condition × dose table created. All headers and values are editable.');return;}
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
    annotationMode:$('annotation-mode').value,annotationFormat:$('annotation-format').value,shownPairs:selectedComparisons().map(c=>[c.group1,c.group2]),
    xTitle:$('x-title').value,normalization:$('normalization-mode').value,reference:$('normalization-reference').value||null,
    showLines:$('show-lines').checked,showMarkers:$('show-markers').checked,showLegend:$('show-legend').checked,showPointLabels:$('show-point-labels').checked};
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
  const revision=previewRevision;
  const long=special(),test=entryTest(),settings=readSettings(),chosen=selectedComparisons(),significance=alpha();
  const input=structuredClone(long?familyData.records:groups);
  const analysis=lastDataSignature===signature()?structuredClone(lastAnalysis):null;
  const operation=plotQueue.catch(()=>{}).then(async()=>{
    if(revision!==previewRevision||!datasetValid)return; // Replaced/edited data supersedes this draw.
    if(chosen.length>15)throw Error(`${chosen.length} pairs selected. Maximum 15 graph brackets; select a subset in the comparison matrix. All P values remain accessible in the results.`);
    $('annotation-warning').textContent='';
    if(long)await renderSpecial(plotEl,test,input,settings,analysis);
    else await renderPlot(plotEl,input,settings,chosen,significance);
  });
  plotQueue=operation;
  try{await operation;}
  catch(e){
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
function renderInterpretationGuide(){
  const el=$('interpretation-guide');
  if(!el)return;
  const model=interactionGuide(entryTest(),lastAnalysis&&lastDataSignature===signature()?lastAnalysis:null);
  if(!model){el.hidden=true;el.replaceChildren();return;}
  el.hidden=false;el.replaceChildren();
  const heading=document.createElement('strong');heading.textContent=model.title;
  const current=document.createElement('p');current.textContent=model.status;current.className='interpretation-status';
  const detail=document.createElement('details');
  const summary=document.createElement('summary');summary.textContent='ⓘ Why an interaction P value is not a per-dose comparison';
  detail.append(summary);
  for(const value of [model.main,model.example,model.follow,model.caution]){
    const p=document.createElement('p');p.textContent=value;detail.append(p);
  }
  el.append(heading,current,detail);
}
function resultHtml(r){
  const primary=r.p_value==null?'No hypothesis-test P value':`${r.primary_effect?escapeHtml(r.primary_effect)+': ':''}P = ${formatP(r.p_value)}`;
  const statistic=r.statistic==null?'':`Statistic = ${Number(r.statistic).toPrecision(6)} · df = ${(r.df||[]).map(x=>Number(x).toPrecision(5)).join(', ')} · α = ${r.alpha}`;
  const summaries=(r.group_summaries||[]).map(x=>`<tr><td>${escapeHtml(x.group)}</td><td>${x.n}</td><td>${x.mean.toPrecision(5)}</td><td>${x.sd==null?'—':x.sd.toPrecision(5)}</td></tr>`).join('');
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
  const input=entryTest()==='two_factor_xy'?{family:'factorial',test:'two_factor',records:conditionRecords(groups),alpha:alpha()}:special()?{family:entryFamily(),test:entryTest(),records:structuredClone(familyData.records),alpha:alpha()}:{groups:structuredClone(groups),test:entryTest(),alpha:alpha(),alternative:alternative(),subject_ids:paired()?structuredClone(subjectIds):null};
  const sig=signature();$('run-stats').disabled=true;
  try{
    const result=await runStatisticalTest(input,status=>{$('analysis-running').textContent=status;$('engine-status').textContent=status;});
    if(sig!==signature())throw Error('Data changed while the analysis was running. Run it again.');
    lastAnalysis=result;lastDataSignature=sig;$('analysis-results').className='';$('analysis-results').innerHTML=resultHtml(result);renderInterpretationGuide();
    chosenPairs.clear();renderComparisonMatrix();await draw();
    $('engine-status').textContent='Python statistical engine ready';$('engine-status').className='status-pill ready';
    message('Statistics calculated from the current editable table. Save to preserve results.');
  }finally{$('run-stats').disabled=false;$('analysis-running').textContent='';}
}
function ensureResults(){if(!lastAnalysis)throw Error('Run a statistical analysis first.');if(signature()!==lastDataSignature)throw Error('Your data or settings changed. Rerun the test before saving or exporting its report.');}
async function makeCurrentRecord(){
  ensureResults();const processed=canonicalCsv(rows),preserve=$('store-values').checked;
  const plotGroups=groups.length?normalizeXYGroups(groups,$('normalization-mode').value,$('normalization-reference').value||null):null;
  const displayed=plotGroups?canonicalCsv([plotGroups.map(g=>g.name),...Array.from({length:Math.max(...plotGroups.map(g=>g.values.length))},(_,i)=>plotGroups.map(g=>g.values[i]??''))]):null;
  const record={schema_version:'1.1.0',created_at:new Date().toISOString(),
    software:{name:'BioStats',version:APP_VERSION,runtime:'Pyodide 0.28.3',source_page:location.origin+location.pathname,
      source_git_commit:'recorded by the deployment release when available'},
    dataset:{name:name(),note:note(),family:entryFamily(),test_id:entryTest(),preset_id:selectedPreset||null,
      plotting:{normalization:$('normalization-mode').value,reference:$('normalization-reference').value||null,displayed_sha256:displayed?await sha256(displayed):null,
        displayed_values_stored:preserve&&displayed!==null},transformations:tableTransforms.slice(),
      groups:preserve&&!special()?structuredClone(groups):undefined,records:preserve&&special()?structuredClone(familyData.records):undefined,
      processed_sha256:await sha256(processed),processed_values_stored:preserve,
      source:{...provenance,modified_after_import:provenance.kind==='import'?fileChanged():null,
        modified_after_example:provenance.kind==='example'?fileChanged():null,
        original_file_unmodified:true}},
    graph:{settings:readSettings(),renderer:'Plotly.js',renderer_version:'3.7.0'},statistics:(()=>{const result=structuredClone(lastAnalysis);if(!preserve){delete result.subject_curves;if(result.survival)result.survival.forEach(curve=>{delete curve.censors});}return result;})()};
  record.reproduction={filename:'reproduce.py',script:buildReproductionPython(record),input_filename:'input.csv'};
  return record;
}
async function save(){
  if(!isProjectOpen())throw Error('Create or open a local project folder first.');
  await reproject({strict:true});
  const rec=await makeCurrentRecord();
  if(!rec.dataset.processed_values_stored){
    const yes=confirm('You chose not to save the analyzed numerical values. The original P values and SVG remain viewable, but exact recalculation might be impossible without the external data. Continue?');
    if(!yes)return;
  }
  await draw({strict:true}); // preserve the currently selected brackets and last-minute graph settings
  const svg=await figureSvg(plotEl,rec.graph.settings);
  const displayedGroups=groups.length?normalizeXYGroups(groups,rec.graph.settings.normalization,rec.graph.settings.reference):null;
  const displayedCsv=displayedGroups?canonicalCsv([displayedGroups.map(g=>g.name),...Array.from({length:Math.max(...displayedGroups.map(g=>g.values.length))},(_,i)=>displayedGroups.map(g=>g.values[i]??''))]):null;
  await saveNewRecord({record:rec,svg,processedCsv:rec.dataset.processed_values_stored?canonicalCsv(rows):null,
    displayCsv:rec.dataset.processed_values_stored?displayedCsv:null});
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
async function activatePreset(id){
  if(id&&!getPreset(id))throw Error('Unknown research template');
  selectedPreset=id;
  $('preset-options').hidden=!id;
  if(!id){message('Standard analysis mode. Choose any statistical method.');return;}
  const preset=getPreset(id);
  $('analysis-family').value=preset.family;populateTestOptions();$('test-select').value=preset.test;
  $('replicate-count').value=String(preset.replicates);$('preset-preview-mode').value='columns';
  $('condition-count').value='2';$('condition-labels').value='WT, KO';
  $('plot-type').value=preset.graphType;$('x-title').value=preset.xTitle;$('y-title').value=preset.yTitle;
  $('normalization-mode').value=preset.normalization;$('show-lines').checked=preset.showLines;
  $('show-markers').checked=true;$('show-legend').checked=true;
  $('annotation-mode').value='none';
  fillExampleOptions();
  $('dataset-name').value=preset.title;
  $('data-sheet').value='Luminescence values; specify whether rows are independent biological replicates or technical wells.';
  rows=[];groups=[];familyData=null;subjectIds=[];
  provenance={kind:'manual',filename:null};importedRowsSnapshot=null;invalidate();
  renderGrid();await blankTable();
  message(`${preset.title} ready. Raw/100% display and connected lines are graph settings, not new statistical tests.`);
}
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
  $('normalization-mode').disabled=long;
  $('normalization-reference').disabled=long;
  $('add-group').disabled=long||paired();
}
function fillExampleOptions(){
  const opts=selectedPreset?[
    {id:'viability_1_1_columns',title:'WT only: 1 replicate / dose'},
    {id:'viability_2_2_columns',title:'WT vs KO: 2 replicates / dose'},
    {id:'viability_3_2_columns',title:'WT vs KO: 3 replicates / dose (default)'},
    {id:'viability_6_2_columns',title:'WT vs KO: 6 replicates / dose'},
    {id:'viability_3_4_columns',title:'Four conditions: 3 replicates / dose'},
    {id:'viability_3_2_rows',title:'WT vs KO: doses in ROWS (transpose demo)'}
  ]:examplesFor(entryTest());const list=$('example-select');list.replaceChildren();
  opts.forEach(e=>{const o=document.createElement('option');o.value=e.id;o.textContent=e.title;list.append(o);});
  $('alternative-field').hidden=!isTTest(entryTest());
  $('template-hint').textContent=special()?`Required long-format columns: ${specialHeaders(entryTest()).join(' | ')}. Each row describes one biological observation; repeated-measures rows share a Subject ID.`:paired()?'Matched format: first column is Subject ID; the next two columns are measurements on the SAME subject. Every pair must occupy one row.':'Independent format: first row gives group names; each subsequent cell is a measurement from an independent biological replicate. No row-wise pairing is implied.';
  showMethodControls();
  renderInterpretationGuide();
  $('example-info').hidden=true;$('example-info-btn').setAttribute('aria-expanded','false');
  updateExampleInfo();
}
function updateExampleInfo(){
  const selected=examples.find(e=>e.id===$('example-select').value);
  if(selectedPreset){$('example-info').textContent='Synthetic luminescence dose curves for one or more editable conditions (WT, KO, etc.). Each Condition | Dose column contains replicate values. The dose-row example tests smart transpose. A technical well is not automatically an independent biological replicate. ANOVA for Condition × Dose requires balanced independent biological replicates.';return;}
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
  $('project-preset').onchange=()=>handle(async()=>{const target=$('project-preset').value;if(target&&target!==selectedPreset&&rows.length&&!confirm('Activating this template creates a new editable table. Save your current work or copy its values before continuing. Continue?')){$('project-preset').value=selectedPreset;return;}await activatePreset(target);});
  $('apply-conditions').onclick=()=>handle(async()=>{
    if(!selectedPreset)throw Error('Choose a preset first.');
    const count=Number($('condition-count').value);const labels=presetConditions();
    if(labels.length!==count)throw Error(`Number of labels (${labels.length}) must equal number of conditions (${count}).`);
    const n=Math.max(Number($('replicate-count').value),rows.length?rows.length-1:0);$('replicate-count').value=String(n);
    if(maybeConditionTranspose(rows)||suggestDoseTranspose(rows))throw Error('Transpose dose-row measurements before changing conditions.');
    const existing=rows.length?rows:blankConditionRows(labels,n);
    const headers=existing[0],pattern=/^(.+?)\s*\|\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/;
    const oldDoses=[...new Set(headers.map(h=>pattern.exec(h)?.[2]).filter(x=>x!==undefined))];
    const template=blankConditionRows(labels,n,oldDoses.length>=2?oldDoses:['0','0.05','0.1','0.2']);
    const oldNames=[...new Set(headers.map(h=>pattern.exec(h)?.[1]?.trim()).filter(Boolean))];
    const lookup=new Map(headers.map((h,i)=>[h,i]));
    const findOld=(newName)=>{const direct=lookup.get(newName);if(direct!==undefined)return direct;const m=pattern.exec(newName);if(!m)return undefined;const oldLabel=oldNames[labels.indexOf(m[1].trim())];return lookup.get(`${oldLabel} | ${m[2]}`);};
    const reused=new Set(template[0].map(findOld).filter(x=>x!==undefined));
    const lost=headers.filter((_,i)=>!reused.has(i)&&existing.slice(1).some(r=>String(r[i]??'').trim()));
    if(lost.length&&!confirm(`Changing conditions removes ${lost.length} populated condition × dose columns. Continue?`))return;
    for(let i=1;i<template.length;i++)for(let j=0;j<template[0].length;j++){const old=findOld(template[0][j]);if(old!==undefined)template[i][j]=String(existing[i]?.[old]??'');}
    const priorTransforms=tableTransforms.slice();
    await replaceGrid(template,provenance,importedRowsSnapshot);tableTransforms=[...priorTransforms,'set_conditions:'+labels.join('|')];
    message(`Now showing ${labels.length} conditions: ${labels.join(', ')}. Existing matching data were preserved.`);
  });
  $('apply-replicates').onclick=()=>handle(async()=>{
    if(!selectedPreset)throw Error('Choose a preset first.');
    const count=Number($('replicate-count').value);
    if(!Number.isInteger(count)||count<1||count>24)throw Error('Replicates must be 1–24');
    if(!rows.length)return blankTable();
    if(maybeConditionTranspose(rows)||suggestDoseTranspose(rows))throw Error('Transpose the dose-row table first.');
    const old=rows.length-1;
    if(old>count&&rows.slice(count+1).some(row=>row.some(x=>String(x).trim()))&&
      !confirm(`Reducing ${old} to ${count} replicates will discard ${old-count} populated rows. Continue?`))return;
    rows=rows.slice(0,count+1);
    while(rows.length<count+1)rows.push(Array(rows[0].length).fill(''));
    tableTransforms.push(`resize_replicates:${old}->${count}`);
    invalidate();renderGrid();await reproject();message(`Dose table now has ${count} replicate rows.`);
  });
  $('transpose-suggested').onclick=()=>handle(async()=>{
    rows=maybeConditionTranspose(rows)?transposeConditionRows(rows):transposeDoseRows(rows);tableTransforms.push('dose_rows_to_columns');
    invalidate();renderGrid();await reproject();message('Converted dose rows into dose headers, preserving every measurement.');
  });
  $('transpose-table').onclick=()=>handle(async()=>{
    if(special()||paired())throw Error('Transpose applies to independent-group tables only.');
    if(!rows.length)throw Error('Load a table first.');
    if(maybeConditionTranspose(rows))rows=transposeConditionRows(rows);
    else if(suggestDoseTranspose(rows))rows=transposeDoseRows(rows);
    else rows=transposeTable(rows);
    tableTransforms.push('manual_transpose');invalidate();renderGrid();await reproject();
    message('Transposed the editable table. Check headers and rerun analysis.');
  });
  $('analysis-family').addEventListener('change',()=>{
    if(selectedPreset&&entryFamily()!=='groups'){
      selectedPreset='';$('project-preset').value='';$('preset-options').hidden=true;$('normalization-mode').value='raw';$('plot-type').value='dots';
    }
    if(rows.length&&!confirm('Switching analysis family will clear the current editable table. Save or copy your data first. Continue?')){ $('analysis-family').value=familyForTest(previousTest);return;}
    rows=[];groups=[];familyData=null;subjectIds=[];provenance={kind:'manual',filename:null};importedRowsSnapshot=null;
    populateTestOptions();previousTest=entryTest();$('show-legend').checked=entryFamily()!=='groups';invalidate();renderGrid();fillExampleOptions();reproject();
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
  $('example-select').onchange=()=>{if(selectedPreset){$('preset-preview-mode').value=$('example-select').value.endsWith('_rows')?'rows':'columns';}updateExampleInfo();$('example-info').hidden=true;$('example-info-btn').setAttribute('aria-expanded','false');};
  $('example-info-btn').onclick=()=>{const show=$('example-info').hidden;$('example-info').hidden=!show;$('example-info-btn').setAttribute('aria-expanded',String(show));};
  $('load-example').onclick=()=>handle(async()=>{
    if(selectedPreset){
      const id=$('example-select').value,m=id.match(/^viability_(\d+)_(\d+)_(columns|rows)$/);
      if(!m)throw Error('Choose a cell viability teaching example');
      const n=Number(m[1]),c=Number(m[2]),orientation=m[3];$('replicate-count').value=String(n);$('condition-count').value=String(c);
      const labels=['WT','KO','KO + Rescue','Condition 4'].slice(0,c);$('condition-labels').value=labels.join(', ');$('preset-preview-mode').value=orientation;
      const matrix=demoConditionRows(labels,n,orientation);
      $('dataset-name').value=`Cell Viability (1) — synthetic ${c}-condition, ${n}-replicate example`;
      $('data-sheet').value='SYNTHETIC EXAMPLE — not real experimental results; technical wells do not imply independent n.';
      await replaceGrid(matrix,{kind:'example',example_id:id,example_title:`Cell viability (${c} conditions, ${n} reps)`,filename:null});
      message(orientation==='rows'?'Dose-row example loaded. Use the transpose suggestion above the table.':'Synthetic dose-series example loaded. All values can be edited.');return;
    }
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
    const ri=Number(inp.dataset.row),ci=Number(inp.dataset.col);rows[ri][ci]=inp.value;invalidate();updateTransposeUI();updateReferenceOptions();refreshLater();
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
  $('refresh-graph').onclick=()=>handle(async()=>{clearTimeout(drawTimer);await reproject({strict:true});message('Graph refreshed from the current editable table.');});
  $('comparison-matrix').addEventListener('change',e=>{
    const checkbox=e.target.closest('input.pair-checkbox');if(!checkbox)return;
    // Carry the *currently visible* set forward when switching from an automatic mode.
    if($('annotation-mode').value!=='custom')chosenPairs=new Set(selectedComparisons().map(c=>pairKey(c.group1,c.group2)));
    if(checkbox.checked)chosenPairs.add(checkbox.dataset.pair);else chosenPairs.delete(checkbox.dataset.pair);
    $('annotation-mode').value='custom';syncPairChecks();draw();
  });
  $('show-matrix').onchange=()=>{$('comparison-matrix').hidden=!$('show-matrix').checked;};
  for(const key of ['annotation-mode','annotation-format'])$(key).onchange=()=>{syncPairChecks();draw();};
  for(const key of ['plot-type','error-type','palette','y-max','x-title','y-title','figure-title','font-size','plot-width','normalization-mode','normalization-reference','show-lines','show-markers','show-legend','show-point-labels']){
    $(key).addEventListener('input',refreshLater);$(key).addEventListener('change',refreshLater);
  }
  for(const key of ['dataset-name','data-sheet'])$(key).addEventListener('input',()=>{invalidate();});
  $('normalization-mode').addEventListener('change',()=>{const title=$('y-title');if($('normalization-mode').value==='control100'&&title.value.toLowerCase()==='luminescence')title.value='luminescence (% of control)';else if($('normalization-mode').value==='raw'&&title.value==='luminescence (% of control)')title.value='luminescence';updateReferenceOptions();refreshLater();});
  $('store-values').onchange=()=>{$('storage-warning').textContent=$('store-values').checked?
    'The exact analyzed numerical table will be saved as input.csv in the project (recommended for reproducibility).':
    'Numeric input will NOT be saved. The report will retain source-file metadata, input fingerprint, whether data were edited, and saved P values. Recalculation may not be possible.';};
  $('export-svg').onclick=()=>handle(async()=>{await reproject({strict:true});if(!validDataset())throw Error('Finish entering valid data first.');await draw({strict:true});downloadText('biostats_figure.svg',await figureSvg(plotEl,readSettings()),'image/svg+xml');message('Editable vector SVG exported.');});
  $('export-png').onclick=()=>handle(async()=>{await reproject({strict:true});if(!validDataset())throw Error('Finish entering valid data first.');await draw({strict:true});downloadDataUrl('biostats_figure.png',await figurePng(plotEl,readSettings()));});
  $('print-pdf').onclick=()=>handle(async()=>{
    await reproject({strict:true});
    if(!validDataset())throw Error('Finish entering valid data first.');
    await draw({strict:true});
    const svg=await figureSvg(plotEl,readSettings()),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    const holder=$('printable-figure');holder.replaceChildren();const img=document.createElement('img');img.src=url;img.alt='Vector figure';holder.append(img);
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('SVG printing failed'));});window.print();setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  $('download-report').onclick=()=>handle(async()=>{const rec=await makeCurrentRecord();downloadText('biostats_statistical_report.html',makeReport(rec),'text/html');});
  $('download-python').onclick=()=>handle(async()=>{const rec=await makeCurrentRecord();downloadText('reproduce.py',rec.reproduction.script,'text/x-python');});
  $('download-input').onclick=()=>handle(async()=>{await reproject({strict:true});downloadText('input.csv',canonicalCsv(rows),'text/csv');});
}
populateTestOptions();bind();fillExampleOptions();showSaved();plotEl.textContent='Choose a method and load example, create a blank table, or import measurements.';
