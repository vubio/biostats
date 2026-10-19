export const APP_VERSION = '0.5.0';
export const PROJECT_SCHEMA_VERSION = '1.1.0';
let folder = null;
let project = null;

function humanName(folderName){return folderName.replace(/[_-]/g,' ').trim() || folderName;}
const now = () => new Date().toISOString();

async function fileRead(dir, name) {
  const h=await dir.getFileHandle(name);
  return (await h.getFile()).text();
}
async function write(dir,name,content) {
  const file=await dir.getFileHandle(name,{create:true});
  const writable=await file.createWritable();
  await writable.write(content);
  await writable.close();
}
async function subdir(dir,name){return await dir.getDirectoryHandle(name,{create:true});}

export function currentProject(){return project;}
export function projectFolderName(){return folder?.name||null;}
export function isProjectOpen(){return Boolean(folder&&project);}

export async function newProject(){
  if(!window.showDirectoryPicker) throw new Error('Chrome folder access unavailable. Open this app over HTTPS in desktop Chrome.');
  const selected=await window.showDirectoryPicker({mode:'readwrite',id:'biostats-project'});
  const names=[];
  for await(const [name] of selected.entries()) names.push(name);
  if(names.includes('project.json')) throw new Error('That folder is already a BioStats project. Choose Open project instead.');
  if(names.length>0) throw new Error('Please select an EMPTY folder specifically for the statistics project, to avoid modifying unrelated files.');
  const contents={schema_version:PROJECT_SCHEMA_VERSION,project_name:humanName(selected.name),created_at:now(),app_created_with:APP_VERSION,analyses:[]};
  await write(selected,'project.json',JSON.stringify(contents,null,2));
  for(const dirname of ['Data','Analyses','Figures','Reports','History'])await subdir(selected,dirname);
  await write(selected,'README.txt',`BioStats local statistics project\nCreated: ${contents.created_at}\n\nThis folder contains analyzed numeric data, immutable statistical analysis records, SVG figures and reports.\nRaw microscopy and instrument files remain outside this folder.\n\nOpen this project in BioStats (GitHub Pages).\nDo not place this project in the public software repository.\n`);
  folder=selected;project=contents;
  return contents;
}
export async function openProject(){
  if(!window.showDirectoryPicker) throw new Error('Chrome folder access unavailable. Open this app over HTTPS in desktop Chrome.');
  const selected=await window.showDirectoryPicker({mode:'readwrite',id:'biostats-project'});
  let parsed;
  try{parsed=JSON.parse(await fileRead(selected,'project.json'));}catch(e){throw new Error('This folder is not a BioStats project (no valid project.json found).');}
  if(typeof parsed.schema_version!=='string'||!Array.isArray(parsed.analyses))throw new Error('Invalid project metadata.');
  const major=parsed.schema_version.split('.')[0];
  if(major!=='1')throw new Error('This project schema needs a different BioStats version. No files were changed.');
  folder=selected;project=parsed;
  return parsed;
}
export async function loadRecord(id){
  if(!folder||!project)throw new Error('Open a project first');
  if(!project.analyses.some(r=>r.id===id))throw new Error('No record with that ID');
  const dir=await (await folder.getDirectoryHandle('Analyses')).getDirectoryHandle(id);
  const analysis=JSON.parse(await fileRead(dir,'analysis.json'));
  const svg=await fileRead(dir,'figure.svg');
  return {analysis,svg};
}
export async function saveNewRecord({record,svg,processedCsv,displayCsv=null}){
  if(!folder||!project)throw new Error('Create or open a local project first.');
  const id=`analysis_${new Date().toISOString().replace(/[:.]/g,'-')}_${crypto.randomUUID().slice(0,8)}`;
  const name=(record.dataset.name||'Untitled experiment').trim();
  const date=now();
  const dir=await subdir(await subdir(folder,'Analyses'),id);
  const snapshot={...record,id,created_at:date,immutable:true};
  const report=makeReport(snapshot);
  // Save artifacts before modifying project.json, which indexes successfully archived analyses.
  await write(dir,'analysis.json',JSON.stringify(snapshot,null,2));
  await write(dir,'figure.svg',svg);
  if(displayCsv!=null)await write(dir,'displayed_values.csv',displayCsv);
  await write(dir,'report.html',report);
  if(processedCsv!=null){
    await write(dir,'input.csv',processedCsv);
    await write(await subdir(folder,'Data'),`${id}.csv`,processedCsv);
  }
  await write(await subdir(folder,'Figures'),`${id}.svg`,svg);
  await write(await subdir(folder,'Reports'),`${id}.html`,report);
  const updated={...project,analyses:[...project.analyses,{id,name,date,test:record.statistics.label,
    p_value:record.statistics.p_value,app_version:APP_VERSION}]};
  await write(folder,'project.json',JSON.stringify(updated,null,2));
  project=updated;
  return snapshot;
}

