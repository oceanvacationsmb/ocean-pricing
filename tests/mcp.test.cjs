const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {ConnectorAuth}=require('../mcp-auth.cjs');
const {createMcpApp,createTools}=require('../mcp-server.cjs');
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
