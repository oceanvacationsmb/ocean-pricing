const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {GitHubStore}=require('../github-store.cjs'),{Store,Scans}=require('../core.cjs');
const empty=()=>({version:1,properties:[],comps:{},assignments:{},snapshots:{},ownCalendars:{},usage:[]});
function fixture(){let content=null,sha=null,conflict=false;const writes=[];return {writes,setConflict(){conflict=true;},request:async(url,options)=>{
 const response=(status,data)=>({status,ok:status<400,json:async()=>data});
 if(url.endsWith('/repos/test/data'))return response(200,{private:true});
 if(options.method==='PUT'){const body=JSON.parse(options.body);if(conflict||body.sha!==sha&&!(sha===null&&!body.sha))return response(409,{});content=JSON.parse(Buffer.from(body.content,'base64').toString());sha='sha'+(writes.length+1);writes.push(content);return response(200,{content:{sha}});}
 return content?response(200,{type:'file',sha,encoding:'base64',content:Buffer.from(JSON.stringify(content)).toString('base64')}):response(404,{});
 }};}
test('GitHub serializes saves, skips identical content and reloads rates and settings after restart',async()=>{
 const fake=fixture(),options={repo:'test/data',token:'test-only',request:fake.request},remote=new GitHubStore(options);assert.equal(await remote.load(),null);
 const data=empty();data.propertyOrder=['p'];remote.save(data);data.ownCalendars.p={days:[{date:'2026-11-12',rate:123}]};remote.save(data);await remote.flush();assert.equal(fake.writes.length,2);remote.save(data);await remote.flush();assert.equal(fake.writes.length,2);
 const restarted=new GitHubStore(options);assert.deepEqual(await restarted.load(),data);
});
test('GitHub conflicts never overwrite remote data and failures are observable',async()=>{
 const fake=fixture(),remote=new GitHubStore({repo:'test/data',token:'test-only',request:fake.request});await remote.load();await remote.save(empty());fake.setConflict();await assert.rejects(remote.save({...empty(),propertyOrder:['new']}),/changed elsewhere/);await assert.rejects(remote.flush());assert.equal(fake.writes.length,1);
});
test('public data repositories and malformed backups fail closed',async()=>{
 const options={repo:'test/data',token:'test-only'};
 await assert.rejects(new GitHubStore({...options,request:async()=>({ok:true,json:async()=>({private:false})})}).load(),/must be private/);
 let count=0;const request=async()=>({ok:true,json:async()=>++count===1?{private:true}:{type:'file',sha:'x',encoding:'base64',content:Buffer.from('{}').toString('base64')}});await assert.rejects(new GitHubStore({...options,request}).load(),/unsupported structure/);
});
test('scan does not contact paid provider if GitHub cannot save attempt ledger; credentials excluded',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ocean-git-'));try{
 const store=new Store(dir);store.data.properties=[{id:'p'}];store.data.comps.c={id:'c'};store.data.assignments.p=['c'];store.data.secret='never-save';let saved,calls=0;
 store.remote={save(data){saved=data;},flush(){return Promise.reject(Error('storage down'));}};
 const scans=new Scans(store,{status:()=>({airroi:true}),competitor:async()=>{calls++;}}),plan=scans.plan({propertyIds:['p'],force:true,type:'calendar'}),job=scans.start(plan.id,1);
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(job.status,'failed');assert.equal(calls,0);assert.equal(saved.secret,undefined);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
