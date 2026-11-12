const {fail}=require('./providers.cjs');
const fields={guestyClientId:'GUESTY_CLIENT_ID',guestyClientSecret:'GUESTY_CLIENT_SECRET',airroiKey:'AIRROI_API_KEY'};
class RenderKeys{
 constructor({token,serviceId,request=fetch}){if(!token||!/^srv-[a-z0-9]+$/.test(serviceId||''))throw Error('Render key updates need RENDER_API_KEY and RENDER_SERVICE_ID.');this.token=token;this.base='https://api.render.com/v1/services/'+serviceId;this.request=request;this.busy=false;}
 async call(route,method,body){let response;try{response=await this.request(this.base+route,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});}catch{throw fail(503,'Could not reach Render.');}if(!response.ok)throw fail(503,'Render rejected the update ('+response.status+'). Check the Render API key and its permissions.');}
 async update(input){
  if(this.busy||this.deploying)throw fail(409,'A Render key update or deployment is already in progress. Wait for it to finish, then reload.');
  if(Object.keys(input).some(key=>!Object.hasOwn(fields,key)))throw fail(400,'Only Guesty ID, Guesty secret and AirROI key can be changed here.');
  const entries=Object.entries(fields).filter(([key])=>typeof input[key]==='string'&&input[key].trim()).map(([key,name])=>[name,input[key].trim()]);
  if(!entries.length)throw fail(400,'Enter at least one new value. Blank fields stay unchanged.');
  if(entries.some(([,value])=>value.length>5000||/[\r\n\0]/.test(value)))throw fail(400,'API values must be single-line text.');
  const saved=[];this.busy=true;
  try{for(const [name,value]of entries){await this.call('/env-vars/'+name,'PUT',{value});saved.push(name);}await this.call('/deploys','POST',{clearCache:'do_not_clear'});this.deploying=true;return {saved,deployStarted:true};}
  catch(error){throw fail(error.status||503,(saved.length?'Saved '+saved.join(', ')+' in Render, but activation is not confirmed. ':'No changes confirmed. ')+error.message+' Check Render before retrying.');}
  finally{this.busy=false;}
 }
}
module.exports={RenderKeys};
