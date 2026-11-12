const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fail}=require('./providers.cjs');
function parseListing(value){const input=String(value||'').trim();if(/^\d{6,22}$/.test(input))return input;try{const url=new URL(input);if(url.protocol!=='https:'||!/(^|\.)airbnb\.[a-z.]+$/i.test(url.hostname))throw Error();const match=url.pathname.match(/^\/rooms\/(\d{6,22})(?:\/|$)/);if(match)return match[1];if(url.pathname.startsWith('/h/'))throw fail(400,'Open that short Airbnb link and copy the full /rooms/ listing URL from the address bar.');}catch(error){if(error.status)throw error;}throw fail(400,'Use a full Airbnb /rooms/ listing URL or its numeric listing ID.');}
class Store{
 constructor(directory){this.directory=directory;this.file=path.join(directory,'data.json');fs.mkdirSync(directory,{recursive:true});this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,properties:[],comps:{},assignments:{},snapshots:{},ownCalendars:{},usage:[]};}
 save(){const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data));fs.renameSync(temp,this.file);if(this.remote)this.remote.save(this.backup());}
 flush(){return this.remote?this.remote.flush():Promise.resolve();}
 backup(){return {version:1,includedPropertyIds:this.data.includedPropertyIds??null,propertyOrder:this.data.propertyOrder||[],properties:this.data.properties,compMasters:this.data.compMasters||{},comps:this.data.comps,assignments:this.data.assignments,snapshots:this.data.snapshots,ownCalendars:this.data.ownCalendars,usage:this.data.usage};}
 latest(id,type){const types=type==='rates'?['rates','calendar']:['calendar'];return types.map(t=>this.data.snapshots[id+':'+t]).filter(Boolean).sort((a,b)=>b.fetchedAt.localeCompare(a.fetchedAt))[0]||null;}
 master(propertyId){const seen=new Set();let id=propertyId;while(this.data.compMasters?.[id]){if(seen.has(id))throw fail(400,'Comp sharing cannot contain a cycle.');seen.add(id);id=this.data.compMasters[id];}return id;}
 assignment(propertyId){return [...new Set(this.data.assignments[this.master(propertyId)]||[])];}
}
class Scans{
 constructor(store,providers){this.store=store;this.providers=providers;this.plans=new Map();this.jobs=new Map();this.activeJob=null;}
 plan(input){
  const propertyIds=[...new Set(input.propertyIds||[])];if(!propertyIds.length||propertyIds.some(id=>!this.store.data.properties.some(p=>p.id===id)))throw fail(400,'Select existing properties.');
  if(propertyIds.some(id=>this.store.master(id)!==id))throw fail(400,'Refresh shared comps from their master property only.');
  if(this.store.data.includedPropertyIds&&propertyIds.some(id=>!this.store.data.includedPropertyIds.includes(id)))throw fail(400,'This property is unchecked in Settings.');const type=input.type==='calendar'?'calendar':'rates',ageDays=Number(input.ageDays||14);if(![7,14,30].includes(ageDays))throw fail(400,'Choose a 7, 14, or 30-day refresh period.');
  const assigned=[...new Set(propertyIds.flatMap(id=>this.store.assignment(id)))];
  if(input.compIds!==undefined&&(!Array.isArray(input.compIds)||!input.compIds.length||input.compIds.some(id=>!assigned.includes(id))))throw fail(400,'Select competitors assigned to these properties.');
  const ids=input.compIds?[...new Set(input.compIds)]:assigned;if(!ids.length)throw fail(400,'Assign at least one competitor first.');if(ids.length>500)throw fail(400,'Scan at most 500 unique competitors at a time.');
  const now=Date.now(),due=ids.filter(id=>{const saved=this.store.latest(id,type);return input.force||!saved||now-Date.parse(saved.fetchedAt)>=ageDays*86400000;});
  const plan={id:crypto.randomUUID(),createdAt:new Date().toISOString(),expiresAt:now+5*60000,propertyIds,ids,due,type,ageDays,force:Boolean(input.force),costPerCall:type==='rates'?.10:.20,estimatedCost:Number((due.length*(type==='rates'?.10:.20)).toFixed(2)),cached:ids.length-due.length};
  for(const [id,p]of this.plans)if(p.expiresAt<now&&!p.jobId)this.plans.delete(id);this.plans.set(plan.id,plan);return plan;
 }
 start(id,budget){const plan=this.plans.get(id);if(!plan||plan.expiresAt<Date.now())throw fail(400,'Scan estimate expired. Review a new estimate.');if(plan.jobId)return this.jobs.get(plan.jobId);if(this.activeJob)throw fail(409,'A scan is already running. Its data will be reused when it finishes.');if(!this.providers.status().airroi&&plan.due.length)throw fail(400,'Connect AirROI before scanning.');if(!Number.isFinite(budget)||budget<plan.estimatedCost)throw fail(400,'The scan exceeds your allowed budget.');
  const job={id:crypto.randomUUID(),status:'running',total:plan.due.length,processed:0,attempted:0,succeeded:0,errors:[],estimatedSpend:0,startedAt:new Date().toISOString(),planId:plan.id};plan.jobId=job.id;this.jobs.set(job.id,job);this.activeJob=job.id;
  this.execute(job,plan).finally(()=>{this.activeJob=null;});return job;
 }
 async execute(job,plan){try{for(const id of plan.due){
   const newer=this.store.latest(id,plan.type);if(newer&&Date.parse(newer.fetchedAt)>Date.parse(plan.createdAt)){job.processed++;continue;}
   job.attempted++;job.estimatedSpend=Number((job.attempted*plan.costPerCall).toFixed(2));
   const ledger={listingId:id,type:plan.type,time:new Date().toISOString(),estimatedCost:plan.costPerCall,status:'attempted'};this.store.data.usage.push(ledger);this.store.save();await this.store.flush();
   try{const result=await this.providers.competitor(id,plan.type);this.store.data.snapshots[id+':'+plan.type]={...result,listingId:id,type:plan.type,fetchedAt:new Date().toISOString()};ledger.status='success';job.succeeded++;}
   catch(error){ledger.status='failed';job.errors.push({listingId:id,message:error.message});}
   job.processed++;this.store.save();await this.store.flush();
  }job.status=job.errors.length?'partial':'complete';}catch{job.status='failed';job.errors.push({message:'Saving failed. Stop scanning and check storage before continuing. The latest result is kept in the running app.'});}finally{job.finishedAt=new Date().toISOString();}}
}
module.exports={Store,Scans,parseListing};

