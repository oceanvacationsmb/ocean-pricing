const { fail } = require('./providers.cjs');
function normalizeLocks(data) {
 const rows=Array.isArray(data)?data:data?.locks||data?.results||data?.items||data?.data?.locks||data?.data;
 if(!Array.isArray(rows))throw fail(502,'Guesty returned an unrecognized lock response.');
 const total=Number(data?.total??data?.count??data?.pagination?.total??rows.length);
 if(total>rows.length)throw fail(502,'Guesty returned an incomplete lock page. Saved readings were kept.');
 return rows.flatMap(lock=>{
  const raw=lock.batteryPercent??lock.batteryPercentage??lock.batteryLevel??lock.battery?.level??(typeof lock.battery==='number'?lock.battery:null);
  const batteryPercent=typeof raw==='number'&&Number.isFinite(raw)&&raw>=0&&raw<=100?Math.round(raw):null;
  const status=lock.batteryStatus??lock.battery?.status??(typeof lock.battery==='string'?lock.battery:'');
  const batteryStatus=batteryPercent!==null?(batteryPercent<=10?'critical':batteryPercent<=30?'low':'good'):/^(good|low|critical)$/i.test(status)?status.toLowerCase():'unknown';
  const connected=lock.online??lock.isOnline??lock.status?.online;
  const online=typeof connected==='boolean'?connected:null;
  const listings=lock.listings||lock.properties||(lock.listing?[lock.listing]:[]);
  if(!Array.isArray(listings)||!listings.length)throw fail(502,'Guesty lock has no recognized property mapping.');
  return listings.map(p=>({id:String(lock.id||lock._id||''),listingId:String(p.id||p._id||''),propertyName:p.nickname||p.title||'',lockName:lock.doorLock||lock.name||'',batteryPercent,batteryStatus,online}));
 });
}
function createLockReader(providers,env=process.env){
 let cached=null,pending=null,failedUntil=0,lastError=null;
 return async()=>{
  if(cached&&Date.now()-Date.parse(cached.capturedAt)<60000)return cached;
  if(Date.now()<failedUntil)throw lastError;
  if(pending)return pending;
  pending=(async()=>{
   const token=await providers.guestyToken();
   const url=new URL('https://app.guesty.com/api/sl-service/locks');
   url.search=new URLSearchParams({accountId:env.GUESTY_ACCOUNT_ID||'68d5ff6bea1895d9005ea411',limit:'100',linked:'true',search:'',sort:'doorLock'}).toString();
   const response=await providers.guestyRequest(url.href,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw fail(502,'Guesty Locks Manager rejected the stored Open API token (HTTP '+response.status+').');
   const locks=normalizeLocks(await response.json());
   cached={capturedAt:new Date().toISOString(),source:'guesty-locks-manager',locks,stale:false};
   return cached;
  })();
  try{return await pending;}catch(error){lastError=error;failedUntil=Date.now()+60000;throw error;}finally{pending=null;}
 };
}
module.exports={normalizeLocks,createLockReader};
