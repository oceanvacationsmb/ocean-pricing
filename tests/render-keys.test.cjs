const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {RenderKeys}=require('../render-keys.cjs'),{createApp}=require('../server.cjs');
test('one optional key updates only its Render variable and starts a deploy; secrets never returned',async()=>{
 const requests=[],manager=new RenderKeys({serviceId:'srv-test123',token:'render-test-secret',request:async(url,options)=>{requests.push({url,...options});return {ok:true};}});
 const result=await manager.update({guestyClientId:'',guestyClientSecret:'new-guesty-secret',airroiKey:''});assert.equal(requests.length,2);assert.match(requests[0].url,/env-vars\/GUESTY_CLIENT_SECRET$/);assert.deepEqual(JSON.parse(requests[0].body),{value:'new-guesty-secret'});assert.match(requests[1].url,/deploys$/);assert.deepEqual(result,{saved:['GUESTY_CLIENT_SECRET'],deployStarted:true});assert(!JSON.stringify(result).includes('new-guesty-secret'));await assert.rejects(manager.update({airroiKey:'another-key'}),/already in progress/);
});
test('Render updater rejects arbitrary variables and blank submissions without requests',async()=>{
 let calls=0;const manager=new RenderKeys({serviceId:'srv-test123',token:'test-secret',request:async()=>{calls++;return {ok:true};}});
 await assert.rejects(manager.update({ADMIN_PASSWORD:'not-allowed'}),/Only Guesty/);await assert.rejects(manager.update({airroiKey:''}),/at least one/);assert.equal(calls,0);
});
test('partial Render failure reports which fields were saved, without credentials or a deploy',async()=>{
 let calls=0;const manager=new RenderKeys({serviceId:'srv-test123',token:'test-secret',request:async()=>({ok:++calls===1,status:403})});
 await assert.rejects(manager.update({guestyClientId:'private-id',guestyClientSecret:'private-secret'}),error=>{assert.match(error.message,/Saved GUESTY_CLIENT_ID/);assert(!error.message.includes('private-'));return true;});assert.equal(calls,2);
});
test('hosted key update is authenticated and never persists credentials in app backup or local files',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ocean-render-')),updates=[],hosting={host:'pricing.onrender.com',origin:'https://pricing.onrender.com',password:'test1234'},app=createApp({directory,hosting,renderKeys:{update:async body=>{updates.push(body);return {saved:['AIRROI_API_KEY'],deployStarted:true};}}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const auth='Basic '+Buffer.from('admin:'+hosting.password).toString('base64');
 const request=(route,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:app.server.address().port,path:route,method,headers:{Host:hosting.host,...headers}},res=>{let text='';res.on('data',data=>text+=data);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(typeof body==='string'?body:body?JSON.stringify(body):undefined);});
 try{assert.equal((await request('/api/render-keys',{method:'POST',body:{airroiKey:'fake-test-value'}})).status,401);const login=await request('/login',{method:'POST',headers:{Origin:hosting.origin},body:new URLSearchParams({username:'admin',password:hosting.password}).toString()}),cookie=login.headers['set-cookie'][0].split(';')[0],page=await request('/',{headers:{Cookie:cookie}}),headers={Cookie:cookie+'; '+page.headers['set-cookie'][0].split(';')[0],'X-Ocean-Request':'1'};
 const result=await request('/api/render-keys',{method:'POST',headers,body:{airroiKey:'fake-test-value'}});assert.equal(result.status,200);assert.equal(updates.length,1);assert(!result.text.includes('fake-test-value'));assert(!JSON.stringify(app.store.backup()).includes('fake-test-value'));assert(!fs.existsSync(path.join(directory,'data.json')));
 }finally{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
});
