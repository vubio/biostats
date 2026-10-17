// Explicit schemas: never silently treat longitudinal or factorial data as independent columns.
export const METHODS = {
  groups:[
    ['anova','Ordinary one-way ANOVA + Tukey HSD'],['welch_anova','Welch ANOVA + Welch/Holm pairs'],
    ['kruskal','Kruskal–Wallis + Mann–Whitney/Holm'],['ttest','Student unpaired t test'],
    ['welch_ttest','Welch unpaired t test'],['paired_ttest','Paired t test (two columns)']
  ],
  time:[['time_independent','Independent groups × time ANOVA'],['time_repeated','Repeated measurements: one cohort over time']],
  factorial:[['two_factor','Two-factor ANOVA (balanced, independent)']],
  survival:[['survival_logrank','Kaplan–Meier + log-rank test']],
  dose:[['dose_4pl','4-parameter fit + IC50 (decreasing curve)']]
};
export const FAMILY_NAMES={groups:'One measurement across groups',time:'Time course / longitudinal',factorial:'Two-factor designs',survival:'Survival analysis',dose:'Dose–response / IC50'};
const HEADERS={
  time_independent:['Group','Time','Value'],time_repeated:['Subject ID','Time','Value'],
  two_factor:['Factor A','Factor B','Value'],survival_logrank:['Subject ID','Group','Time','Event (1=event; 0=censored)'],
  dose_4pl:['Group','Dose','Response']
};
export const isSpecial=test=>Object.prototype.hasOwnProperty.call(HEADERS,test);
export const specialHeaders=test=>HEADERS[test]||null;
export const familyForTest=test=>Object.keys(METHODS).find(k=>METHODS[k].some(x=>x[0]===test))||'groups';
export const defaultLongRows=test=>[HEADERS[test], ...Array.from({length:8},(_,i)=>HEADERS[test].map((_,j)=>j===0&&test==='time_repeated'?`Mouse${i+1}`:''))];
const finite=(value,label)=>{const n=Number(value);if(value===''||!Number.isFinite(n))throw Error(`${label} must be a finite number`);return n;};
export function validateSpecialTable(rows,test){
  const headers=HEADERS[test];if(!headers)throw Error('No table schema for this analysis.');
  if(rows.length<2)throw Error('Create a data table first.');
  if(rows[0].length!==headers.length||rows[0].some((h,i)=>h!==headers[i]))throw Error(`Expected exactly these headers: ${headers.join(' | ')}. Use Create blank table or a matching example.`);
  const records=[];
  rows.slice(1).forEach((r,i)=>{
    const parts=headers.map((_,j)=>String(r[j]??'').trim());
    if(parts.every(x=>x===''))return;
    if(parts.some(x=>x===''))throw Error(`Row ${i+2} must be complete. Blank the entire row to exclude it.`);
    const index=i+2;
    if(test==='time_independent')records.push({a:parts[0],b:String(finite(parts[1],`Row ${index} Time`)),value:finite(parts[2],`Row ${index} Value`)});
    if(test==='time_repeated')records.push({subject:parts[0],time:String(finite(parts[1],`Row ${index} Time`)),value:finite(parts[2],`Row ${index} Value`)});
    if(test==='two_factor')records.push({a:parts[0],b:parts[1],value:finite(parts[2],`Row ${index} Value`)});
    if(test==='survival_logrank'){
      const time=finite(parts[2],`Row ${index} Time`),event=finite(parts[3],`Row ${index} Event`);
      if(time<0)throw Error(`Row ${index}: follow-up time cannot be negative.`);
      if(event!==0&&event!==1)throw Error(`Row ${index}: Event must equal 0 or 1.`);
      records.push({subject:parts[0],group:parts[1],time,event});
    }
    if(test==='dose_4pl'){
      const dose=finite(parts[1],`Row ${index} Dose`);
      if(dose<=0)throw Error(`Row ${index}: doses must be positive for log-scale fitting.`);
      records.push({group:parts[0],dose,value:finite(parts[2],`Row ${index} Response`)});
    }
  });
  if(records.length<2)throw Error('Enter at least two complete rows.');
  return {records,rows:records.length};
}
