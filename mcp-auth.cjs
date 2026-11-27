const crypto=require('node:crypto');
const {InvalidGrantError,InvalidTokenError,InvalidScopeError,InvalidRequestError}=require('@modelcontextprotocol/sdk/server/auth/errors.js');
const random=()=>crypto.randomBytes(32).toString('base64url');
const hash=value=>crypto.createHash('sha256').update(value).digest('base64url');
class ConnectorAuth{
 constructor(origin,password){this.origin=origin;this.password=password;this.clients=new Map();this.codes=new Map();this.tokens=new Map();this.refresh=new Map();this.pending=new Map();
  this.clientsStore={getClient:async id=>this.clients.get(id),registerClient:async info=>{
   if(this.clients.size>=500)throw new InvalidRequestError('Client limit reached.');
   const client={...info,client_id:random(),client_id_issued_at:Math.floor(Date.now()/1000)};this.clients.set(client.client_id,client);return client;
  }};
 }
 prune(){const now=Date.now();for(const map of [this.codes,this.tokens,this.refresh,this.pending])for(const [key,value]of map)if(value.expires<now)map.delete(key);}
 async authorize(client,params,res){
  this.prune();
  if(params.resource&&params.resource.href!==this.origin+'/mcp')throw new InvalidRequestError('Invalid resource.');
  const scopes=params.scopes?.length?params.scopes:['guesty:read'];
  if(scopes.some(s=>!['guesty:read','guesty:write'].includes(s)))throw new InvalidScopeError('Unsupported scope.');
  if(this.pending.size>=100)throw new InvalidRequestError('Too many pending connections.');
  const ticket=random(),nonce=random();this.pending.set(ticket,{client,params:{...params,scopes},nonce:hash(nonce),expires:Date.now()+600000});
  res.cookie('mcpConsent',nonce,{httpOnly:true,secure:this.origin.startsWith('https:'),sameSite:'lax',path:'/connect',maxAge:600000});
  res.set('Cache-Control','no-store').set('Content-Security-Policy',"default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Ocean Vacations</title><link rel="stylesheet" href="/style.css"></head><body class="login-page"><main class="login-card"><h1>Connect Ocean Vacations</h1><p>Allow access to Guesty property rates and guest conversations.'+(scopes.includes('guesty:write')?' This connection can also change rates and send replies when instructed.':' This connection is read-only.')+'</p><form method="post" action="/connect/approve"><input type="hidden" name="ticket" value="'+ticket+'"><label for="password">Ocean Pricing dashboard password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Connect</button></form></main></body></html>');
 }
 approve(req,res){
  this.prune();const entry=this.pending.get(req.body.ticket);
  const nonce=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('mcpConsent='))?.slice(11);
  if(req.headers.origin!==this.origin||!entry||!nonce||hash(nonce)!==entry.nonce)return res.status(400).send('Connection expired. Start again.');
  const supplied=Buffer.from('admin:'+String(req.body.password||'')).toString('base64');
  if(!require('./hosting.cjs').authorized('Basic '+supplied,this.password)){entry.failures=(entry.failures||0)+1;if(entry.failures>=5)this.pending.delete(req.body.ticket);return res.status(401).send('Incorrect dashboard password. Return and try again.');}
  this.pending.delete(req.body.ticket);const code=random();this.codes.set(code,{...entry,expires:Date.now()+60000});
  const target=new URL(entry.params.redirectUri);target.searchParams.set('code',code);if(entry.params.state)target.searchParams.set('state',entry.params.state);
  res.clearCookie('mcpConsent',{path:'/connect'});res.redirect(303,target.href);
 }
 getCode(client,code){this.prune();const value=this.codes.get(code);if(!value||value.client.client_id!==client.client_id)throw new InvalidGrantError('Invalid or expired code.');return value;}
 async challengeForAuthorizationCode(client,code){return this.getCode(client,code).params.codeChallenge;}
 issue(client,scopes){this.prune();const access=random(),refresh=random();const base={clientId:client.client_id,scopes,resource:this.origin+'/mcp'};
  this.tokens.set(hash(access),{...base,expires:Date.now()+3600000});this.refresh.set(hash(refresh),{...base,expires:Date.now()+7*86400000});
  return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope:scopes.join(' ')};
 }
 async exchangeAuthorizationCode(client,code,verifier,redirectUri,resource){const entry=this.getCode(client,code);
  if(!verifier||hash(verifier)!==entry.params.codeChallenge||redirectUri!==entry.params.redirectUri||(resource&&resource.href!==this.origin+'/mcp'))throw new InvalidGrantError('Authorization verification failed.');
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
