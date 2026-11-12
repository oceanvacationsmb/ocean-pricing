const {fail}=require('./providers.cjs');
class GitHubStore{
 constructor({repo,token,branch='main',request=fetch}){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo||'')||!token)throw Error('Set GITHUB_DATA_REPO and GITHUB_DATA_TOKEN.');
  this.base='https://api.github.com/repos/'+repo;this.token=token;this.branch=branch;this.request=request;this.sha=null;this.last=null;this.queue=Promise.resolve();
 }
 async call(route,options={}){
  let response;try{response=await this.request(this.base+route,{...options,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+this.token,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json',...options.headers}});}catch{throw fail(503,'GitHub storage could not be reached. Your change is not confirmed saved to GitHub.');}
  if(response.status===404&&options.allowMissing)return null;
  if(!response.ok)throw fail(503,response.status===409||response.status===422?'GitHub data changed elsewhere. Restart the service to reload it before saving.':'GitHub storage rejected the request ('+response.status+'). Check its token and repository access.');
  return response.json();
 }
 async load(){
  const repo=await this.call('');if(repo.private!==true)throw Error('The data repository must be private.');
  const file=await this.call('/contents/data.json?ref='+encodeURIComponent(this.branch),{allowMissing:true});if(!file)return null;
  if(file.type!=='file'||!file.sha)throw Error('GitHub data.json is not a file.');
  const blob=file.encoding==='base64'?file:await this.call('/git/blobs/'+file.sha);
  let data;try{data=JSON.parse(Buffer.from(blob.content,'base64').toString('utf8'));}catch{throw Error('GitHub saved data is invalid. Nothing was overwritten.');}
  if(data.version!==1||!Array.isArray(data.properties)||!Array.isArray(data.usage)||!data.comps||!data.assignments||!data.snapshots||!data.ownCalendars)throw Error('GitHub saved data has an unsupported structure.');
  this.sha=file.sha;this.last=JSON.stringify(data);return data;
 }
 save(data){
  const text=JSON.stringify(data);
  this.queue=this.queue.catch(()=>{}).then(async()=>{
   if(text===this.last)return;
   const result=await this.call('/contents/data.json',{method:'PUT',body:JSON.stringify({message:'Save pricing settings and rates',branch:this.branch,content:Buffer.from(text).toString('base64'),...(this.sha?{sha:this.sha}:{})})});
   this.sha=result.content.sha;this.last=text;
  });this.queue.catch(()=>{});return this.queue;
 }
 flush(){return this.queue;}
}
module.exports={GitHubStore};
