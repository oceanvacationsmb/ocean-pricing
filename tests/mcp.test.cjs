const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {ConnectorAuth}=require('../mcp-auth.cjs');
const {createMcpApp,createTools}=require('../mcp-server.cjs');
test('browser sign-in survives two parallel connection attempts and completes token exchange',async t=>{
 const connector=createMcpApp({store:{data:{properties:[]},save(){},async flush(){}},providers:{},hosting:{origin:'http://127.0.0.1:8772',password:'test-password'}});
 const server=connector.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
 const registered=await fetch(base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['https://chatgpt.com/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
 assert.equal(registered.status,201);const client=await registered.json();
 const verifier='b'.repeat(50),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
 const query=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:'https://chatgpt.com/callback',code_challenge:challenge,code_challenge_method:'S256',scope:'guesty:read guesty:write',state:'test-state',resource:'http://127.0.0.1:8772/mcp'});
 const first=await fetch(base+'/authorize?'+query);assert.equal(first.status,200);const html=await first.text();
 assert.match(first.headers.get('content-security-policy'),/form-action 'self' https:\/\/chatgpt\.com;/);
 assert.doesNotMatch(first.headers.get('content-security-policy'),/form-action[^;]*\*/);
 const ticket=html.match(/name="ticket" value="([^"]+)"/)[1];assert.equal(first.headers.get('set-cookie'),null);
 const second=await fetch(base+'/authorize?'+query);assert.equal(second.status,200);
 // Simulate losing process-local registration and pending state during deployment.
 connector.auth.pending.clear();connector.auth.clients.clear();
 const crossSite=await fetch(base+'/connect/approve',{method:'POST',redirect:'manual',headers:{Origin:'https://another-site.example','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket,password:'test-password'})});assert.equal(crossSite.status,403);
 const approved=await fetch(base+'/connect/approve',{method:'POST',redirect:'manual',headers:{Origin:'http://127.0.0.1:8772','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket,password:'test-password'})});
 assert.equal(approved.status,303);const callback=new URL(approved.headers.get('location'));assert.equal(callback.searchParams.get('state'),'test-state');
 const duplicate=await fetch(base+'/connect/approve',{method:'POST',redirect:'manual',headers:{Origin:'http://127.0.0.1:8772','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket,password:'test-password'})});assert.equal(duplicate.status,303);assert.equal(duplicate.headers.get('location'),approved.headers.get('location'));
 const exchanged=await fetch(base+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,code:callback.searchParams.get('code'),code_verifier:verifier,redirect_uri:'https://chatgpt.com/callback',resource:'http://127.0.0.1:8772/mcp'})});
 const tokenBody=await exchanged.json();assert.equal(exchanged.status,200,JSON.stringify(tokenBody));assert.ok(tokenBody.access_token);
 const reused=await fetch(base+'/connect/approve',{method:'POST',redirect:'manual',headers:{Origin:'http://127.0.0.1:8772','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket,password:'test-password'})});assert.equal(reused.status,200);assert.equal(reused.headers.get('location'),null);assert.match(await reused.text(),/Return to ChatGPT/);
});
test('restart-safe consent tickets reject tampering and a different password',()=>{
 const auth=new ConnectorAuth('https://example.com','test-password'),entry={expires:Date.now()+60000,nonce:'test'};
 const ticket=auth.seal(entry);assert.deepEqual(auth.open(ticket),entry);
 assert.equal(auth.open('broken'+ticket),null);
 assert.equal(new ConnectorAuth('https://example.com','different-password').open(ticket),null);
 assert.equal(auth.open(auth.seal({...entry,expires:Date.now()-1000})),null);
});
test('public OAuth registration survives a new auth instance and rejects client secrets',async()=>{
 let saves=0,flushes=0;const store={data:{},save(){saves++;},async flush(){flushes++;}};
 const first=new ConnectorAuth('https://example.com','test-password',store);
 const client=await first.clientsStore.registerClient({redirect_uris:['https://chatgpt.com/callback'],token_endpoint_auth_method:'none',client_secret:'must-not-save'});
 const restarted=new ConnectorAuth('https://example.com','test-password',store);
 assert.equal((await restarted.clientsStore.getClient(client.client_id)).client_id,client.client_id);
 assert.equal(JSON.stringify(store.data).includes('must-not-save'),false);assert.equal(saves,1);assert.equal(flushes,1);
 await assert.rejects(first.clientsStore.registerClient({redirect_uris:['https://chatgpt.com/callback'],token_endpoint_auth_method:'client_secret_post'}));
});
test('OAuth binds codes to PKCE, client and redirect and rotates refresh tokens',async()=>{
 const auth=new ConnectorAuth('https://example.com','password');const client=await auth.clientsStore.registerClient({redirect_uris:['https://chatgpt.com/callback']});
 const verifier='a'.repeat(50),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
 auth.codes.set('code',{client,params:{redirectUri:client.redirect_uris[0],codeChallenge:challenge,scopes:['guesty:read']},expires:Date.now()+60000});
 await assert.rejects(auth.exchangeAuthorizationCode(client,'code','wrong',client.redirect_uris[0]));
 const token=await auth.exchangeAuthorizationCode(client,'code',verifier,client.redirect_uris[0]);
 await assert.rejects(auth.exchangeAuthorizationCode(client,'code',verifier,client.redirect_uris[0]));
 assert.deepEqual((await auth.verifyAccessToken(token.access_token)).scopes,['guesty:read']);
 await assert.rejects(auth.exchangeRefreshToken(client,token.refresh_token,['guesty:write']));
 await auth.exchangeRefreshToken(client,token.refresh_token);
 await assert.rejects(auth.exchangeRefreshToken(client,token.refresh_token));
});
test('MCP discovery, unauthorized challenge and authenticated tool listing work over HTTP',async t=>{
 const store={data:{properties:[]}};const connector=createMcpApp({store,providers:{}});
 const server=connector.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/.well-known/oauth-authorization-server')).status,200);
 const denied=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,401);assert.match(denied.headers.get('www-authenticate'),/resource_metadata/);
 const token=connector.auth.issue({client_id:'test'},['guesty:read']);
 const response=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.result.tools.length,6);
 const write=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'update_nightly_rate',arguments:{listingId:'one',date:'2026-12-20',expectedCurrentRate:201,newRate:200,confirm:true}}})});
 assert.equal((await write.json()).result.isError,true);
});
test('rate change checks current value, touches only one date and reads back',async()=>{
 const writes=[];let rate=201;const tools=createTools({store:{data:{properties:[{id:'one',name:'1463',currency:'USD'}]}},providers:{calendarRange:async()=>[{date:'2026-12-20',rate,available:true,locked:false}],guestyToken:async()=> 'fake',guestyRequest:async(url,options)=>{writes.push(JSON.parse(options.body));rate=200;return {ok:true};}}});
 const args={listingId:'one',date:'2026-12-20',expectedCurrentRate:201,newRate:200,confirm:true};
 assert.equal((await tools.update_nightly_rate.run(args)).verified,true);
 assert.deepEqual(writes,[{startDate:'2026-12-20',endDate:'2026-12-20',price:200}]);
 await assert.rejects(tools.update_nightly_rate.run(args),/Rate changed/);assert.equal(writes.length,1);
});
