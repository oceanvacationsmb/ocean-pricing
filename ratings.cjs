const crypto=require('node:crypto');
const {channelLinks,fail}=require('./providers.cjs');
function titleRating(title){const value=Number(String(title||'').match(/★\s*(\d(?:\.\d+)?)/)?.[1]);return value>0&&value<=5?value:null;}
class RatingUpdate{
 constructor(store,providers,titleReader,{delayMs=2200}={}){this.store=store;this.providers=providers;this.titleReader=titleReader;this.delayMs=delayMs;this.job=null;}
 start(){if(this.job?.status==='running')return this.job;this.job={id:crypto.randomUUID(),status:'running',phase:'Guesty links',processed:0,total:0,saved:0,reused:0,errors:[]};this.run(this.job).catch(e=>{this.job.status='stopped';this.job.errors.push(e.message);});return this.job;}
 async run(job){const store=this.store,properties=store.data.properties.filter(p=>!store.data.includedPropertyIds||store.data.includedPropertyIds.includes(p.id));
 try{const listings=await this.providers.listings();for(const p of properties){const fresh=listings.find(x=>x.id===p.id);if(!fresh)continue;p.channelLinks={...p.channelLinks,...fresh.channelLinks};if(fresh.airbnbListingId)p.airbnbListingId=fresh.airbnbListingId;}store.save();await store.flush();}catch(e){job.errors.push('Guesty links: '+e.message);}
 const ids=new Set();for(const p of properties){const own=store.data.propertyLinks?.[p.id]?.airbnbListingId||p.airbnbListingId;if(own)ids.add(own);else job.errors.push(p.name+': no Airbnb link returned by Guesty.');for(const id of store.assignment(p.id))ids.add(id);}
 job.total=ids.size;job.phase='Airbnb ratings';store.data.listingRatings||={};let requested=false;
 for(const id of ids){const comp=store.data.comps[id],cached=store.data.listingRatings[id],title=comp?.listingTitle||comp?.name,existing=titleRating(title),paid=store.data.snapshots[id+':details'];
 if(cached?.rating||cached?.isNew||existing||paid?.rating){if(!cached&&existing){store.data.listingRatings[id]={rating:existing,title,source:'saved Airbnb title',fetchedAt:null};store.save();await store.flush();}job.reused++;job.processed++;continue;}
 if(requested)await new Promise(resolve=>setTimeout(resolve,this.delayMs));requested=true;
 try{const title=await this.titleReader(id),rating=titleRating(title),isNew=/★\s*New\b/i.test(title);if(!rating&&!isNew){job.errors.push('Airbnb did not include a rating for listing '+id+'.');job.processed++;continue;}
 store.data.listingRatings[id]={rating,isNew,title,source:'Airbnb title',fetchedAt:new Date().toISOString()};if(comp)comp.listingTitle=title;store.save();await store.flush();job.saved++;job.processed++;
 }catch(e){job.errors.push('Airbnb lookup stopped: '+e.message);job.status='stopped';job.phase='Saved results kept';return;}}
 store.save();await store.flush();job.status='complete';job.phase='Finished';}
}
module.exports={RatingUpdate,titleRating};
