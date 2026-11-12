const test=require('node:test'),assert=require('node:assert/strict');
const {median,propose}=require('../public/engine.js');
test('property scan progress counts only its own requested and completed competitors',()=>{const {scanProgress}=require('../public/engine.js');const job={processed:2,errors:[{listingId:'b'}]};assert.deepEqual(scanProgress(job,['a','c'],['a','b','c']),{total:2,done:1,percent:50,errors:0});assert.deepEqual(scanProgress(job,['b'],['a','b','c']),{total:1,done:1,percent:100,errors:1});assert.deepEqual(scanProgress(job,['cached','c'],['a','b','c']),{total:2,done:1,percent:50,errors:0});});
test('adjustment percentages use the Guesty rate as the base',()=>{const {adjustment}=require('../public/engine.js');assert(Math.abs(adjustment(200,220)-10)<0.00001);assert(Math.abs(adjustment(200,180)+10)<0.00001);assert.equal(adjustment(200,200),0);assert.equal(adjustment(0,200),null);assert.equal(adjustment(200,null),null);});
const options={mode:'match',percent:10,minComps:3,floor:1,ceiling:100000};
test('limited comp sets produce median-based suggestions without inventing unavailable rates',()=>{const settings={...options,minComps:1};assert.equal(propose({current:300,comps:[{rate:220,available:true}]},settings).proposed,220);assert.equal(propose({current:300,comps:[{rate:220,available:true},{rate:240,available:true}]},settings).proposed,230);assert.equal(propose({current:300,comps:[{rate:220,available:false}]},settings).proposed,null);});
const row={current:300,comps:[{rate:200,available:null},{rate:250,available:null},{rate:300,available:null},{rate:900,available:false},{rate:null,available:true}]};
test('rate-only data uses valid prices without assuming availability and excludes known unavailable comps',()=>{assert.equal(propose(row,options).proposed,250);assert.equal(propose(row,{...options,mode:'plus'}).proposed,275);assert.equal(propose(row,{...options,mode:'minus'}).proposed,225);});
test('booked, locked, insufficient comps and minimum price protections',()=>{assert.equal(propose({...row,booked:true},options).proposed,null);assert.equal(propose({...row,locked:true},options).proposed,null);assert.equal(propose(row,{...options,minComps:4}).proposed,null);assert.equal(propose(row,{...options,floor:260}).proposed,260);assert.equal(median([]),null);});

test('near-market suggestions stay yellow AVG through plus or minus ten percent',()=>{
 const {advice}=require('../public/engine.js');
 for(const [current,target]of [[100,90],[100,110],[500,450],[800,880],[1000,1000]]){const result=advice(current,target);assert.equal(result.css,'rate-average');assert.equal(result.label,'AVG');assert.ok(result.percent.endsWith('%'));}
 assert.equal(advice(500,600).css,'rate-up');assert.equal(advice(1000,800).css,'rate-down');
 assert.equal(advice(100,111).label,'INCREASE');assert.equal(advice(100,89).label,'DECREASE');
 assert.equal(advice(null,500).move,null);assert.equal(advice(500,null).css,'');
});

