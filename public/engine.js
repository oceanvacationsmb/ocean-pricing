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
  function scanProgress(job,ids,due){const requested=new Set(due),completed=new Set(due.slice(0,job.processed)),errors=new Set((job.errors||[]).map(e=>e.listingId));const unique=[...new Set(ids)],done=unique.filter(id=>!requested.has(id)||completed.has(id)).length;return {total:unique.length,done,percent:unique.length?Math.round(done/unique.length*100):100,errors:unique.filter(id=>errors.has(id)).length};}
  const api={median,propose,adjustment,scanProgress};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PricingMath=api;
})(typeof window!=='undefined'?window:globalThis);
