// Research workflow presets configure existing methods and graphs; they are not tests.
export const PRESETS={
  cell_viability_1:{id:'cell_viability_1',title:'Cell Viability (1)',family:'groups',test:'summary',
    xTitle:'Erastin2 (µM)',yTitle:'luminescence',doses:['0','0.05','0.1','0.2'],replicates:3,
    graphType:'dose-line',normalization:'raw',showLines:true,showLegend:true,
    description:'Erastin2 luminescence dose series. Default descriptive plot; inferential tests require genuinely independent biological replicates, not merely separate wells.'}
};
export const getPreset=id=>PRESETS[id]||null;
export function blankPresetRows(id,replicates=3){
  const p=getPreset(id);if(!p)throw Error('Unknown preset');
  const n=Number(replicates);if(!Number.isInteger(n)||n<1||n>24)throw Error('Replicates must be a whole number between 1 and 24');
  return [p.doses.slice(),...Array.from({length:n},()=>p.doses.map(()=>''))];
}
const round=v=>String(Number(v.toFixed(4)));
export function teachingPreset(id,n=3,orientation='columns'){
  const p=getPreset(id);if(!p)throw Error('Unknown preset');
  if(!Number.isInteger(n)||n<1||n>24)throw Error('Replicate count must be 1–24');
  const base=[104000,92500,68000,28500];
  // Small synthetic values, deterministic and labelled as demonstrations.
  const matrix=[p.doses.slice(),...Array.from({length:n},(_,r)=>base.map((b,i)=>round(b*(1+(((r*7+i*3)%11)-5)*.017))) )];
  if(orientation==='rows'){
    return [['Dose (µM)',...Array.from({length:n},(_,i)=>`Rep ${i+1}`)],
      ...p.doses.map((dose,i)=>[dose,...matrix.slice(1).map(row=>row[i])])];
  }
  return matrix;
}
const numeric=x=>x!==''&&Number.isFinite(Number(x));
export function suggestDoseTranspose(rows){
  if(!Array.isArray(rows)||rows.length<3||rows[0].length<2)return false;
  const header=rows[0],first=String(header[0]??'').trim();
  const looksLikeAxis=/^(dose|concentration|erastin|time|doses|µm|um)\b/i.test(first)||first==='';
  const rest=header.slice(1).filter(x=>String(x).trim());
  const repeatHeaders=rest.length>0&&rest.every(x=>!numeric(String(x).trim()));
  const doseEntries=rows.slice(1).filter(r=>String(r[0]??'').trim());
  return looksLikeAxis&&repeatHeaders&&doseEntries.length>=2&&doseEntries.every(r=>numeric(String(r[0]).trim()))
    &&doseEntries.every(r=>r.slice(1).some(x=>String(x??'').trim()));
}
export function transposeDoseRows(rows){
  if(!suggestDoseTranspose(rows))throw Error('This is not a dose-in-rows table. Use a standard table transpose instead.');
  const n=rows[0].length-1;
  const doseRows=rows.slice(1).filter(r=>String(r[0]??'').trim());
  return [doseRows.map(r=>String(r[0]).trim()), ...Array.from({length:n},(_,i)=>doseRows.map(r=>String(r[i+1]??'').trim()))];
}
export function transposeTable(rows){
  if(!rows.length)return [];
  const width=Math.max(...rows.map(r=>r.length));
  return Array.from({length:width},(_,i)=>rows.map(r=>String(r[i]??'')));
}
export function normalizedGroups(groups,mode='raw',refName=null){
  if(mode==='raw')return groups.map(g=>({...g,values:g.values.slice()}));
  if(mode!=='control100')throw Error('Unsupported normalization mode');
  const control=groups.find(g=>g.name===refName)||groups[0];
  if(!control||!control.values?.length)throw Error('Choose a valid normalization reference group.');
  const baseline=control.values.reduce((s,x)=>s+x,0)/control.values.length;
  if(!Number.isFinite(baseline)||baseline===0)throw Error('Normalization reference mean is zero or undefined.');
  return groups.map(g=>({...g,values:g.values.map(v=>100*v/baseline)}));
}
export function numericDoseCoordinates(groups){
  const coord=groups.map(g=>Number(g.name));
  if(groups.some(g=>String(g.name).trim()==='')||coord.some(x=>!Number.isFinite(x))||new Set(coord).size!==coord.length)
    throw Error('Numeric dose-line plots require distinct numeric concentration headers (e.g., 0, 0.05, 0.1, 0.2).');
  return coord;
}
