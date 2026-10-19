// Interpretation guidance applies to all independent factorial analyses.
export function interactionGuide(test,result=null) {
  if(!['two_factor_xy','two_factor','time_independent'].includes(test))return null;
  const names=test==='two_factor_xy'?['Condition','Dose']:test==='time_independent'?['Group','Time']:['Factor A','Factor B'];
  const interaction=names.join(' × ');
  const entry=result?.effects?.find(e=>String(e.effect).includes('×'));
  const alpha=Number(result?.alpha??0.05);
  let status='Run this analysis to assess the overall interaction.';
  if(entry&&Number.isFinite(entry.p_value)){
    const p=entry.p_value;
    status=p<alpha?`Interaction P = ${p.toPrecision(4)} (below α = ${alpha}). Response patterns may differ, but this does not identify which individual doses or levels differ.`:
      `Interaction P = ${p.toPrecision(4)} (not below α = ${alpha}). This is not evidence that individual responses are identical at every dose or level.`;
  }
  return {title:`Understanding the ${interaction} interaction`,status,
    main:`The interaction asks whether the effect of ${names[1]} depends on ${names[0]}. This is a comparison of patterns, not a comparison at any single ${names[1].toLowerCase()} level.`,
    example:test==='two_factor_xy'?
      'Example: WT viability drops from 100 to 35%, while KO drops from 100 to 75%. The overall pattern differs, but the interaction test alone cannot establish at which specific doses WT and KO differ.':
      `An overall ${interaction} effect does not say which particular pairs or ${names[1].toLowerCase()} levels differ.`,
    follow:'To test specific differences, predefine appropriate simple-effect comparisons (for example WT versus KO separately at each dose) and adjust the planned family of comparisons, such as with Holm correction. These per-dose tests are not yet calculated automatically by this module.',
    caution:'Technical wells are not automatically independent biological replicates. Measurements from the same biological unit may require a repeated-measures or mixed-effects design, not independent two-way ANOVA.'};
}
