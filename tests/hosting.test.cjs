const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {hostingConfig,authorized}=require('../hosting.cjs'),{createApp}=require('../server.cjs');
test('Render requires HTTPS, password and persistent data directory',()=>{
 const env={RENDER:'true',RENDER_EXTERNAL_URL:'https://pricing.onrender.com',ADMIN_PASSWORD:'test-only-password',DATA_DIR:'/var/data/ocean-pricing'};
 assert.equal(hostingConfig(env).host,'pricing.onrender.com');assert.equal(hostingConfig({}),null);
 for(const override of [{ADMIN_PASSWORD:''},{DATA_DIR:''},{APP_ORIGIN:'http://pricing.onrender.com'}])assert.throws(()=>hostingConfig({...env,...override}));
 assert.equal(authorized('Basic '+Buffer.from('admin:test-only-password').toString('base64'),env.ADMIN_PASSWORD),true);
 assert.equal(authorized('Basic '+Buffer.from('admin:wrong').toString('base64'),env.ADMIN_PASSWORD),false);
});
test('hosted app protects assets and API, permits health checks and retains saved data',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ocean-hosting-')),hosting={host:'pricing.onrender.com',origin:'https://pricing.onrender.com',password:'test-only-password'},app=createApp({directory,hosting});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const request=(url,headers={})=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:app.server.address().port,path:url,headers:{Host:hosting.host,...headers}},res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));}).on('error',reject);});
 try{
  assert.equal((await request('/healthz')).status,200);assert.equal((await request('/')).status,401);assert.equal((await request('/api/backup')).status,401);
  const auth={Authorization:'Basic '+Buffer.from('admin:'+hosting.password).toString('base64')},page=await request('/',auth);assert.equal(page.status,200);assert.match(page.headers['set-cookie'][0],/Secure/);
  const headers={...auth,Cookie:page.headers['set-cookie'][0].split(';')[0],'X-Ocean-Request':'1'};
  assert.equal((await request('/api/state',headers)).status,200);assert.equal((await request('/api/state',{...headers,Origin:'https://evil.example'})).status,403);
  assert.equal((await request('/',{...auth,Host:'evil.example'})).status,403);
  app.store.data.propertyOrder=['saved-test'];app.store.save();assert.deepEqual(createApp({directory,hosting}).store.data.propertyOrder,['saved-test']);
 }finally{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
});
