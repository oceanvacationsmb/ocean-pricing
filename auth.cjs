const crypto=require('node:crypto');
class DashboardAuth{
 constructor(hosting){this.hosting=hosting;this.sessions=new Map();}
 token(req){return String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-oceanLogin='))?.slice('__Host-oceanLogin='.length);}
 valid(req){const token=this.token(req),expires=this.sessions.get(token);if(!expires||expires<Date.now()){this.sessions.delete(token);return false;}return true;}
 redirect(res,location){res.writeHead(303,{Location:location,'Cache-Control':'no-store'});res.end();}
 page(res,error=false){res.writeHead(error?401:200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'X-Frame-Options':'DENY'});res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Comp Set System v1.08</title><link rel="stylesheet" href="/style.css"></head><body class="login-page"><main class="login-card"><div class="brand">OCEAN VACATIONS</div><h1>Comp Set System v1.08</h1><p class="system-credit">by Tzahi Israel</p><p class="login-intro">Sign in to your dashboard.</p>'+(error?'<p class="login-error" role="alert">Username or password is incorrect.</p>':'')+'<form method="post" action="/login"><label for="username">Username</label><input id="username" name="username" value="admin" autocomplete="username" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button class="preview-btn" type="submit">Sign in</button></form></main></body></html>');}
 async handle(req,res,route){
  if(route==='/logout'){
   if(req.method!=='POST'||req.headers.origin!==this.hosting.origin){res.writeHead(403,{'Cache-Control':'no-store'});res.end('Request blocked.');return true;}
   this.sessions.delete(this.token(req));res.setHeader('Set-Cookie',['__Host-oceanLogin=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0','oceanPricing=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0']);this.redirect(res,'/login');return true;
  }
  if(route==='/login'){
   if(req.method==='GET'){if(this.valid(req))this.redirect(res,'/');else this.page(res);return true;}
   if(req.method!=='POST'||req.headers.origin!==this.hosting.origin){res.writeHead(403,{'Cache-Control':'no-store'});res.end('Request blocked.');return true;}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>10000){res.writeHead(413);res.end();return true;}}
   const values=new URLSearchParams(body),supplied=Buffer.from((values.get('username')||'')+':'+(values.get('password')||'')).toString('base64');
   if(!require('./hosting.cjs').authorized('Basic '+supplied,this.hosting.password)){await new Promise(resolve=>setTimeout(resolve,250));this.page(res,true);return true;}
   for(const [token,expiry]of this.sessions)if(expiry<Date.now())this.sessions.delete(token);
   const token=crypto.randomBytes(32).toString('hex');this.sessions.set(token,Date.now()+12*60*60*1000);res.setHeader('Set-Cookie','__Host-oceanLogin='+token+'; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200');this.redirect(res,'/');return true;
  }
  if(route==='/style.css'&&req.method==='GET')return false;
  if(!this.valid(req)){if(route.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Your session ended. Sign in again.'}));}else this.redirect(res,'/login');return true;}
  return false;
 }
}
module.exports={DashboardAuth};
