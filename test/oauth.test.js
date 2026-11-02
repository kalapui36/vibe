import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oauthFixture } from './helpers/oauth-fixture.js';
import { EncryptedCookies } from '../lib/oauth-session.js';

const input={name:'학급 자료',url:'https://example.com/',category:'class',description:'자료를 확인합니다.',primary_label:'학생용',links:[{label:'교사용 설정',url:'https://example.com/teacher'}]};
test('OAuth 소유자 인증, PKCE, 암호화 쿠키와 첫 연결',async()=>{
  const f=await oauthFixture({secure:true});
  try{
    const start=await f.startLogin();
    assert.equal(start.url.origin,'https://github.com');assert.equal(start.url.searchParams.get('code_challenge_method'),'S256');assert.equal(start.url.searchParams.get('scope'),'repo');
    assert.match(start.response.headers.getSetCookie()[0],/HttpOnly/);assert.match(start.response.headers.getSetCookie()[0],/Secure/);assert.match(start.response.headers.getSetCookie()[0],/SameSite=Lax/);
    assert.equal(start.response.headers.getSetCookie()[0].includes('test-client-secret'),false);
    const result=await f.callback(start);
    assert.equal(result.response.status,302);assert.equal(result.response.headers.get('location'),'/admin');assert.ok(result.cookie);
    assert.equal(f.challenge(f.state.exchange[0].get('code_verifier')),start.url.searchParams.get('code_challenge'));
    assert.equal(f.state.publicConfig.auth_url,f.config.origin);
    assert.equal(result.cookie.includes('gho-test'),false);
    const session=await f.request('/api/session',{cookie:result.cookie});
    const data=await session.json();assert.equal(data.authenticated,true);assert.equal(data.user.login,'kalapui36');assert.equal(JSON.stringify(data).includes('gho-test'),false);
    const again=await f.request('/auth/login',{cookie:result.cookie});assert.equal(again.headers.get('location'),'/admin');
    const replay=await f.callback(start);assert.equal(replay.response.headers.get('location'),'/admin?auth_error=state');
  }finally{await f.close();}
});
test('다른 계정·권한 없는 계정·위조 또는 만료된 상태는 거부한다',async()=>{
  const f=await oauthFixture();
  try{
    const outsider=await f.login('outsider');assert.equal(outsider.response.headers.get('location'),'/admin?auth_error=account');assert.equal(outsider.cookie,undefined);
    assert.equal(f.state.calls.some(call=>call.method==='PUT'),false);
    f.state.permission=false;
    const noPermission=await f.login();assert.equal(noPermission.response.headers.get('location'),'/admin?auth_error=account');assert.equal(noPermission.cookie,undefined);
    f.state.permission=true;
    const start=await f.startLogin(),exchanges=f.state.exchange.length;
    const bad=await f.callback(start,'owner',{state:'forged-state'});assert.equal(bad.response.headers.get('location'),'/admin?auth_error=state');assert.equal(f.state.exchange.length,exchanges);
    const cipher=new EncryptedCookies(f.config.sessionSecret,false);
    const staleCookie=`vibe_oauth=${cipher.seal({state:'expired',verifier:'old',expires:Date.now()-1000},'oauth')}`;
    const stale=await f.callback(start,'owner',{cookie:staleCookie,state:'expired'});assert.equal(stale.response.headers.get('location'),'/admin?auth_error=state');
    const noSession=await f.request('/api/admin/apps');assert.equal(noSession.status,401);
    const tampered=await f.request('/api/admin/apps',{cookie:'vibe_session=v1.forged.value.tag'});assert.equal(tampered.status,401);
  }finally{await f.close();}
});
test('소유자 권한을 매 요청 확인하고 목록·이미지·순서 변경을 저장한다',async()=>{
  const f=await oauthFixture();
  try{
    const {cookie}=await f.login();
    let response=await f.request('/api/admin/apps',{cookie}),revision=response.headers.get('x-catalog-revision');assert.deepEqual(await response.json(),[]);
    response=await f.request('/api/admin/apps',{cookie,method:'POST',body:input,revision});assert.equal(response.status,201);const first=await response.json();revision=response.headers.get('x-catalog-revision');
    assert.deepEqual(first.links,input.links);
    response=await f.request('/api/admin/apps',{cookie,method:'POST',body:{...input,name:'다른 자료',category:'work'},revision});const second=await response.json();revision=response.headers.get('x-catalog-revision');
    response=await f.request('/api/admin/order',{cookie,method:'PUT',body:{ids:[second.id,first.id]},revision});assert.equal(response.status,200);revision=response.headers.get('x-catalog-revision');
    response=await f.request(`/api/admin/apps/${first.id}`,{cookie,method:'PUT',body:{name:'바꾼 이름',visible:false},revision});assert.equal(response.status,200);revision=response.headers.get('x-catalog-revision');
    assert.equal(f.state.rows.find(row=>row.id===first.id).links.length,1);
    const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=';
    response=await f.request(`/api/admin/apps/${first.id}/thumbnail`,{cookie,method:'PUT',body:{image},revision});assert.equal(response.status,200);revision=response.headers.get('x-catalog-revision');assert.equal(f.state.uploads.length,1);
    const stale=await f.request(`/api/admin/apps/${first.id}`,{cookie,method:'DELETE',revision:'old'});assert.equal(stale.status,409);assert.equal(f.state.rows.length,2);
    assert.equal((await f.request(`/api/admin/apps/${first.id}`,{cookie,method:'DELETE'})).status,428);
    assert.equal((await f.request(`/api/admin/apps/${first.id}`,{cookie,method:'DELETE',revision,origin:'https://attacker.example'})).status,403);
    assert.equal((await f.request(`/api/admin/apps/${first.id}`,{cookie,method:'DELETE',revision,header:false})).status,403);
    f.state.userOverride='another-user';
    assert.equal((await f.request(`/api/admin/apps/${first.id}`,{cookie,method:'DELETE',revision})).status,403);assert.equal(f.state.rows.length,2);
    f.state.userOverride=null;
    f.state.permission=false;
    assert.equal((await f.request(`/api/admin/apps/${first.id}`,{cookie,method:'DELETE',revision})).status,403);assert.equal(f.state.rows.length,2);
    f.state.permission=true;
    assert.equal((await f.request(`/api/admin/apps/${first.id}`,{cookie,method:'DELETE',revision})).status,200);assert.equal(f.state.rows.length,1);
    assert.equal((await f.request('/api/login',{method:'POST',body:{password:'4021'}})).status,404);
    const exchanges=f.state.exchanges;
    assert.equal((await f.request('/api/session',{cookie})).status,200);assert.equal(f.state.exchanges,exchanges);
    assert.equal((await f.request('/api/logout',{cookie,method:'POST'})).status,200);
    assert.equal((await f.request('/api/admin/apps',{cookie})).status,401);
  }finally{await f.close();}
});
test('GitHub 장애에는 데이터를 수정하지 않고, 미설정 서버는 인증을 시작하지 않는다',async()=>{
  const f=await oauthFixture();
  try{
    const {cookie}=await f.login();f.state.apiDown=true;
    const response=await f.request('/api/admin/apps',{cookie});assert.equal(response.status,503);assert.deepEqual(f.state.rows,[]);
    f.state.apiDown=false;assert.equal((await f.request('/api/admin/apps',{cookie})).status,200);
  }finally{await f.close();}
  const pending=await oauthFixture({configured:false});
  try{assert.equal((await pending.request('/auth/login')).headers.get('location'),'/setup');const page=await pending.request('/setup');assert.equal(page.status,200);assert.equal((await page.text()).includes('test-session-secret'),false);assert.equal(pending.state.calls.length,0);}
  finally{await pending.close();}
});

