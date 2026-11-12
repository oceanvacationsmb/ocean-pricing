(function(root){
  function median(values){const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;const m=Math.floor(sorted.length/2);return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;}
  function propose(row,settings){
    if(row.booked)return {...row,proposed:null,reason:'Booked — skipped'};
    if(row.locked)return {...row,proposed:null,reason:'Manually locked — skipped'};
    const usable=row.comps.filter(c=>c.available!==false&&Number.isFinite(c.rate)&&c.rate>0);
    const benchmark=median(usable.map(c=>c.rate));
    if(usable.length<settings.minComps)return {...row,benchmark,count:usable.length,proposed:null,reason:'Not enough comparable prices'};
    const factor=settings.mode==='plus'?1+settings.percent/100:settings.mode==='minus'?1-settings.percent/100:1;
    const target=benchmark*factor;
    const proposed=Math.round(Math.max(settings.floor,Math.min(settings.ceiling,target)));
    return {...row,benchmark,count:usable.length,proposed,change:proposed-row.current,reason:proposed!==Math.round(target)?'Price limit applied':'Ready for review'};
  }
  function adjustment(current,proposed){return Number.isFinite(current)&&current>0&&Number.isFinite(proposed)?(proposed/current-1)*100:null;}
  function advice(current,proposed){const move=adjustment(current,proposed);if(move===null)return {move:null,css:'',label:'',percent:''};const average=Math.abs(move)<=10+1e-9;return {move,css:average?'rate-average':move>0?'rate-up':'rate-down',label:average?'AVG':move>0?'INCREASE':'DECREASE',percent:(move>0?'+':move<0?'−':'')+Math.abs(move).toFixed(1)+'%'};}
  function attentionPeriods(dates,ownDays,comps){
    const own=new Map(ownDays.map(d=>[d.date,d])),maps=comps.map(c=>new Map((c.snapshot?.days||[]).map(d=>[d.date,d]))),groups=[];let group=null;
    for(const date of dates){
      const day=own.get(date),prices=maps.map(map=>map.get(date)).filter(d=>d?.available===true&&Number.isFinite(d.rate)&&d.rate>0),target=median(prices.map(d=>d.rate));
      if(day?.available!==true||day.locked||!Number.isFinite(day.rate)||day.rate<=0||target===null){group=null;continue;}
      const proposed=Math.round(target),move=adjustment(day.rate,proposed),gap=proposed-day.rate,direction=gap>0?'INCREASE':'DECREASE';
      if(Math.abs(move)<=10+1e-9||Math.abs(gap)<30){group=null;continue;}
      if(!group||group.direction!==direction||group.nights===7){group={start:date,end:date,direction,nights:0,currentTotal:0,targetTotal:0,minComps:prices.length,minStayMismatch:false};groups.push(group);}
      group.end=date;group.nights++;group.currentTotal+=day.rate;group.targetTotal+=proposed;group.minComps=Math.min(group.minComps,prices.length);
      if(prices.some(d=>Number.isFinite(d.minNights)&&Number.isFinite(day.minNights)&&d.minNights!==day.minNights))group.minStayMismatch=true;
    }
    return groups.map(g=>({...g,current:g.currentTotal/g.nights,target:g.targetTotal/g.nights,move:adjustment(g.currentTotal,g.targetTotal),nightlyGap:Math.abs(g.targetTotal-g.currentTotal)/g.nights})).sort((a,b)=>b.nightlyGap-a.nightlyGap||b.nights-a.nights||a.start.localeCompare(b.start)).slice(0,3);
  }
  function availabilityComparison(dates,ownDays,comps){
    const own=new Map(ownDays.map(d=>[d.date,d])),maps=comps.map(c=>new Map((c.snapshot?.days||[]).map(d=>[d.date,d])));let matched=0,ownUnavailable=0,compFraction=0;
    for(const date of dates){const day=own.get(date),known=maps.map(map=>map.get(date)).filter(d=>typeof d?.available==='boolean');if(typeof day?.available!=='boolean'||!known.length)continue;matched++;if(day.available===false)ownUnavailable++;compFraction+=known.filter(d=>d.available===false).length/known.length;}
    return {matched,requested:dates.length,ownPercent:matched?100*ownUnavailable/matched:null,compPercent:matched?100*compFraction/matched:null};
  }
  function scanProgress(job,ids,due){const requested=new Set(due),completed=new Set(due.slice(0,job.processed)),errors=new Set((job.errors||[]).map(e=>e.listingId));const unique=[...new Set(ids)],done=unique.filter(id=>!requested.has(id)||completed.has(id)).length;return {total:unique.length,done,percent:unique.length?Math.round(done/unique.length*100):100,errors:unique.filter(id=>errors.has(id)).length};}
  const api={median,propose,adjustment,advice,attentionPeriods,availabilityComparison,scanProgress};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PricingMath=api;
})(typeof window!=='undefined'?window:globalThis);
