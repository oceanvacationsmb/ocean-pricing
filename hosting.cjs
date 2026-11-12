const crypto=require('node:crypto');
function hostingConfig(env){
 if(env.RENDER!=='true')return null;
 const origin=new URL(env.APP_ORIGIN||env.RENDER_EXTERNAL_URL||'');
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('APP_ORIGIN must be the HTTPS website origin.');
 if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<8)throw Error('Set ADMIN_PASSWORD to at least 8 characters.');
 if(!env.GITHUB_DATA_TOKEN&&(!env.DATA_DIR||!env.DATA_DIR.startsWith('/')))throw Error('Set GitHub data storage or DATA_DIR on a persistent disk.');
 if(env.GITHUB_DATA_TOKEN&&!env.GITHUB_DATA_REPO)throw Error('Set GITHUB_DATA_REPO for GitHub storage.');
 return {origin:origin.origin,host:origin.host,password:env.ADMIN_PASSWORD};
}
function authorized(header,password){
 const supplied=String(header||'');if(!supplied.startsWith('Basic '))return false;
 const expected=Buffer.from('admin:'+password).toString('base64');
 const digest=value=>crypto.createHash('sha256').update(value).digest();
 return crypto.timingSafeEqual(digest(supplied.slice(6)),digest(expected));
}
module.exports={hostingConfig,authorized};
