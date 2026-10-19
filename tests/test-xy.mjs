import assert from 'node:assert/strict';
import test from 'node:test';
import {parseConditionNames,blankConditionRows,demoConditionRows,parseConditionColumns,conditionRecords,normalizeXYGroups,maybeConditionTranspose,transposeConditionRows,multiLinePlotSpec} from '../src/xy-series.js';
import {buildReproductionPython,reproducibilitySection} from '../src/reproducibility.js';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const toGroups=rows=>rows[0].map((name,i)=>({name,values:rows.slice(1).map(r=>Number(r[i]))}));
test('WT vs KO and four curves; proper dose points',()=>{
 const g=toGroups(demoConditionRows(['WT','KO','Rescue','Other'],3));const s=parseConditionColumns(g);
 assert.equal(s.conditions.length,4);assert.equal(s.doses.length,4);assert.equal(conditionRecords(g).length,48);
 const plot=multiLinePlotSpec(g,{showLegend:true,error:'sd',showLines:true,showMarkers:true});assert.equal(plot.traces.filter(t=>t.showlegend).length,4);
 assert.equal(plot.traces.filter(t=>t.mode==='markers').length,16);
});
test('single condition; independent baselines, no input mutation',()=>{
 const data=demoConditionRows(['WT','KO'],3);const g=toGroups(data);const frozen=JSON.stringify(g);
 const n=normalizeXYGroups(g,'perCondition100');const p=parseConditionColumns(n);
 for(const c of p.conditions){const d=p.columns.find(x=>x.condition===c&&x.dose===0);assert.ok(Math.abs(d.values.reduce((a,b)=>a+b,0)/d.values.length-100)<1e-10);}
 const common=normalizeXYGroups(g,'control100','WT | 0');
 assert.notEqual(parseConditionColumns(common).columns[4].values.reduce((a,b)=>a+b,0)/3,100);
 assert.equal(JSON.stringify(g),frozen);
 assert.equal(blankConditionRows(['WT'],1).length,2);
});
test('smart transpose preserves condition and replicate',()=>{
 const row=demoConditionRows(['WT','KO'],3,'rows');assert.ok(maybeConditionTranspose(row));
 assert.deepEqual(transposeConditionRows(row),demoConditionRows(['WT','KO'],3,'columns'));
});
test('clear validation',()=>{
 assert.throws(()=>parseConditionNames('WT, WT'),/unique/);
 assert.throws(()=>blankConditionRows(Array(8).fill(0).map((_,i)=>`c${i}`),3,Array(6).fill(0).map((_,i)=>`${i}`)),/at most 40/);
});
test('focused replay runs for summary and balanced ANOVA',()=>{
 for(const testId of ['summary','two_factor_xy']){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'biostats-replay-'));
  const rows=demoConditionRows(['WT','KO'],3),csv=rows.map(r=>r.join(',')).join('\n');
  fs.writeFileSync(path.join(folder,'input.csv'),csv);
  const record={dataset:{name:'synthetic',test_id:testId,preset_id:'cell_viability_1'},graph:{settings:{type:'dose-line',normalization:'perCondition100',error:'sd',reference:'WT | 0',xTitle:'Erastin2 (µM)',yTitle:'Luminescence (%)',showLines:true,showLegend:true}},statistics:{label:testId,alpha:.05,engine:{primary_function:'statsmodels',python_packages:{scipy:'1.17.0',statsmodels:'0.14.6'}}}};
  const code=buildReproductionPython(record);
  fs.writeFileSync(path.join(folder,'reproduce.py'),code);
  const out=execFileSync('python',['reproduce.py'],{cwd:folder,encoding:'utf-8'});
  assert.match(out,/WT/);if(testId==='two_factor_xy')assert.match(out,/C\(factor_a\)/);
  assert.ok(fs.existsSync(path.join(folder,'reproduced_figure.svg')));
  assert.ok(reproducibilitySection(code).includes('Focused executable Python replay'));
 }
});

test('paired replay ignores subject-ID text and keeps pairs aligned',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'biostats-paired-'));
 fs.writeFileSync(path.join(folder,'input.csv'),'Subject ID,Before,After\\nM1,20,21\\nM2,23,24\\nM3,27,29\\nM4,21,23\\n');
 const record={dataset:{test_id:'paired_ttest'},graph:{settings:{type:'dots'}},statistics:{label:'Paired t test',alternative:'two-sided',engine:{python_packages:{}}}};
 fs.writeFileSync(path.join(folder,'reproduce.py'),buildReproductionPython(record));
 assert.match(execFileSync('python',['reproduce.py'],{cwd:folder,encoding:'utf-8'}),/Paired t test/);
});
