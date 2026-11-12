const {fail}=require('./providers.cjs');
function decode(value){return value.replace(/&(?:amp|quot|apos|lt|gt|#39|#x[0-9a-f]+|#\d+);/gi,entity=>{const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&#39;':"'",'&lt;':'<','&gt;':'>'};if(named[entity.toLowerCase()])return named[entity.toLowerCase()];const code=entity.toLowerCase().startsWith('&#x')?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';});}
function extractTitle(html){let title='';for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){const attrs={};for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs))attrs[match[1].toLowerCase()]=match[3];if((attrs.property||attrs.name||'').toLowerCase()==='og:title'){title=attrs.content||'';break;}}if(!title)title=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'';title=decode(title).replace(/\s+/g,' ').trim();if(!title||/captcha|access denied|just a moment|verify you are|^airbnb$/i.test(title))throw fail(502,'Airbnb did not provide a readable listing title. Enter a name manually; no paid lookup was made.');return title.slice(0,120);}
async function readAirbnbTitle(id,request=fetch){const response=await request('https://www.airbnb.com/rooms/'+id,{redirect:'manual',headers:{Accept:'text/html'},signal:AbortSignal.timeout(15000)});if(!response.ok)throw fail(502,'Airbnb did not allow the title request. Enter a name manually; no paid lookup was made.');let html='';for await(const chunk of response.body){html+=Buffer.from(chunk).toString('utf8');if(html.length>3000000)break;if(/<\/head>/i.test(html))break;}return extractTitle(html);}
function extractRating(html){
 const title=extractTitle(html),star=Number(title.match(/★\s*(\d(?:\.\d+)?)/)?.[1]);if(star>0&&star<=5)return {title,rating:star,isNew:false};
 let rating=null;const visit=value=>{if(!value||typeof value!=='object'||rating!==null)return;const aggregate=value.aggregateRating;if(aggregate&&typeof aggregate==='object'){const raw=aggregate.ratingValue,max=Number(aggregate.bestRating??5),n=raw!==null&&raw!==undefined&&raw!==''?Number(raw):NaN;if(max===5&&n>0&&n<=5)rating=n;}for(const v of Object.values(value))if(v&&typeof v==='object')visit(v);};
 for(const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{visit(JSON.parse(script[1]));}catch{}}
 if(rating===null){const text=decode(html.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' '),match=text.match(/Rated\s+(\d(?:\.\d+)?)\s+out of\s+5(?:\D|$)/i);const n=Number(match?.[1]);if(n>0&&n<=5)rating=n;}
 return {title,rating,isNew:rating===null&&/★\s*New\b/i.test(title)};
}
async function readAirbnbProfile(id,request=fetch){
 if(!/^\d{6,22}$/.test(String(id)))throw fail(400,'Invalid Airbnb listing ID.');
 const response=await request('https://www.airbnb.com/rooms/'+id,{redirect:'manual',headers:{Accept:'text/html'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw fail(502,'Airbnb did not allow the rating request ('+response.status+'). Saved ratings were kept.');
 let html='';for await(const chunk of response.body){html+=Buffer.from(chunk).toString('utf8');if(html.length>3000000)break;}
 return extractRating(html);
}
module.exports={extractTitle,readAirbnbTitle,extractRating,readAirbnbProfile};