test('GitHub 요청 한도는 권한 회수와 구분하고 로그인 상태를 보존한다',async()=>{
 const f=await oauthFixture();try{
  const {cookie}=await f.login();f.state.rateLimited=true;
  const response=await f.request('/api/admin/apps',{cookie});assert.equal(response.status,429);assert.equal(response.headers.getSetCookie().length,0);assert.equal((await response.json()).code,'rate_limited');
  f.state.rateLimited=false;assert.equal((await f.request('/api/admin/apps',{cookie})).status,200);
 }finally{await f.close();}
});

test('등록 응답 유실 재시도는 같은 ID를 복구하고 다른 내용으로 덮어쓰지 않는다',async()=>{
 const f=await oauthFixture();try{
  const {cookie}=await f.login();const list=await f.request('/api/admin/apps',{cookie});const revision=list.headers.get('x-catalog-revision');
  const body={...input,request_id:'11111111-1111-4111-8111-111111111111'};
  const first=await f.request('/api/admin/apps',{cookie,method:'POST',body,revision});assert.equal(first.status,201);
  const again=await f.request('/api/admin/apps',{cookie,method:'POST',body,revision});assert.equal(again.status,201);assert.equal((await again.json()).id,body.request_id);assert.equal(f.state.rows.length,1);
  const changed=await f.request('/api/admin/apps',{cookie,method:'POST',body:{...body,name:'다른 이름'},revision});assert.equal(changed.status,409);assert.equal(f.state.rows[0].name,input.name);
 }finally{await f.close();}
});
