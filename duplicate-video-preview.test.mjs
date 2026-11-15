import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('./meta-worker.js',import.meta.url),'utf8');
function setup(responses){let calls=[];const c=vm.createContext({URL,AbortSignal,setTimeout,contentPreview:u=>u,fetch:async(url,options)=>{calls.push(String(url));return {ok:true,status:200,json:async()=>responses.shift()};}});vm.runInContext(code,c);c.env={META_SYSVAR:'a'.repeat(30),STORE:{find:async()=>({id:'1'})}};c.row={platform:'facebook',account_id:'1',post_id:'1_2',media_type:'VIDEO'};return {c,calls};}
test('Facebook video preview resolves playable source through attachment target',async()=>{
 const {c,calls}=setup([{access_token:'private'}, {full_picture:'https://a.fbcdn.net/poster.jpg',attachments:{data:[{media_type:'video',target:{id:'42'}}]}},{source:'https://a.fbcdn.net/video.mp4'}]);
 const result=await vm.runInContext('metaPreview(env,row)',c);assert.equal(result.kind,'video');assert.equal(result.url,'https://a.fbcdn.net/video.mp4');assert.equal(result.poster,'https://a.fbcdn.net/poster.jpg');assert.equal(result.poster_only,false);assert.equal(calls.length,3);
});
test('a poster is explicitly identified when no video source is available',async()=>{
 const {c}=setup([{access_token:'private'},{full_picture:'https://a.fbcdn.net/poster.jpg',attachments:{data:[{media_type:'video'}]}}]);
 const result=await vm.runInContext('metaPreview(env,row)',c);assert.equal(result.kind,'image');assert.equal(result.poster_only,true);
});
test('Instagram video resolution retains both the thumbnail and the playable source',async()=>{
 const {c,calls}=setup([{access_token:'private'},{media_type:'VIDEO',media_url:'https://a.cdninstagram.com/clip.mp4',thumbnail_url:'https://a.cdninstagram.com/still.jpg'}]);c.row.platform='instagram';
 const result=await vm.runInContext('metaPreview(env,row)',c);assert.equal(result.kind,'video');assert.equal(result.url,'https://a.cdninstagram.com/clip.mp4');assert.equal(result.poster,'https://a.cdninstagram.com/still.jpg');assert.equal(calls.length,2);
});
