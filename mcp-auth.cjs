const crypto=require('node:crypto');
const {InvalidGrantError,InvalidTokenError,InvalidScopeError,InvalidRequestError}=require('@modelcontextprotocol/sdk/server/auth/errors.js');
const random=()=>crypto.randomBytes(32).toString('base64url');
const hash=value=>crypto.createHash('sha256').update(value).digest('base64url');
class ConnectorAuth{
 constructor(origin,password,store=null){this.origin=origin;this.password=password;this.store=store;this.clients=new Map();this.codes=new Map();this.tokens=new Map();this.refresh=new Map();this.pending=new Map();
  this.clientsStore={getClient:async id=>this.clients.get(id)||this.store?.data.mcpClients?.[id],registerClient:async info=>{
   if(Math.max(this.clients.size,Object.keys(this.store?.data.mcpClients||{}).length)>=500)throw new InvalidRequestError('Client limit reached.');
   if(info.token_endpoint_auth_method&&info.token_endpoint_auth_method!=='none')throw new InvalidRequestError('Use public OAuth client registration with PKCE (authentication method none).');
   const client={redirect_uris:info.redirect_uris,grant_types:info.grant_types,response_types:info.response_types,token_endpoint_auth_method:'none',client_name:info.client_name,scope:info.scope,client_id:random(),client_id_issued_at:Math.floor(Date.now()/1000)};
   if(this.store){this.store.data.mcpClients||={};this.store.data.mcpClients[client.client_id]=client;this.store.save();await this.store.flush();}
   this.clients.set(client.client_id,client);return client;
  }};
 }
 prune(){const now=Date.now();for(const map of [this.codes,this.tokens,this.refresh,this.pending])for(const [key,value]of map)if(value.expires<now)map.delete(key);}
 seal(entry){const iv=crypto.randomBytes(12),key=crypto.createHash('sha256').update('ocean-mcp-consent:'+this.password).digest();const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(entry),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
 open(ticket){try{if(typeof ticket!=='string'||ticket.length>16000)return null;const bytes=Buffer.from(ticket,'base64url'),key=crypto.createHash('sha256').update('ocean-mcp-consent:'+this.password).digest();const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));const entry=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));return entry.expires>Date.now()?entry:null;}catch{return null;}}
 async authorize(client,params,res){
  this.prune();
  if(params.resource&&params.resource.href!==this.origin+'/mcp')throw new InvalidRequestError('Invalid resource.');
  const scopes=params.scopes?.length?params.scopes:['guesty:read'];
  if(scopes.some(s=>!['guesty:read','guesty:write'].includes(s)))throw new InvalidScopeError('Unsupported scope.');
  if(this.pending.size>=100)throw new InvalidRequestError('Too many pending connections.');
  const nonce=random(),entry={client,params:{...params,scopes},nonce:hash(nonce),expires:Date.now()+600000};const ticket=this.seal(entry);this.pending.set(hash(ticket),entry);
  const callbackOrigin=new URL(params.redirectUri).origin;
  res.set('Cache-Control','no-store').set('Content-Security-Policy',"default-src 'none'; style-src 'self'; form-action 'self' "+callbackOrigin+"; base-uri 'none'; frame-ancestors 'none'");
  res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Ocean Vacations</title><link rel="stylesheet" href="/style.css"></head><body class="login-page"><main class="login-card"><h1>Connect Ocean Vacations</h1><p>Allow access to Guesty property rates and guest conversations.'+(scopes.includes('guesty:write')?' This connection can also change rates and send replies when instructed.':' This connection is read-only.')+'</p><form method="post" action="/connect/approve"><input type="hidden" name="ticket" value="'+ticket+'"><label for="password">Ocean Pricing dashboard password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Connect</button></form></main></body></html>');
 }
 approve(req,res){
  this.prune();const ticketKey=hash(String(req.body.ticket||''));const entry=this.pending.get(ticketKey)||this.open(req.body.ticket);
  if(req.headers.origin!==this.origin)return res.status(403).send('Sign-in was submitted from a different browser origin. Restart Connect and complete sign-in in the window it opens.');
  if(!entry)return res.status(400).send('This connection attempt expired or the service restarted. Close this window and click Connect again in ChatGPT.');
  // Every approval requires a same-origin POST, a sealed ticket and password re-entry.
  // Do not depend on cookies: embedded OAuth browsers may suppress them.
  const supplied=Buffer.from('admin:'+String(req.body.password||'')).toString('base64');
  if(!require('./hosting.cjs').authorized('Basic '+supplied,this.password)){entry.failures=(entry.failures||0)+1;this.pending.set(ticketKey,entry);if(entry.failures>=5)return res.status(429).send('Too many failed attempts. Start a new connection.');return res.status(401).send('Incorrect dashboard password. Return and try again.');}
  if(entry.failures>=5)return res.status(429).send('Too many failed attempts. Start a new connection.');
  if(entry.consumed){
   const existing=this.codes.get(entry.approvalCode);
   if(existing&&existing.expires>Date.now()){
    const callback=new URL(entry.params.redirectUri);callback.searchParams.set('code',entry.approvalCode);if(entry.params.state)callback.searchParams.set('state',entry.params.state);
    return res.redirect(303,callback.href);
   }
   return res.status(200).type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in submitted</title></head><body><h1>Sign-in already submitted</h1><p>Return to ChatGPT to check the connection. This form cannot create another sign-in.</p></body></html>');
  }
  this.clients.set(entry.client.client_id,entry.client);
  const code=random();entry.consumed=true;entry.approvalCode=code;this.pending.set(ticketKey,entry);this.codes.set(code,{...entry,expires:Date.now()+60000});
  const target=new URL(entry.params.redirectUri);target.searchParams.set('code',code);if(entry.params.state)target.searchParams.set('state',entry.params.state);
  res.redirect(303,target.href);
 }
 getCode(client,code){this.prune();const value=this.codes.get(code);if(!value||value.client.client_id!==client.client_id)throw new InvalidGrantError('Invalid or expired code.');return value;}
 async challengeForAuthorizationCode(client,code){return this.getCode(client,code).params.codeChallenge;}
 issue(client,scopes){this.prune();const access=random(),refresh=random();const base={clientId:client.client_id,scopes,resource:this.origin+'/mcp'};
  this.tokens.set(hash(access),{...base,expires:Date.now()+3600000});this.refresh.set(hash(refresh),{...base,expires:Date.now()+7*86400000});
  return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope:scopes.join(' ')};
 }
 async exchangeAuthorizationCode(client,code,verifier,redirectUri,resource){const entry=this.getCode(client,code);
  // The SDK validates PKCE before exchange and then omits the verifier.
  if((verifier!==undefined&&hash(verifier)!==entry.params.codeChallenge)||redirectUri!==entry.params.redirectUri||(resource&&resource.href!==this.origin+'/mcp'))throw new InvalidGrantError('Authorization verification failed.');
  this.codes.delete(code);return this.issue(client,entry.params.scopes);
 }
 async exchangeRefreshToken(client,token,scopes,resource){this.prune();const value=this.refresh.get(hash(token));
  if(!value||value.clientId!==client.client_id||(resource&&resource.href!==this.origin+'/mcp'))throw new InvalidGrantError('Reconnect Ocean Vacations.');
  const next=scopes||value.scopes;if(next.some(s=>!value.scopes.includes(s)))throw new InvalidScopeError('Scope escalation rejected.');
  this.refresh.delete(hash(token));return this.issue(client,next);
 }
 async verifyAccessToken(token){this.prune();const value=this.tokens.get(hash(token));if(!value)throw new InvalidTokenError('Reconnect Ocean Vacations.');return {token,clientId:value.clientId,scopes:value.scopes,expiresAt:Math.floor(value.expires/1000),resource:value.resource};}
 async revokeToken(client,request){for(const map of [this.tokens,this.refresh]){const key=hash(request.token);if(map.get(key)?.clientId===client.client_id)map.delete(key);}}
}
module.exports={ConnectorAuth};
