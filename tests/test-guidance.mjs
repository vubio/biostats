import assert from 'node:assert/strict';
import test from 'node:test';
import {interactionGuide} from '../src/statistical-guidance.js';
test('only factorial and group by time analyses show the interaction explainer',()=>{
  for(const m of ['two_factor_xy','two_factor','time_independent']) {
    const g=interactionGuide(m);assert.match(g.title,/×/);assert.match(g.follow,/Holm/);
  }
  assert.equal(interactionGuide('anova'),null);
});
test('interaction result is not a dose-specific test',()=>{
  const g=interactionGuide('two_factor_xy',{alpha:.05,effects:[{effect:'Condition × Dose',p_value:.004}]});
  assert.match(g.status,/0.004/);assert.match(g.status,/does not identify/);assert.match(g.example,/WT and KO/);
});
test('nonsignificant interaction does not show equivalence',()=>{
  const g=interactionGuide('two_factor_xy',{alpha:.05,effects:[{effect:'Condition × Dose',p_value:.45}]});
  assert.match(g.status,/not evidence/);
});
