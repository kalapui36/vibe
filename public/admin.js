import { api, escape, categories, thumbnail, bindImageErrors, isPages } from './shared.js';
if (isPages && location.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
  const secureUrl = new URL(location.href);
  secureUrl.protocol = 'https:';
  location.replace(secureUrl.href);
}
const main = document.querySelector('#admin-main'), editor = document.querySelector('#editor'), form = document.querySelector('#app-form');
let apps=[], editing=null, imageChange=undefined, selectedFile=null, dragging=null, busy=false, toastTimer, polling;
function toast(message) { const el=document.querySelector('#toast'); el.textContent=message; el.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.hidden=true,4500); }
function errorMessage(error) { if(error.status===401) { editor.close(); clearInterval(polling); showLogin(true); } return error.message; }
function showLogin(configured) {
  const credentialField = isPages ? `<label class="field">GitHub 토큰<input name="token" type="password" autocomplete="off" spellcheck="false" required placeholder="발급한 토큰을 붙여넣으세요"></label><p class="field-hint">토큰은 이 탭에서만 사용하며 저장하지 않습니다. 새로고침하면 다시 입력해 주세요.</p><details class="token-guide"><summary>처음이라면 · 토큰 발급 방법</summary><ol><li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub 토큰 발급 페이지 ↗</a>를 엽니다.</li><li><b>Token name</b>은 알아볼 수 있는 이름을 쓰고, <b>Expiration</b>에서 만료일을 정합니다.</li><li><b>Resource owner</b>에서 <b>kalapui36</b>을 선택합니다.</li><li><b>Repository access</b> → <b>Only select repositories</b> → <b>vibe</b>를 선택합니다.</li><li><b>Repository permissions</b> → <b>Contents</b>를 <b>Read and write</b>로 설정합니다. Metadata는 자동으로 포함됩니다.</li><li><b>Generate token</b>을 누르고, 나온 토큰을 복사해 위 입력칸에 붙여넣은 뒤 로그인합니다.</li></ol><p>토큰은 발급 직후에만 보입니다. 코드에 넣거나 채팅에 보내지 마세요.</p></details>` : '<label class="field">비밀번호<input name="password" type="password" autocomplete="current-password" required placeholder="관리자 비밀번호"></label>';
  main.className='login-main';
  main.innerHTML=`<section class="login-panel"><span class="eyebrow muted">MASTER ADMIN</span><h1>관리자 로그인</h1><p>웹앱과 공개 목록을 관리합니다.</p>${configured ? '<form id="login-form">'+credentialField+'<p id="login-error" class="form-error" role="alert"></p><button class="button primary" type="submit">로그인 <span>→</span></button></form>' : '<div class="setup-notice"><b>관리자 비밀번호 설정이 필요합니다.</b><p>서버 터미널에서 아래 명령을 실행해 주세요.</p><code>npm run admin:password</code><p>설정이 끝나면 페이지를 새로고침하세요.</p></div>'}<a class="back-link" href="${isPages?'../':'/'}">← 공개 페이지로 돌아가기</a></section>`;
  document.querySelector('#login-form')?.addEventListener('submit',async event=>{
    event.preventDefault(); const button=event.target.querySelector('button'); button.disabled=true;
    try { await api('/api/login',{ method:'POST',body:isPages?{token:event.target.elements.token.value}:{password:event.target.elements.password.value} }); await startDashboard(); }
    catch(error) { document.querySelector('#login-error').textContent=error.message; }
    finally { button.disabled=false; }
  });
}
async function refresh() { apps=await api('/api/admin/apps'); renderDashboard(); }
async function startDashboard() {
  main.className='admin-main';
  await refresh();
  clearInterval(polling);
  polling=setInterval(async()=>{ if(!document.hidden && !editor.open && !dragging && !busy && !document.querySelector('#delete-dialog').open && apps.some(app=>app.capture_status==='pending')) { try { await refresh(); } catch(error) { errorMessage(error); } } },isPages?15000:4000);
}
function renderDashboard() {
  main.innerHTML=`<div class="dashboard-heading"><div><span class="eyebrow muted">DASHBOARD</span><h1>웹앱 관리</h1><p>웹앱을 등록하고 공개 목록을 관리하세요.</p></div><div class="dashboard-actions"><button class="text-button" id="logout">로그아웃</button><button class="button primary" id="add-app">＋ 웹앱 추가</button></div></div><div class="stats"><div><span>전체 웹앱</span><b>${apps.length}<small>개</small></b></div><div><span>공개 중</span><b>${apps.filter(a=>a.visible).length}<small>개</small></b></div><div><span>숨김</span><b>${apps.filter(a=>!a.visible).length}<small>개</small></b></div></div><div class="admin-list-heading"><h2>등록된 웹앱 <span class="total-count">${apps.length}</span></h2><span>드래그 또는 화살표로 순서를 변경하세요.</span></div><div id="admin-list">${apps.length ? apps.map((app,index)=>`<article class="admin-row" draggable="true" data-id="${app.id}"><div class="order-controls"><span class="drag-handle" aria-hidden="true">⠿</span><button data-action="up" aria-label="${escape(app.name)} 위로 이동" ${index===0?'disabled':''}>↑</button><button data-action="down" aria-label="${escape(app.name)} 아래로 이동" ${index===apps.length-1?'disabled':''}>↓</button></div><div class="admin-thumb">${thumbnail(app)}</div><div class="admin-row-info"><span class="category-label ${app.category}"><i></i>${categories[app.category]}</span><h3>${escape(app.name)} <span class="status-pill ${app.visible?'published':''}">${app.visible?'공개':'숨김'}</span></h3><a href="${escape(app.url)}" target="_blank" rel="noopener noreferrer">${escape(app.url)} ↗</a><span class="capture-status ${app.capture_status==='failed'?'failed':''}">${app.thumbnail ? '직접 지정한 썸네일' : app.capture_status==='ready' ? '자동 썸네일' : app.capture_status==='failed' ? '자동 캡처 실패 · 재시도하거나 이미지를 올려 주세요.' : '첫 화면 캡처 중…'}</span></div><div class="row-actions"><button class="button compact secondary" data-action="capture" ${app.capture_status==='pending'?'disabled':''}>다시 캡처</button><button class="button compact secondary" data-action="edit">수정</button><button class="icon-button delete-button" data-action="delete" aria-label="${escape(app.name)} 삭제"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg></button></div></article>`).join('') : '<div class="empty-state"><div class="empty-icon">＋</div><h3>첫 웹앱을 등록해 보세요.</h3><p>주소를 입력하면 첫 화면을 썸네일로 가져옵니다.</p><button class="button secondary" id="first-app">웹앱 추가</button></div>'}</div>`;
  bindImageErrors(main);
  document.querySelector('#add-app').onclick=()=>openEditor();
  document.querySelector('#first-app')?.addEventListener('click',()=>openEditor());
  document.querySelector('#logout').onclick=async()=>{ try { await api('/api/logout',{method:'POST'}); clearInterval(polling); showLogin(true); } catch(error) {toast(errorMessage(error));} };
  main.querySelectorAll('.admin-row').forEach(row=>{
    row.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>rowAction(row.dataset.id,button.dataset.action)));
    row.addEventListener('dragstart',event=>{ if(event.target.closest('button,a')) {event.preventDefault();return;} dragging=row.dataset.id; event.dataTransfer.setData('text/plain',dragging); row.classList.add('dragging'); });
    row.addEventListener('dragend',()=>{dragging=null;row.classList.remove('dragging');main.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));});
    row.addEventListener('dragover',event=>{event.preventDefault();row.classList.add('drop-target');});
    row.addEventListener('dragleave',()=>row.classList.remove('drop-target'));
    row.addEventListener('drop',async event=>{event.preventDefault();const id=dragging;dragging=null;if(id&&id!==row.dataset.id) await move(id,apps.findIndex(app=>app.id===row.dataset.id));});
  });
}
async function move(id,index) {
  const next=[...apps],old=next.findIndex(app=>app.id===id);
  if(old<0||index<0||index>=next.length)return;
  next.splice(index,0,next.splice(old,1)[0]);busy=true;
  try { await api('/api/admin/order',{method:'PUT',body:{ids:next.map(app=>app.id)}});apps=next;renderDashboard();toast('순서를 저장했습니다.'); }
  catch(error) {toast(errorMessage(error));}
  finally {busy=false;}
}
async function rowAction(id,action) {
  const app=apps.find(a=>a.id===id),index=apps.indexOf(app);
  if(action==='edit') return openEditor(app);
  if(action==='up'||action==='down') return move(id,index+(action==='up'?-1:1));
  if(action==='delete') {
    const dialog=document.querySelector('#delete-dialog');document.querySelector('#delete-message').textContent=app.name;
    dialog.returnValue='';dialog.showModal();
    dialog.addEventListener('close',async()=>{if(dialog.returnValue==='delete') {try {await api(`/api/admin/apps/${id}`,{method:'DELETE'});await refresh();toast('삭제했습니다.');}catch(error){toast(errorMessage(error));}}},{once:true});
  }
  if(action==='capture') { try {await api(`/api/admin/apps/${id}/capture`,{method:'POST'});await refresh();toast('첫 화면을 다시 캡처합니다.');}catch(error){toast(errorMessage(error));} }
}
function openEditor(app=null) {
  editing=app;imageChange=undefined;selectedFile=null;form.reset();
  document.querySelector('#editor-title').textContent=app?'웹앱 수정':'웹앱 추가';
  form.elements.name.value=app?.name||'';form.elements.url.value=app?.url||'';form.elements.description.value=app?.description||'';form.elements.category.value=app?.category||'class';form.elements.visible.checked=app?.visible??true;
  document.querySelector('#editor-error').textContent='';document.querySelector('#save-app').disabled=false;preview();editor.showModal();
}
function preview() {
  const source=imageChange===null?editing?.capture:imageChange||editing?.image;
  document.querySelector('#image-preview').innerHTML=source?`<img src="${escape(source)}" alt="썸네일 미리보기">`:'<div class="preview-placeholder">웹앱 첫 화면을 자동으로 가져옵니다.</div>';
}
document.querySelector('#thumbnail-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  if(file.size>4*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type)){document.querySelector('#editor-error').textContent='JPG, PNG, WebP 파일을 4MB 이하로 올려 주세요.';event.target.value='';return;}
  const reader=new FileReader();reader.onload=()=>{imageChange=reader.result;selectedFile=file;preview();};reader.readAsDataURL(file);
});
document.querySelector('#reset-thumbnail').onclick=()=>{imageChange=null;selectedFile=null;document.querySelector('#thumbnail-file').value='';preview();};
for(const id of ['close-editor','cancel-editor']) document.querySelector(`#${id}`).onclick=()=>{if(!busy)editor.close();};
editor.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;document.querySelector('#save-app').disabled=true;document.querySelector('#editor-error').textContent='';
  try {
    const payload={name:form.elements.name.value,url:form.elements.url.value,description:form.elements.description.value,category:form.elements.category.value,visible:form.elements.visible.checked};
    let id=editing?.id;
    if(id) await api(`/api/admin/apps/${id}`,{method:'PUT',body:payload});
    else {const created=await api('/api/admin/apps',{method:'POST',body:payload});id=created.id;editing=created;}
    if(imageChange!==undefined) await api(`/api/admin/apps/${id}/thumbnail`,{method:'PUT',body:{image:imageChange}});
    editor.close();await refresh();toast(isPages?'저장했습니다. 공개 페이지에 반영되기까지 잠시 걸릴 수 있습니다.':'저장했습니다.');
  }catch(error){document.querySelector('#editor-error').textContent=errorMessage(error);}
  finally{busy=false;document.querySelector('#save-app').disabled=false;}
});
try {const session=await api('/api/session');if(session.authenticated)await startDashboard();else showLogin(session.configured);}catch(error){main.innerHTML=`<div class="empty-state"><h2>서버에 연결하지 못했습니다.</h2><p>${escape(error.message)}</p></div>`;}
