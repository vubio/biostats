import test from 'node:test';
import assert from 'node:assert/strict';
import {plotSpec,defaultChartSettings} from '../src/charts.js';
const input=[
 {name:'0',values:[100,110,90]},
 {name:'0.05',values:[90,95,100]},
 {name:'0.1',values:[60,70,80]},
 {name:'0.2',values:[20,30,40]},
];
const settings={...defaultChartSettings(),type:'dose-line',xTitle:'Erastin2 (µM)',yTitle:'Luminescence',showLines:true,showMarkers:true,showLegend:true};
test('true numeric x spacing includes zero',()=>{
 const a=plotSpec(input,settings);
 assert.deepEqual(a.traces[0].x,[0,0.05,0.1,0.2]);
 assert.deepEqual(a.traces[0].y,[100,95,70,30]);
 assert.equal(a.layout.xaxis.title.text,'Erastin2 (µM)');
 assert.equal(a.layout.showlegend,true);
});
test('normalization uses control mean and leaves raw values unchanged',()=>{
 const normalized=plotSpec(input,{...settings,normalization:'control100',reference:'0'});
 assert.deepEqual(normalized.traces[0].y,[100,95,70,30]);
 assert.equal(normalized.layout.yaxis.title.text,'Luminescence');
 assert.deepEqual(input[0].values,[100,110,90]);
});
test('normalization is not raw when control mean differs from 100',()=>{
 const x=input.map(g=>({...g,values:g.values.map(v=>v*1000)}));
 const normalized=plotSpec(x,{...settings,normalization:'control100',reference:'0'});
 assert.equal(normalized.traces[0].y[0],100);
 assert.equal(normalized.traces[0].y[2],70);
 assert.equal(plotSpec(x,settings).traces[0].y[0],100000);
});
test('show or hide connecting lines and individual replicate points',()=>{
 const line=plotSpec(input,settings),without=plotSpec(input,{...settings,showLines:false,showMarkers:false});
 assert.equal(line.traces[0].mode,'lines+markers');
 assert.equal(without.traces[0].mode,'markers');
 assert.equal(without.traces.length,1);
});
test('annotations work with numeric group headers',()=>{
 const comp=[{group1:'0',group2:'0.2',p_adjusted:.003,p_raw:.001}];
 const plot=plotSpec(input,{...settings,annotationFormat:'stars'},comp);
 assert.equal(plot.layout.shapes.length,1);
 assert.equal(plot.layout.annotations[0].text,'**');
});
test('standard group ANOVA graph remains supported',()=>{
 const plot=plotSpec(input,{...settings,type:'dots',normalization:'raw',showLegend:false});
 assert.equal(plot.layout.xaxis.tickvals.length,4);
 assert.equal(plot.layout.showlegend,false);
});
