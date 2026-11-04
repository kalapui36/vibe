import {test} from 'node:test';
import assert from 'node:assert/strict';
import {oauthFixture} from './helpers/oauth-fixture.js';
import {MAX_HTML_BYTES} from '../public/html-file.js';
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><title>한글 앱</title><button id="count">0</button><script>count.onclick=()=>count.textContent=Number(count.textContent)+1;</script></html>';
const draft={request_id:'11111111-2222-4333-8444-555555555555',name:'업로드 앱',category:'class',description:'HTML 활동',visible:true,html:{filename:'활동.html',text:html}};
async function fixture(){const f=await oauthFixture();const {cookie}=await f.login();const request=(path,options={})=>f.request(path,{cookie,...options});return {...f,request};}
async function create(f,body=draft){return f.request('/api/admin/apps',{method:'POST',revision:f.state.revision,body});}
test('HTML 등록·호스팅·충돌·재시도 API',async t=>{
 await t.test('주소 없이 HTML 등록, UTF-8 보존, 목록에는 코드 대신 공개 주소 저장',async()=>{
  const f=await fixture();try{
   const response=await create(f);assert.equal(response.status,201);const app=await response.json();assert.equal(app.html_filename,'활동.html');assert.match(app.url,/^https:\/\/kalapui.com\/vibe\/content\/webapps\/[0-9a-f]+\/[0-9a-f]+\.html$/);
   assert.equal(Buffer.from(f.state.htmlFiles.get(app.html_path).content,'base64').toString('utf8'),html);assert.equal(app.capture_status,'pending');assert.equal('html' in f.state.rows[0],false);assert.equal('text' in f.state.rows[0],false);
   const list=await(await f.request('/api/admin/apps')).json();assert.equal(list[0].url,app.url);
   const second=await f.login();const fromOtherDevice=await fetch(f.base+'/api/admin/apps',{headers:{Cookie:second.cookie}});assert.equal(fromOtherDevice.status,200);assert.equal((await fromOtherDevice.json())[0].url,app.url);
  }finally{await f.close();}
 });
 await t.test('이름만 수정하면 HTML 유지, 교체하면 새 파일·주소로 변경하고 이전 파일 보존',async()=>{
  const f=await fixture();try{
   const app=await(await create(f)).json(),original=app.url;
   assert.equal((await f.request('/api/admin/apps/'+app.id,{method:'PUT',revision:f.state.revision,body:{name:'수정한 이름'}})).status,200);assert.equal(f.state.rows[0].html_path,app.html_path);
   f.state.rows[0].capture='content/thumbnails/old.jpg';f.state.rows[0].capture_status='ready';
   assert.equal((await f.request('/api/admin/apps/'+app.id,{method:'PUT',revision:f.state.revision,body:{html:{filename:'새활동.htm',text:html.replace('한글 앱','다음 활동')}}})).status,200);
   assert.notEqual(f.state.rows[0].url,original);assert.equal(f.state.htmlFiles.size,2);assert.equal(f.state.rows[0].capture,null);assert.equal(f.state.rows[0].capture_status,'pending');
   assert.equal((await f.request('/api/admin/apps/'+app.id,{method:'PUT',revision:f.state.revision,body:{url:'https://example.org/'}})).status,200);assert.equal(f.state.rows[0].html_path,null);
  }finally{await f.close();}
 });
 await t.test('등록 응답 유실 재시도는 같은 앱과 파일을 재사용',async()=>{
  const f=await fixture();try{
   const first=await(await create(f)).json();const response=await f.request('/api/admin/apps',{method:'POST',revision:'catalog-0',body:draft});assert.equal(response.status,201);assert.equal((await response.json()).id,first.id);assert.equal(f.state.rows.length,1);assert.equal(f.state.htmlFiles.size,1);
   const different=await create(f,{...draft,html:{filename:'활동.html',text:html+'<p>다른 내용</p>'}});assert.equal(different.status,409);assert.equal(f.state.htmlFiles.size,1);
  }finally{await f.close();}
 });
 await t.test('파일은 저장됐지만 응답이 끊긴 경우에도 재시도 가능',async()=>{
  const f=await fixture();try{
   f.state.lostHtmlResponse=true;assert.equal((await create(f)).status,503);assert.equal(f.state.rows.length,0);assert.equal(f.state.htmlFiles.size,1);
   assert.equal((await create(f)).status,201);assert.equal(f.state.htmlFiles.size,1);assert.equal(f.state.rows.length,1);
  }finally{await f.close();}
 });
 await t.test('1MB를 넘는 HTML도 GitHub가 본문을 생략한 응답에서 재사용·재저장 가능',async()=>{
  const f=await fixture();try{
   const upload={filename:'large.html',text:html+'<p>'+'a'.repeat(1100000)+'</p>'};
   const created=await create(f,{...draft,html:upload});assert.equal(created.status,201);const app=await created.json();
   const response=await f.request('/api/admin/apps/'+app.id,{method:'PUT',revision:f.state.revision,body:{name:'다시 저장한 큰 HTML',html:upload}});
   assert.equal(response.status,200);assert.equal(f.state.htmlFiles.size,1);assert.equal(f.state.rows[0].name,'다시 저장한 큰 HTML');
   f.state.htmlFiles.get(app.html_path).sha='0'.repeat(40);
   assert.equal((await f.request('/api/admin/apps/'+app.id,{method:'PUT',revision:f.state.revision,body:{html:upload}})).status,409,'Mismatched Git object must still be rejected');
  }finally{await f.close();}
 });
 await t.test('파일 저장 실패·잘못된 HTML·초과 용량은 목록에 추가하지 않음',async()=>{
  const f=await fixture();try{
   f.state.htmlFailure=true;assert.equal((await create(f)).status,503);assert.equal(f.state.rows.length,0);f.state.htmlFailure=false;
   for(const upload of [{filename:'../escape.html',text:html},{filename:'bad.exe',text:html},{filename:'empty.html',text:''},{filename:'binary.html',text:'<html>\0</html>'},{filename:'large.html',text:'<html>'+ 'a'.repeat(MAX_HTML_BYTES)+'</html>'}])assert.equal((await create(f,{...draft,html:upload})).status,400);
   assert.equal(f.state.rows.length,0);assert.equal(f.state.htmlFiles.size,0);
  }finally{await f.close();}
 });
 await t.test('다른 기기 수정과 충돌해도 공개 중인 HTML을 덮어쓰지 않음',async()=>{
  const f=await fixture();try{
   const app=await(await create(f)).json(),oldContent=f.state.htmlFiles.get(app.html_path).content;
   const update={html:{filename:'교체.html',text:html+'<p>교체</p>'}};
   assert.equal((await f.request('/api/admin/apps/'+app.id,{method:'PUT',revision:'stale',body:update})).status,409);assert.equal(f.state.htmlFiles.size,1);
   f.state.beforeCatalogWrite=()=>{f.state.revision='catalog-99';f.state.rows[0].name='다른 기기의 수정';};
   assert.equal((await f.request('/api/admin/apps/'+app.id,{method:'PUT',revision:f.state.revision,body:update})).status,409);
   assert.equal(f.state.rows[0].url,app.url);assert.equal(f.state.htmlFiles.get(app.html_path).content,oldContent);assert.equal(f.state.rows[0].name,'다른 기기의 수정');
  }finally{await f.close();}
 });
 await t.test('로그아웃·다른 계정은 HTML을 올릴 수 없음',async()=>{
  const f=await fixture();try{
   const outsider=await f.login('outsider');assert.equal(outsider.cookie,undefined);
   const without=await fetch(f.base+'/api/admin/apps',{method:'POST',headers:{Origin:f.base,'X-Vibe-Request':'1','Content-Type':'application/json'},body:JSON.stringify(draft)});assert.equal(without.status,401);
   f.state.userOverride='another-user';assert.equal((await create(f)).status,403);assert.equal(f.state.htmlFiles.size,0);
  }finally{await f.close();}
 });
});
