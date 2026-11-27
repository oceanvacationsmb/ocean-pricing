const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeLocks,createLockReader}=require('../locks.cjs');
test('dashboard battery fractions convert to percentages',()=>{
 const rows=normalizeLocks({data:[{batteryLevel:0.94,online:true,listings:[{id:'one'}]}]});
 assert.equal(rows[0].batteryPercent,94);assert.equal(rows[0].batteryStatus,'good');
});
test('locks use device connectivity, never provider connectivity, and omit secrets',()=>{
 const rows=normalizeLocks({locks:[{id:'lock',batteryStatus:'Good',providerAccount:{status:'CONNECTED',webviewUrl:'secret'},listings:[{id:'one',nickname:'MB - 2131'}]}]});
 assert.equal(rows[0].online,null);assert.equal(rows[0].batteryPercent,null);assert.equal(rows[0].batteryStatus,'good');assert.equal(rows[0].providerAccount,undefined);
 assert.throws(()=>normalizeLocks({total:2,locks:[{listings:[{id:'one'}]}]}),/incomplete/);
});
test('lock request uses stored OAuth token and reports an authenticated rejection',async()=>{
 let calls=0;
 const read=createLockReader({guestyToken:async()=> 'test-token',guestyRequest:async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'app.guesty.com');assert.equal(options.headers.Authorization,'Bearer test-token');return {ok:false,status:403};}});
 await assert.rejects(read(),/HTTP 403/);await assert.rejects(read(),/HTTP 403/);assert.equal(calls,1);
});
