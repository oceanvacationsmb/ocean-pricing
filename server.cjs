const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Providers,fail}=require('./providers.cjs');const {Store,Scans,parseListing}=require('./core.cjs');
function createApp({directory=path.join(__dirname,'.local'),providers=new Providers(),titleReader=require('./airbnb-title.cjs').readAirbnbTitle,ratingReader=require('./airbnb-title.cjs').readAirbnbProfile,hosting=null,renderKeys=null}={}){
 const store=new Store(directory);providers.setRateLimitStore?.(directory);const scans=new Scans(store,providers),session=crypto.randomBytes(32).toString('hex'),calendarFlights=new Map(),titleFlights=new Map();
 const ratingUpdate=new (require('./ratings.cjs').RatingUpdate)(store,providers,ratingReader);
 const auth=hosting?new (require('./auth.cjs').DashboardAuth)(hosting):null;
 const send=async(res,status,body)=>{if(status<400){try{await store.flush();}catch(error){status=503;body={error:error.message||'GitHub saving failed. Your change is not confirmed saved.'};}}res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
 const bootstrap=()=>({properties:store.data.properties.map(p=>({...p,airbnbListingId:store.data.propertyLinks?.[p.id]?.airbnbListingId||p.airbnbListingId||null})),includedPropertyIds:store.data.includedPropertyIds??null,propertyOrder:store.data.propertyOrder||[],comps:store.data.comps,assignments:Object.fromEntries(store.data.properties.map(p=>[p.id,store.assignment(p.id)])),compMasters:store.data.compMasters||{},connections:providers.status(),hosted:Boolean(hosting),renderKeyUpdates:Boolean(hosting&&renderKeys),readOnly:true,usage:store.data.usage.slice(-300),activeJob:scans.activeJob?scans.jobs.get(scans.activeJob):null});
 const server=http.createServer(async(req,res)=>{
  const host=req.headers.host||'';
  if(hosting&&req.method==='GET'&&req.url==='/healthz')return send(res,200,{ok:true});
  if(hosting?host!==hosting.host:!/^127\.0\.0\.1:\d+$/.test(host)){send(res,403,{error:'Open the app using its configured address.'});return;}
  const url=new URL(req.url,'http://'+host),route=url.pathname;
  res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  try{
   if(auth&&await auth.handle(req,res,route))return;
   if(route.startsWith('/api/')){
    if(req.headers.origin&&req.headers.origin!==(hosting?hosting.origin:'http://'+host))throw fail(403,'Requests from another site are blocked.');
    if(req.headers['x-ocean-request']!=='1'||!String(req.headers.cookie||'').split(';').some(x=>x.trim()==='oceanPricing='+session))throw fail(403,'Reload the app to reconnect your local session.');
    let body={};if(req.method==='POST'){let buffer='';for await(const chunk of req){buffer+=chunk;if(buffer.length>100000)throw fail(413,'Request is too large.');}try{body=JSON.parse(buffer||'{}');}catch{throw fail(400,'Invalid request.');}}
    const key=req.method+' '+route;
    if(req.method==='POST'&&key!=='POST /api/render-keys'&&(renderKeys?.busy||renderKeys?.deploying))throw fail(409,'Render is updating API keys. Wait for the deployment to finish, then reload before making more changes.');
    if(key==='POST /api/ratings-update'){if(scans.activeJob)throw fail(409,'Wait for the current comp scan to finish.');return send(res,200,ratingUpdate.start());}
    if(key==='GET /api/ratings-update')return send(res,200,ratingUpdate.job||{status:'idle'});
    if(key==='GET /api/state')return send(res,200,bootstrap());
    if(key==='POST /api/guesty/channel-links'){
 const p=store.data.properties.find(p=>p.id===body.propertyId);if(!p)throw fail(400,'Choose an existing property.');
 const raw=await providers.guestyGet('/listings/'+encodeURIComponent(p.id)+'?fields='+encodeURIComponent('_id integrations channels'));
 const links=require('./providers.cjs').channelLinks(raw);if(!Object.keys(links).length)throw fail(502,'Guesty did not return published channel links. Existing links were kept.');
 p.channelLinks={...p.channelLinks,...links};if(links.airbnb)p.airbnbListingId=links.airbnb.match(/rooms\/(\d+)/)[1];store.save();scans.plans.clear();return send(res,200,bootstrap());}
    if(key==='POST /api/property-link'){
     if(scans.activeJob)throw fail(409,'Wait for the current scan to finish.');
     if(!store.data.properties.some(p=>p.id===body.propertyId))throw fail(400,'Choose an existing property.');
     const airbnbListingId=parseListing(body.url);store.data.propertyLinks||={};store.data.propertyLinks[body.propertyId]={...store.data.propertyLinks[body.propertyId],airbnbListingId};store.save();scans.plans.clear();return send(res,200,bootstrap());
    }
    if(key==='POST /api/guesty/extra-fees'){
     if(!store.data.properties.some(p=>p.id===body.propertyId))throw fail(400,'Choose an existing property.');
     const result=await providers.guestyGet('/additional-fees/listing/'+encodeURIComponent(body.propertyId)),rows=Array.isArray(result)?result:result?.results||result?.additionalFees;
     if(!Array.isArray(rows))throw fail(502,'Guesty fee response was not recognized. Saved fees were kept.');
     const fees=rows.map(f=>({name:String(f.name||f.title||f.secondIdentifier||'Additional fee').slice(0,100),amount:Number.isFinite(Number(f.amount))&&f.amount!==null&&f.amount!==undefined&&f.amount!==''?Number(f.amount):null,units:typeof f.type==='string'?f.type.slice(0,50):null,quantifier:typeof f.quantifier==='string'?f.quantifier.slice(0,50):null}));
     store.data.propertyLinks||={};store.data.propertyLinks[body.propertyId]={...store.data.propertyLinks[body.propertyId],extraFees:fees,feesFetchedAt:new Date().toISOString()};store.save();return send(res,200,{fees});
    }
    if(key==='POST /api/render-keys'){
     if(!hosting||!renderKeys)throw fail(400,'One-time setup needed: add RENDER_API_KEY to this service in Render, then deploy. Do not enter that key here.');
     if(scans.activeJob||calendarFlights.size||ratingUpdate.job?.status==='running')throw fail(409,'Wait for scans and rate refreshes to finish before updating keys.');
     await store.flush();const result=await renderKeys.update(body);return send(res,200,result);
    }
    if(key==='POST /api/settings'){
     if(scans.activeJob)throw fail(409,'Wait for the current scan to finish before changing included properties.');
     if(!Array.isArray(body.propertyIds)||body.propertyIds.some(id=>!store.data.properties.some(p=>p.id===id)))throw fail(400,'Choose existing properties.');
     if(body.propertyOrder!==undefined&&(!Array.isArray(body.propertyOrder)||new Set(body.propertyOrder).size!==body.propertyOrder.length||body.propertyOrder.some(id=>!store.data.properties.some(p=>p.id===id))))throw fail(400,'Invalid property order.');
     store.data.includedPropertyIds=[...new Set(body.propertyIds)];if(body.propertyOrder)store.data.propertyOrder=body.propertyOrder;store.save();scans.plans.clear();return send(res,200,bootstrap());
    }
    if(key==='POST /api/connections'){if(hosting)throw fail(400,'Use Settings → API keys to update credentials in Render.');
     if(scans.activeJob)throw fail(409,'Wait for the current scan to finish before changing connections.');
     const values={};for(const name of ['guestyClientId','guestyClientSecret','airroiKey'])if(typeof body[name]==='string'&&body[name].trim())values[name]=body[name].trim();
     providers.configure(values);return send(res,200,{connections:providers.status()});
    }
    if(key==='POST /api/disconnect'){if(hosting)throw fail(400,'Manage API keys in Settings.');if(scans.activeJob)throw fail(409,'Wait for the current scan to finish.');providers.disconnect();return send(res,200,{connections:providers.status()});}
    if(key==='POST /api/guesty/sync'){
     const properties=await providers.listings();if(!properties.length)throw fail(502,'Guesty returned no properties. Existing saved properties were kept.');
     const added204=properties.filter(p=>!store.data.properties.some(old=>old.id===p.id)&&p.bedrooms===2&&/(?:^|[^0-9])204[\s-]*2d(?:$|[^a-z0-9])/i.test(p.name));
     if(Array.isArray(store.data.includedPropertyIds))store.data.includedPropertyIds=[...new Set([...store.data.includedPropertyIds,...added204.map(p=>p.id)])];
     if(Array.isArray(store.data.propertyOrder))store.data.propertyOrder=[...new Set([...store.data.propertyOrder,...added204.map(p=>p.id)])];
     store.data.properties=properties;store.save();return send(res,200,bootstrap());
    }
    if(key==='POST /api/airbnb-title'){
     const id=parseListing(body.url||body.id),cached=store.data.comps[id];if(cached?.listingTitle)return send(res,200,{id,name:cached.listingTitle,cached:true});
     if(!titleFlights.has(id)){const flight=(async()=>{const name=await titleReader(id);const existing=store.data.comps[id];store.data.comps[id]={...existing,id,name:existing?.name||name,listingTitle:name,url:'https://www.airbnb.com/rooms/'+id};store.save();return {id,name,cached:false};})();titleFlights.set(id,flight);flight.finally(()=>titleFlights.delete(id)).catch(()=>{});}
     return send(res,200,await titleFlights.get(id));
    }
    if(key==='POST /api/master-link'){
     if(scans.activeJob)throw fail(409,'Wait for the current scan to finish before changing comp sharing.');
     const id=body.propertyId,source=body.masterId||null;if(!store.data.properties.some(p=>p.id===id)||source&&!store.data.properties.some(p=>p.id===source))throw fail(400,'Choose existing properties.');
     if(source===id)throw fail(400,'A property cannot follow itself.');
     const previous=store.data.compMasters||{},next={...previous};if(source)next[id]=source;else delete next[id];store.data.compMasters=next;
     try{for(const p of store.data.properties)store.master(p.id);}catch(error){store.data.compMasters=previous;throw error;}
     store.save();scans.plans.clear();return send(res,200,bootstrap());
    }
    if(key==='POST /api/comps'){
     if(store.master(body.propertyId)!==body.propertyId)throw fail(400,'Edit these shared comps from the master property.');
     if(!store.data.properties.some(p=>p.id===body.propertyId))throw fail(400,'Select a Guesty property first.');
     const id=parseListing(body.url||body.id);const existing=store.data.comps[id];
     if(!store.assignment(body.propertyId).includes(id)&&store.assignment(body.propertyId).length>=5)throw fail(400,'Use up to 5 competitors per property. Remove one before adding another.');
     store.data.comps[id]={...existing,id,name:String(body.name||existing?.name||'Comp '+id).trim().slice(0,120),url:'https://www.airbnb.com/rooms/'+id};store.data.assignments[body.propertyId]=[...new Set([...store.assignment(body.propertyId),id])];store.save();return send(res,200,bootstrap());
    }
    if(key==='POST /api/guesty/refresh-year'){
     const id=body.propertyId;if(!store.data.properties.some(p=>p.id===id))throw fail(400,'Select an existing property.');
     if(store.data.includedPropertyIds&&!store.data.includedPropertyIds.includes(id))throw fail(400,'Include this property in Settings first.');
     if(!providers.status().guesty)throw fail(400,'Connect Guesty before refreshing rates.');
     const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),part=t=>parts.find(p=>p.type===t).value;
     const start=part('year')+'-'+part('month')+'-'+part('day'),endDate=new Date(start+'T00:00:00Z');endDate.setUTCFullYear(endDate.getUTCFullYear()+1);const end=endDate.toISOString().slice(0,10),flightKey='year:'+id+':'+start;
     if(!calendarFlights.has(flightKey)){const flight=(async()=>{const days=(await providers.calendarRange(id,start,end)).filter(d=>d.date>=start&&d.date<=end);if(!days.length)throw fail(502,'Guesty returned no dates for the requested year. Saved rates were kept.');const fetchedAt=new Date().toISOString(),months=new Map();for(const day of days){const month=day.date.slice(0,7);if(!months.has(month))months.set(month,[]);months.get(month).push(day);}for(const [month,newDays]of months){const key=id+':'+month,merged=new Map((store.data.ownCalendars[key]?.days||[]).map(day=>[day.date,day]));for(const day of newDays)merged.set(day.date,day);store.data.ownCalendars[key]={days:[...merged.values()].sort((a,b)=>a.date.localeCompare(b.date)),fetchedAt};}store.save();const span=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;return {propertyId:id,start,end,savedDays:new Set(days.map(d=>d.date)).size,expectedDays:span,partial:new Set(days.map(d=>d.date)).size<span,fetchedAt};})();calendarFlights.set(flightKey,flight);flight.finally(()=>calendarFlights.delete(flightKey)).catch(()=>{});}
     return send(res,200,await calendarFlights.get(flightKey));
    }
    if(key==='POST /api/assignments'){
     if(store.master(body.propertyId)!==body.propertyId)throw fail(400,'Edit these shared comps from the master property.');
     if(!store.data.properties.some(p=>p.id===body.propertyId))throw fail(400,'Unknown property.');
     const ids=[...new Set(body.compIds||[])];if(ids.length>5)throw fail(400,'Use up to 5 competitors per property.');if(ids.some(id=>!Object.hasOwn(store.data.comps,id)))throw fail(400,'Unknown competitor.');store.data.assignments[body.propertyId]=ids;store.save();return send(res,200,bootstrap());
    }
    if(key==='GET /api/view'){
     const id=url.searchParams.get('propertyId'),month=url.searchParams.get('month');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw fail(400,'Choose a month.');
     const property=store.data.properties.find(p=>p.id===id);if(!property)throw fail(404,'Property not found.');const ownKey=id+':'+month;let own=store.data.ownCalendars[ownKey],warning='';
     if(url.searchParams.get('refresh')==='1'&&providers.status().guesty){
      try{if(!calendarFlights.has(ownKey))calendarFlights.set(ownKey,providers.calendar(id,month).then(days=>{const value={days,fetchedAt:new Date().toISOString()};store.data.ownCalendars[ownKey]=value;store.save();return value;}).finally(()=>calendarFlights.delete(ownKey)));own=await calendarFlights.get(ownKey);}catch(error){warning=error.message;}
     }
     if(url.searchParams.get('refresh')==='1'&&providers.status().guesty&&providers.propertyDetails&&!warning){try{const details=await providers.propertyDetails(id);property.cleaningFee=details.cleaningFee;if(details.currency)property.currency=details.currency;store.save();}catch{warning+=(warning?' ':'')+'Guesty cleaning fee could not be read.';}}
     if(!own&&!warning)warning='No saved Guesty rates for these dates. Click Refresh Guesty rates to load them.';if(url.searchParams.get('refresh')==='1'&&!providers.status().guesty)warning='Guesty is disconnected. Open Settings → API keys before refreshing Guesty rates.';
     const comps=store.assignment(id).map(compId=>{const saved=store.latest(compId,'rates');return {...store.data.comps[compId],snapshot:saved?{...saved,days:saved.days.filter(d=>d.date.startsWith(month))}:null};});
     return send(res,200,{property,masterPropertyId:store.master(id),own:own||null,comps,warning,rateLimited:warning.includes('Guesty rate limit'),readOnly:true});
    }
    if(key==='POST /api/scan-plan')return send(res,200,scans.plan(body));
    if(key==='POST /api/scan'){if(body.confirm!==true)throw fail(400,'Review and confirm the estimated cost first.');return send(res,200,scans.start(body.planId,Number(body.maxCost)));}
    if(key==='GET /api/scan'){const job=scans.jobs.get(url.searchParams.get('id'));if(!job)throw fail(404,'Scan not found.');return send(res,200,job);}
    if(key==='GET /api/backup')return send(res,200,store.backup());
    // No route implements writes to Guesty. Only the OAuth exchange uses POST to Guesty.
    return send(res,404,{error:'This action is not available. Guesty rate updates are disabled.'});
   }
   if(req.method!=='GET')return send(res,405,{error:'Method not allowed.'});
   const assets={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/engine.js':'engine.js'};const name=assets[route];if(!name)return send(res,404,{error:'Not found.'});
   const file=path.join(__dirname,'public',name);res.setHeader('Set-Cookie','oceanPricing='+session+'; HttpOnly; SameSite=Strict; Path=/'+(hosting?'; Secure':''));res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
  }catch(error){send(res,error.status||500,{error:error.status?error.message:'The request could not be completed. Your saved data was kept.'});}
 });
 return {server,store,scans,providers};
}
async function start(){
 const env=process.env,port=Number(env.PORT||8772),hosting=require('./hosting.cjs').hostingConfig(env),providers=new Providers(),credentials={};
 if(env.GUESTY_CLIENT_ID)credentials.guestyClientId=env.GUESTY_CLIENT_ID;if(env.GUESTY_CLIENT_SECRET)credentials.guestyClientSecret=env.GUESTY_CLIENT_SECRET;if(env.AIRROI_API_KEY)credentials.airroiKey=env.AIRROI_API_KEY;providers.configure(credentials);
 const renderKeys=hosting&&env.RENDER_API_KEY?new (require('./render-keys.cjs').RenderKeys)({token:env.RENDER_API_KEY,serviceId:env.RENDER_SERVICE_ID}):null;
 const app=createApp({hosting,providers,renderKeys,directory:env.DATA_DIR||path.join(__dirname,'.local')});
 if(env.GITHUB_DATA_TOKEN){const remote=new (require('./github-store.cjs').GitHubStore)({repo:env.GITHUB_DATA_REPO,token:env.GITHUB_DATA_TOKEN,branch:env.GITHUB_DATA_BRANCH||'main'});const saved=await remote.load();if(saved){app.store.data=saved;app.store.save();}else if(app.store.data.properties.length){throw Error('GitHub data.json is missing. Upload your existing backup privately before starting.');}app.store.remote=remote;}
 app.server.listen(port,hosting?'0.0.0.0':'127.0.0.1',()=>console.log('Ocean Pricing is ready on port '+port));
}
if(require.main===module)start().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={createApp};