export function escapeHtml(x){return String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function formatP(p){if(p==null || !Number.isFinite(p))return 'n/a';return p<.0001?p.toExponential(2):p.toPrecision(4);}
export function makeReport(record){
  const r=record.statistics,ds=record.dataset;
  const df=(r.df||[]).map(x=>Number(x).toPrecision(5)).join(', ');
  const rows=(r.group_summaries||[]).map(g=>`<tr><td>${escapeHtml(g.group)}</td><td>${g.n}</td><td>${g.mean.toPrecision(6)}</td><td>${g.sd==null?'—':g.sd.toPrecision(6)}</td><td>${g.sem==null?'—':g.sem.toPrecision(6)}</td></tr>`).join('');
  const comparisonRows=r.posthoc?.comparisons?.length?`<h2>Pairwise comparisons — ${escapeHtml(r.posthoc.method)}</h2><table><thead><tr><th>Group 1</th><th>Group 2</th><th>Difference (group 2 − group 1)</th><th>Raw P (where available)</th><th>Adjusted P</th><th>${Math.round((1-r.alpha)*100)}% CI</th></tr></thead><tbody>${r.posthoc.comparisons.map(c=>`<tr><td>${escapeHtml(c.group1)}</td><td>${escapeHtml(c.group2)}</td><td>${c.difference==null?'—':c.difference.toPrecision(6)}</td><td>${c.p_raw==null?'—':formatP(c.p_raw)}</td><td>${formatP(c.p_adjusted)}</td><td>${c.ci_low==null?'Not calculated':c.ci_low.toPrecision(5)+' to '+c.ci_high.toPrecision(5)}</td></tr>`).join('')}</tbody></table>`:'';
  const source=ds.source||{};
  const valuesStored=ds.processed_values_stored??Boolean(ds.groups);
  const kind=source.kind||'legacy';
  const sourceStatus=kind==='import'
    ?(source.modified_after_import?'YES — imported measurements were edited in BioStats.':'NO — imported measurements were not edited in BioStats.')
    :kind==='example'?(source.modified_after_example?'Example values edited.':'Unmodified synthetic example dataset.')
    :'Direct entry / legacy analysis; there is no verified external import baseline.';
  const originalMeta=kind==='import'?`<p><strong>Original imported file:</strong> ${escapeHtml(source.filename||'Unknown')}<br>Size: ${escapeHtml(source.bytes)} bytes<br>Last modified: ${escapeHtml(source.last_modified||'Unknown')}<br>Excel sheet: ${escapeHtml(source.sheet_name||'Not applicable')}<br>Original file SHA-256: <code>${escapeHtml(source.file_sha256||'Unavailable')}</code></p>`:'';
  const savedText=valuesStored?'YES — input.csv in the saved project (plus numeric summaries).':'NO — only frozen results, summaries, input hash and source metadata were retained. Independent recalculation may not be possible.';
  const inputHash=ds.processed_sha256||ds.sha256||'Not available';
  const effects=r.effects?.length?`<h2>Factorial effects</h2><table><tr><th>Effect</th><th>F</th><th>Numerator / denominator df</th><th>P value</th></tr>${r.effects.map(e=>`<tr><td>${escapeHtml(e.effect)}</td><td>${e.statistic.toPrecision(6)}</td><td>${e.df.join(' / ')}</td><td>${formatP(e.p_value)}</td></tr>`).join('')}</table>`:'';
  const curves=r.fits?.length?`<h2>4PL fit parameters</h2><table><tr><th>Group</th><th>Relative IC50 (input concentration units)</th><th>Approx. 95% CI</th><th>Bottom</th><th>Top</th><th>Hill</th><th>R²</th></tr>${r.fits.map(f=>`<tr><td>${escapeHtml(f.group)}</td><td>${f.ic50.toPrecision(7)}</td><td>${f.ci95_approx?.map(x=>x.toPrecision(6)).join(' to ')||'Unavailable'}</td><td>${f.bottom.toPrecision(6)}</td><td>${f.top.toPrecision(6)}</td><td>${f.hill.toPrecision(6)}</td><td>${f.r_squared.toPrecision(5)}</td></tr>`).join('')}</table><p>This model returns fitted IC50 estimates and does not calculate a hypothesis-test P value.</p>`:'';
  const survival=r.survival?.length?`<h2>Survival cohort summaries</h2><table><tr><th>Group</th><th>Subjects</th><th>Events</th><th>Censored</th></tr>${r.survival.map(c=>`<tr><td>${escapeHtml(c.name)}</td><td>${c.n}</td><td>${c.events}</td><td>${c.censored}</td></tr>`).join('')}</table>`:'';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>BioStats statistical report — ${escapeHtml(ds.name)}</title><style>body{font:14px/1.6 Arial,sans-serif;color:#213546;max-width:900px;margin:45px auto;padding:0 25px}header{border-bottom:2px solid #137b7b}h1{font-size:26px}h2{margin-top:28px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #dce3e8;text-align:left}th{background:#eef5f6}code{overflow-wrap:anywhere;background:#f1f5f9;padding:2px 5px}small{color:#58717a}section{margin-top:17px}b{color:#137b7b}</style></head><body>
    <header><h1>BioStats — Statistical analysis report</h1><p>${escapeHtml(ds.name)} · ${escapeHtml(record.created_at)}</p></header>
    <section><h2>Frozen original result</h2><p><strong>${escapeHtml(r.label)}</strong><br>${r.statistic==null?'No hypothesis-test statistic':`${r.primary_effect?`Primary displayed effect: ${escapeHtml(r.primary_effect)} · `:''}Statistic: <b>${r.statistic.toPrecision(7)}</b> · df: ${escapeHtml(df)} · P = <b>${formatP(r.p_value)}</b>`} · alpha = ${r.alpha}${r.alternative&&r.test_id?.includes('ttest')?' · alternative: '+escapeHtml(r.alternative):''}</p><p>${escapeHtml(ds.note)}</p></section>
    <h2>Group summaries</h2><table><thead><tr><th>Group</th><th>n</th><th>Mean</th><th>SD</th><th>SEM</th></tr></thead><tbody>${rows}</tbody></table>${effects}${survival}${curves}${comparisonRows}
    <section><h2>Data provenance and exact inputs</h2>
    <p>Source category: <strong>${escapeHtml(kind)}</strong><br>Edited compared with original imported values? <strong>${escapeHtml(sourceStatus)}</strong><br>Original imported file modified by BioStats? <strong>No. The program reads a copy and does not write to the imported file.</strong></p>
    ${originalMeta}<p>Analyzed numerical values included in project? <strong>${savedText}</strong></p>
    <p>SHA-256 of the exact analyzed raw numeric table: <code>${escapeHtml(inputHash)}</code></p>
    <p>Research template: <strong>${escapeHtml(ds.preset_id||'Standard analysis')}</strong><br>
    Graph transformation: <strong>${escapeHtml(ds.plotting?.normalization||'raw')}</strong> · 100% reference group: ${escapeHtml(ds.plotting?.reference||'none')}<br>
    Displayed numeric values SHA-256: <code>${escapeHtml(ds.plotting?.displayed_sha256||'Not applicable')}</code><br>
    Transforms performed within BioStats: <code>${escapeHtml(JSON.stringify(ds.transformations||[]))}</code><br>
    Displayed numeric measurements archived in project? <strong>${ds.plotting?.displayed_values_stored?'Yes, displayed_values.csv':'No'}</strong></p>
    <p><small>The input fingerprint detects differences when values are available; it cannot reconstruct missing numerical values. For imported Excel files, SHA-256 of the original file and of the processed numerical table are deliberately different quantities.</small></p></section>
    <section><h2>Reproducibility: Python statistical calculation</h2><p>BioStats ${escapeHtml(record.software.version)} · ${escapeHtml(record.software.runtime)}<br>
    Python package versions: <code>${escapeHtml(JSON.stringify(r.engine.python_packages))}</code><br>
    Function: <code>${escapeHtml(r.engine.primary_function)}</code><br>
    Function arguments: <code>${escapeHtml(JSON.stringify(r.engine.primary_arguments))}</code><br>
    Post hoc function: ${escapeHtml(r.engine.posthoc_function||'None')}<br>
    Post hoc arguments: <code>${escapeHtml(JSON.stringify(r.engine.posthoc_arguments||{}))}</code><br>
    Graph renderer: ${escapeHtml(record.graph.renderer)} ${escapeHtml(record.graph.renderer_version)} · Project schema: ${escapeHtml(record.schema_version)}<br>
    Software source URL at time of save: ${escapeHtml(record.software.source_page)}</p></section>
    <section><h2>Interpretation and limitations</h2><p>${escapeHtml(r.limitations)}</p>
    <p>Graph X label: ${escapeHtml(record.graph.settings.xTitle||'Default')} · Y label: ${escapeHtml(record.graph.settings.yTitle||'Measurement')} · Lines: ${record.graph.settings.showLines!==false?'shown':'hidden'} · Legend: ${record.graph.settings.showLegend?'shown':'hidden'}.</p>
    <p>Saved graph-annotation preferences: <code>${escapeHtml(JSON.stringify(record.graph.settings.annotationMode))}</code>, label format <code>${escapeHtml(JSON.stringify(record.graph.settings.annotationFormat))}</code>, selected pairs <code>${escapeHtml(JSON.stringify(record.graph.settings.shownPairs || []))}</code>.</p>
    <p>The report documents the test implementation, not whether its assumptions were met. Verify experimental units, planned comparisons and source measurements before using the results in research.</p>
    <small>Analysis results are a frozen record. Software updates must not silently recalculate it. If reanalysis is requested, save a new record.</small></section></body></html>`;
}
