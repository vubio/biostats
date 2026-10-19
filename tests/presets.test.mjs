import test from 'node:test';
import assert from 'node:assert/strict';
import {blankPresetRows,teachingPreset,suggestDoseTranspose,transposeDoseRows,transposeTable,normalizedGroups,numericDoseCoordinates} from '../src/presets.js';
for(const n of [1,2,3,6,24]){
 test(`preset columns n=${n}`,()=>{
  const x=teachingPreset('cell_viability_1',n);
  assert.equal(x.length,n+1);assert.deepEqual(x[0],['0','0.05','0.1','0.2']);
  assert.equal(x[1].length,4);
 });
}
test('transpose proposed for rows per dose',()=>{
 const matrix=teachingPreset('cell_viability_1',3,'rows');
 assert.equal(suggestDoseTranspose(matrix),true);
 assert.deepEqual(transposeDoseRows(matrix),teachingPreset('cell_viability_1',3));
});
test('already correct dose columns do not suggest transpose',()=>{
 assert.equal(suggestDoseTranspose(teachingPreset('cell_viability_1',3)),false);
});
test('generic transpose is reversible',()=>{
 const a=[['A','B'],['1','2'],['3','4']];
 assert.deepEqual(transposeTable(transposeTable(a)),a);
});
test('normalize to first group average',()=>{
 const g=[{name:'0',values:[80,120]},{name:'0.1',values:[50,60]}];
 const x=normalizedGroups(g,'control100','0');
 assert.deepEqual(x.map(z=>z.values),[[80,120],[50,60]]);
 assert.deepEqual(g[0].values,[80,120]);
});
test('reject zero reference',()=>{
 assert.throws(()=>normalizedGroups([{name:'0',values:[0,0]},{name:'.1',values:[1,2]}],'control100','0'),/zero/);
});
test('numeric headers include vehicle zero and unequal spacing',()=>{
 assert.deepEqual(numericDoseCoordinates([{name:'0'},{name:'0.05'},{name:'0.1'},{name:'0.2'}]),[0,.05,.1,.2]);
});
test('reject nonnumeric and duplicate doses',()=>{
 assert.throws(()=>numericDoseCoordinates([{name:'Drug A'},{name:'Drug B'}]),/numeric/);
 assert.throws(()=>numericDoseCoordinates([{name:'0'},{name:'0.0'}]),/distinct/);
});
