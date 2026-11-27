const {test}=require('node:test'),assert=require('node:assert/strict');
const {createAgentApi,snapshot}=require('../agent-api.cjs');
test('lock observations preserve unknown connectivity and exclude access codes',()=>{
 const result=snapshot({capturedAt:new Date().toISOString(),locks:[{listingId:'one',online:null,batteryPercent:0,code:'secret'}]},[{id:'one',name:'2131'}]);
 assert.equal(result.locks[0].online,null);assert.equal(result.locks[0].batteryStatus,'critical');assert.equal(result.locks[0].code,undefined);
 assert.throws(()=>snapshot({capturedAt:new Date().toISOString(),locks:[{listingId:'unknown',online:true}]},[]));
});
test('agent routes separate read and write credentials and restrict rate payloads',async()=>{
 const calls=[];const store={data:{properties:[{id:'one',name:'2131'}]},save(){},async flush(){}};
 const api=createAgentApi({store,providers:{},priceWriter:async(...args)=>{calls.push(args);},env:{DOT_READ_KEY:'reader',DOT_WRITE_KEY:'writer'}});
 async function request(method,path,key,input){const req={method,headers:{authorization:'Bearer '+key},async *[Symbol.asyncIterator](){yield JSON.stringify(input||{});}};const res={setHeader(){},writeHead(status){this.status=status;},end(text){this.body=JSON.parse(text);}};await api(req,res,new URL('https://example.com'+path));return res;}
 const payload={confirm:true,listingId:'one',startDate:'2027-01-10',endDate:'2027-01-12',price:200,status:'available'};
 assert.equal((await request('PUT','/api/agent/prices','reader',payload)).status,401);
 assert.equal(calls.length,0);
 assert.equal((await request('PUT','/api/agent/prices','writer',payload)).status,200);
 assert.deepEqual(calls[0][1],{startDate:'2027-01-10',endDate:'2027-01-12',price:200});
 assert.equal((await request('PUT','/api/agent/prices','writer',{...payload,startDate:'2027-02-30'})).status,400);
 assert.equal((await request('GET','/api/locks-status','',{})).status,503);
});