test('attention ranks large dollar gaps, ignores small changes and skips booked or locked nights',()=>{
 const {attentionPeriods}=require('../public/engine.js'),dates=['2027-06-01','2027-06-02','2027-06-03','2027-06-04','2027-06-05'];
 const own=dates.map((date,i)=>({date,rate:[100,1000,500,800,600][i],available:i!==3,locked:i===4,minNights:2}));
 const comps=[{snapshot:{days:dates.map((date,i)=>({date,rate:[80,700,475,400,300][i],available:true,minNights:3}))}}];
 const result=attentionPeriods(dates,own,comps);assert.equal(result.length,1);assert.equal(result[0].start,'2027-06-02');assert.equal(result[0].nightlyGap,300);assert.equal(result[0].direction,'DECREASE');assert.equal(result[0].minStayMismatch,true);
});
test('attention groups actionable consecutive nights and excludes unavailable or unknown comp prices',()=>{
 const {attentionPeriods}=require('../public/engine.js'),dates=['2027-07-01','2027-07-02','2027-07-03'];const own=dates.map(date=>({date,rate:600,available:true}));
 const comps=[{snapshot:{days:dates.map((date,i)=>({date,rate:800,available:i<2?true:null}))}},{snapshot:{days:dates.map(date=>({date,rate:100,available:false}))}}];
 const result=attentionPeriods(dates,own,comps);assert.equal(result.length,1);assert.equal(result[0].nights,2);assert.equal(result[0].target,800);assert.equal(result[0].minComps,1);assert.equal(result[0].direction,'INCREASE');
});
test('availability compares matched dates only and distinguishes unknown dates from available',()=>{
 const {availabilityComparison}=require('../public/engine.js'),dates=['2027-01-01','2027-01-02','2027-01-03'];
 const own=[{date:dates[0],available:false},{date:dates[1],available:true}];
 const comps=[{snapshot:{days:[{date:dates[0],available:false},{date:dates[1],available:null},{date:dates[2],available:false}]}},{snapshot:{days:[{date:dates[0],available:true},{date:dates[1],available:false}]}}];
 const result=availabilityComparison(dates,own,comps);assert.equal(result.matched,2);assert.equal(result.ownPercent,50);assert.equal(result.compPercent,75);assert.equal(availabilityComparison(dates,own,[]).compPercent,null);
});

test('calendar renders a small date window while preserving the full year scroll width',()=>{
 const {calendarWindow}=require('../public/engine.js');
 for(const left of [0,56*140,56*350,56*365]){const r=calendarWindow(left,1200);assert.ok(r.end-r.start<=40);assert.ok(r.start<=Math.floor(left/56));assert.ok(r.end>Math.floor(left/56));assert.equal(r.before+(r.end-r.start)*56+r.after,366*56);}
 assert.equal(calendarWindow(0,900).before,0);assert.equal(calendarWindow(56*365,900).after,0);
});

test('window minimum stays change with the visible dates and exclude closed or unknown days',()=>{
 const {windowComparisons}=require('../public/engine.js'),dates=['2027-06-01','2027-06-02','2027-06-03'];
 const own=[{date:dates[0],available:true,minNights:7},{date:dates[1],available:true,minNights:1},{date:dates[2],available:false,minNights:20}];
 const comps=[{snapshot:{cleaningFee:150,days:dates.map(date=>({date,available:true,minNights:2}))}}];
 let result=windowComparisons([dates[0]],own,comps,150);assert.equal(result.minStay.status,'HIGH');assert.equal(result.minStay.current,7);assert.equal(result.minStay.comp,2);
 result=windowComparisons([dates[1]],own,comps,150);assert.equal(result.minStay.status,'LOW');assert.equal(result.minStay.current,1);assert.equal(result.minStay.matched,1);
 assert.equal(windowComparisons([dates[2]],own,comps,150).minStay.status,'MISSING');
});
test('cleaning fees compare against arithmetic average with ten percent tolerance and retain zero values',()=>{
 const {windowComparisons}=require('../public/engine.js'),dates=['2027-06-01'],comps=[100,200].map(cleaningFee=>({snapshot:{cleaningFee,days:[{date:dates[0],available:true,minNights:2}]}}));
 assert.equal(windowComparisons(dates,[],comps,300).cleaning.status,'HIGH');assert.equal(windowComparisons(dates,[],comps,100).cleaning.status,'LOW');assert.equal(windowComparisons(dates,[],comps,165).cleaning.status,'AVG');assert.equal(windowComparisons(dates,[],comps,150).cleaning.comp,150);
 assert.equal(windowComparisons(dates,[],comps,null).cleaning.status,'MISSING');assert.equal(windowComparisons(dates,[],comps,0).cleaning.status,'LOW');assert.equal(windowComparisons(['2027-07-01'],[],comps,150).cleaning.status,'MISSING');
});
