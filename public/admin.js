import { relatedLinks, primaryLabel } from './catalog.js';
import { fieldError, validationMessage, validateEditor, clearFieldErrors } from './editor-fields.js';
import { api, escape, categories, thumbnail, bindImageErrors, isPages, captureMessages } from './shared.js';
if (isPages && location.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
  const secureUrl = new URL(location.href);
  secureUrl.protocol = 'https:';
  location.replace(secureUrl.href);
}
const homeUrl = isPages ? new URL('../', import.meta.url).href : '/';
const main = document.querySelector('#admin-main'), editor = document.querySelector('#editor'), form = document.querySelector('#app-form');
let apps=[], editing=null, imageChange=undefined, selectedFile=null, dragging=null, busy=false, toastTimer, polling, draftId=null, imageLoading=false, imageInvalid=false, imageReadVersion=0, activeReader;
let baseline='';
function editorSnapshot(){
  return JSON.stringify({fields:[...form.querySelectorAll('input:not([type=file]),textarea')].map(input=>[input.name||input.className,input.type==='checkbox'?input.checked:input.type==='radio'?input.checked:input.value]),image:imageChange===undefined?'unchanged':imageChange===null?'auto':`${selectedFile?.name}:${selectedFile?.size}:${selectedFile?.lastModified}`,file:document.querySelector('#thumbnail-file').value});
}
function hasUnsavedChanges(){return editor.open&&baseline!==editorSnapshot();}
function requestClose(){if(!busy&&(!hasUnsavedChanges()||confirm('저장하지 않은 내용이 있습니다. 닫을까요?')))editor.close();}
function protectNavigation(event){if(hasUnsavedChanges()){event.preventDefault();event.returnValue='';}}
function syncNavigationProtection(){
  window.removeEventListener('beforeunload',protectNavigation);
  if(hasUnsavedChanges())window.addEventListener('beforeunload',protectNavigation);
}
for(const event of ['input','change','click'])form.addEventListener(event,syncNavigationProtection);
editor.addEventListener('close',syncNavigationProtection);
function syncSaveButton(){
  const save=document.querySelector('#save-app');save.disabled=busy||imageLoading||imageInvalid;
  save.textContent=busy?'저장 중…':imageLoading?'이미지 확인 중…':'저장';save.setAttribute('aria-busy',String(busy||imageLoading));
  document.querySelector('#image-read-status').textContent=imageLoading?'이미지를 불러오는 중입니다.':'';
  document.querySelector('#image-preview').setAttribute('aria-busy',String(imageLoading));
}
function imageError(message=''){
  const el=document.querySelector('#image-error');el.textContent=message;el.hidden=!message;
  const input=document.querySelector('#thumbnail-file');input.setAttribute('aria-describedby','image-error image-read-status');
  if(message)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');
}
function setBusy(value){
  busy=value;
  for(const control of document.querySelectorAll('#app-form input,#app-form textarea,#app-form button,#admin-main button')){
    if(value){control.dataset.busyDisabled=control.disabled?'1':'0';control.disabled=true;}
    else if(control.dataset.busyDisabled!==undefined){control.disabled=control.dataset.busyDisabled==='1';delete control.dataset.busyDisabled;}
  }
  syncSaveButton();
}
function cancelImageRead(){imageReadVersion++;activeReader?.abort?.();activeReader=null;imageLoading=false;imageInvalid=false;syncSaveButton();}
function toast(message) { const el=document.querySelector('#toast'); el.textContent=message; el.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.hidden=true,4500); }
let sessionInfo={authenticated:false,configured:true,mode:isPages?'oauth':'password'};
const oauthErrors={account:'이 GitHub 계정은 관리자로 허용되지 않습니다. kalapui36 계정으로 로그인해 주세요.',state:'로그인 확인이 만료되었습니다. GitHub 로그인을 다시 시작해 주세요.',cancelled:'GitHub 로그인이 취소되었습니다.',expired:'GitHub 인증이 만료되었습니다. 다시 로그인해 주세요.',provider:'GitHub 인증을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'};
function errorMessage(error) {
  if(error.status===401||(error.status===403&&error.code==='access_denied')) {
    editor.close();clearInterval(polling);sessionInfo=error.session||{...sessionInfo,authenticated:false};showLogin(sessionInfo,error.message);
  }
  return error.message;
}
function showLogin(session=sessionInfo,message='') {
  sessionInfo=session;
  main.className='login-main';
  if(session.mode==='oauth') {
    let destination='';
    if(session.login_url){
      const url=new URL(session.login_url,location.href);
      if(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))destination=url.href;
    }
    main.innerHTML=`<section class="login-panel oauth-panel"><span class="eyebrow muted">관리자</span><h1>GitHub로 로그인</h1><p>kalapui36 계정만 웹앱을 수정할 수 있습니다.</p>${session.configured&&destination?`<a class="button primary oauth-button" href="${escape(destination)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 19c-4 1-4-2-6-2m12 4v-3.8c0-1 .1-1.6-.5-2.2 3.2-.4 6.5-1.5 6.5-7a5.5 5.5 0 0 0-1.5-3.8c.2-1 .2-2-.1-3.2 0 0-1.2-.4-3.9 1.5a13 13 0 0 0-7 0C5.3.6 4.1 1 4.1 1c-.3 1.2-.3 2.2-.1 3.2A5.5 5.5 0 0 0 2.5 8c0 5.5 3.3 6.6 6.5 7-.6.6-.6 1.4-.5 2.2V21"/></svg>GitHub로 로그인<span aria-hidden="true">↗</span></a><p class="field-hint oauth-hint">처음에는 GitHub에서 권한 승인이 필요합니다.<br>다른 기기에서도 GitHub 계정으로 로그인할 수 있습니다.</p>`:`<div class="setup-notice"><b>GitHub 로그인 초기 연결이 필요합니다.</b><p>관리자 서버 배포와 GitHub 인증 앱 설정을 마치면 로그인 버튼이 활성화됩니다.</p>${session.setup_url?`<a class="button secondary" href="${escape(session.setup_url)}" target="_blank" rel="noopener noreferrer">초기 연결 설정 열기 ↗</a>`:''}</div>`}<p class="form-error" role="alert">${escape(message)}</p><a class="back-link" href="${homeUrl}">← 공개 페이지로 돌아가기</a></section>`;
    return;
  }
  const temporary=session.mode==='token';
  const field=temporary?'<label class="field">GitHub 토큰<input name="token" type="password" autocomplete="off" required placeholder="기존 토큰"></label>':'<label class="field">비밀번호<input name="password" type="password" autocomplete="current-password" required placeholder="관리자 비밀번호"></label>';
  main.innerHTML=`<section class="login-panel"><span class="eyebrow muted">관리자</span><h1>관리자 로그인</h1><p>웹앱과 공개 목록을 관리합니다.</p>${temporary?`<div class="setup-notice"><b>GitHub 로그인 초기 연결이 필요합니다.</b><p>연결 전까지 기존 토큰으로 관리할 수 있습니다. 연결 후에는 토큰 입력 없이 GitHub로 로그인합니다.</p><a href="${escape(session.setup_url)}" target="_blank" rel="noopener noreferrer">초기 연결 설정 열기 ↗</a></div>`:''}<form id="login-form">${field}<p id="login-error" class="form-error" role="alert">${escape(message)}</p><button class="button primary" type="submit">로그인 <span>→</span></button></form><a class="back-link" href="${homeUrl}">← 공개 페이지로 돌아가기</a></section>`;
  document.querySelector('#login-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
    try{await api('/api/login',{method:'POST',body:temporary?{token:event.target.elements.token.value}:{password:event.target.elements.password.value}});await startDashboard();}
    catch(error){const message=errorMessage(error),target=document.querySelector('#login-error');if(target)target.textContent=message;else toast(message);}
    finally{button.disabled=false;}
  });
}
async function refresh() { apps=await api('/api/admin/apps'); renderDashboard(); }
async function startDashboard() {
  main.className='admin-main';
  await refresh();
  clearInterval(polling);
  polling=setInterval(async()=>{ if(!document.hidden && !editor.open && !dragging && !busy && !document.querySelector('#delete-dialog').open && apps.some(app=>app.capture_status==='pending')) { try { await refresh(); } catch(error) { errorMessage(error); } } },isPages||sessionInfo.mode==='oauth'?15000:4000);
}
function renderDashboard() {
  main.innerHTML=`<div class="dashboard-heading"><div><span class="eyebrow muted">DASHBOARD</span><h1>웹앱 관리</h1><p>웹앱을 등록하고 공개 목록을 관리하세요.</p></div><div class="dashboard-actions"><button class="text-button" id="refresh-list">목록 새로고침</button><button class="text-button" id="logout">로그아웃</button><button class="button primary" id="add-app">＋ 웹앱 추가</button></div></div><div class="stats"><div><span>전체 웹앱</span><b>${apps.length}<small>개</small></b></div><div><span>공개 중</span><b>${apps.filter(a=>a.visible).length}<small>개</small></b></div><div><span>숨김</span><b>${apps.filter(a=>!a.visible).length}<small>개</small></b></div></div><div class="admin-list-heading"><h2>등록된 웹앱 <span class="total-count">${apps.length}</span></h2><span>드래그 또는 화살표로 순서를 변경하세요.</span></div><div id="admin-list">${apps.length ? apps.map((app,index)=>`<article class="admin-row" draggable="true" data-id="${app.id}"><div class="order-controls"><span class="drag-handle" aria-hidden="true">⠿</span><button data-action="up" aria-label="${escape(app.name)} 위로 이동" ${index===0?'disabled':''}>↑</button><button data-action="down" aria-label="${escape(app.name)} 아래로 이동" ${index===apps.length-1?'disabled':''}>↓</button></div><div class="admin-thumb">${thumbnail(app)}</div><div class="admin-row-info"><span class="category-label ${app.category}"><i></i>${categories[app.category]}</span><h3>${escape(app.name)} <span class="status-pill ${app.visible?'published':''}">${app.visible?'공개':'숨김'}</span></h3><a href="${escape(app.url)}" target="_blank" rel="noopener noreferrer">${escape(app.url)} ↗</a><span class="capture-status ${app.capture_status==='failed'?'failed':''}">${app.thumbnail ? '직접 지정한 썸네일' : app.capture_status==='ready' ? '자동 썸네일' : app.capture_status==='failed' ? escape(captureMessages[app.capture_error] || captureMessages.unknown) : '첫 화면 캡처 대기 중 · 오래 걸리면 다시 요청해 주세요.'}</span></div><div class="row-actions"><button class="button compact secondary" data-action="capture" >${app.capture_status==='pending'?'다시 요청':'다시 캡처'}</button><button class="button compact secondary" data-action="edit">수정</button><button class="icon-button delete-button" data-action="delete" aria-label="${escape(app.name)} 삭제"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg></button></div></article>`).join('') : '<div class="empty-state"><div class="empty-icon">＋</div><h3>첫 웹앱을 등록해 보세요.</h3><p>주소를 입력하면 첫 화면을 썸네일로 가져옵니다.</p><button class="button secondary" id="first-app">웹앱 추가</button></div>'}</div>`;
  bindImageErrors(main);
  if(sessionInfo.mode==='oauth'&&new URLSearchParams(location.search).get('connection')==='pending') {
    const notice=document.createElement('div');notice.className='setup-notice connection-notice';
    notice.innerHTML='<p>공개 페이지의 관리자 로그인 연결을 마무리해 주세요.</p><button class="button secondary" id="connect-site">공개 페이지에 연결</button>';
    main.prepend(notice);
    notice.querySelector('button').onclick=async()=>{try{await api('/api/admin/connect',{method:'POST'});const url=new URL(location.href);url.searchParams.delete('connection');history.replaceState(null,'',url);notice.remove();toast('공개 페이지에 연결했습니다. 배포 후 로그인 버튼을 이용할 수 있습니다.');}catch(error){toast(errorMessage(error));}};
  }
  document.querySelector('#add-app').onclick=()=>openEditor();
  document.querySelector('#first-app')?.addEventListener('click',()=>openEditor());
  document.querySelector('#refresh-list').onclick=async()=>{if(busy)return;setBusy(true);try{await refresh();toast('최신 목록을 불러왔습니다.');}catch(error){toast(errorMessage(error));}finally{setBusy(false);}};
  document.querySelector('#logout').onclick=async()=>{if(busy)return;try{await api('/api/logout',{method:'POST'});clearInterval(polling);showLogin({...sessionInfo,authenticated:false});}catch(error){if(error.loggedOut){clearInterval(polling);showLogin({...sessionInfo,authenticated:false});}toast(errorMessage(error));}};
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
  if(busy)return;
  const next=[...apps],old=next.findIndex(app=>app.id===id);
  if(old<0||index<0||index>=next.length)return;
  next.splice(index,0,next.splice(old,1)[0]);setBusy(true);
  try { await api('/api/admin/order',{method:'PUT',body:{ids:next.map(app=>app.id)}});apps=next;renderDashboard();toast('순서를 저장했습니다.'); }
  catch(error) {toast(errorMessage(error));}
  finally {setBusy(false);}
}
async function rowAction(id,action) {
  if(busy)return;
  const app=apps.find(a=>a.id===id),index=apps.indexOf(app);if(!app)return;
  if(action==='edit') return openEditor(app);
  if(action==='up'||action==='down') return move(id,index+(action==='up'?-1:1));
  if(action==='delete') {
    const dialog=document.querySelector('#delete-dialog');if(dialog.open)return;document.querySelector('#delete-message').textContent=app.name;
    dialog.returnValue='';dialog.showModal();
    dialog.addEventListener('close',async()=>{if(dialog.returnValue==='delete') {setBusy(true);try {await api(`/api/admin/apps/${id}`,{method:'DELETE'});await refresh();toast('삭제했습니다.');}catch(error){toast(errorMessage(error));}finally{setBusy(false);}}},{once:true});
  }
  if(action==='capture') {setBusy(true);try {await api(`/api/admin/apps/${id}/capture`,{method:'POST'});await refresh();toast('첫 화면을 다시 캡처합니다.');}catch(error){toast(errorMessage(error));}finally{setBusy(false);} }
}
function openEditor(app=null) {
  cancelImageRead();editing=app;draftId=app?.id||crypto.randomUUID();imageChange=undefined;selectedFile=null;form.reset();
  document.querySelector('#editor-title').textContent=app?'웹앱 수정':'웹앱 추가';
  form.elements.primary_label.value=app?.primary_label||'';document.querySelector('#related-links').replaceChildren();for(const link of app?.links||[])addLinkRow(link);updateLinkControls();
  form.elements.name.value=app?.name||'';form.elements.url.value=app?.url||'';form.elements.description.value=app?.description||'';form.elements.category.value=app?.category||'class';form.elements.visible.checked=app?.visible??true;
  clearFieldErrors(form);imageError();document.querySelector('#thumbnail-file').value='';
  document.querySelector('#editor-error').textContent='';document.querySelector('#reload-editor').hidden=true;syncSaveButton();preview();baseline=editorSnapshot();if(!editor.open)editor.showModal();
}
function preview() {
  const raw=imageChange===null?editing?.capture:imageChange||editing?.image;
  const source=raw&&isPages?new URL(raw,new URL('../',import.meta.url)).href:raw;
  document.querySelector('#image-preview').innerHTML=source?`<img src="${escape(source)}" alt="썸네일 미리보기">`:'<div class="preview-placeholder">웹앱 첫 화면을 자동으로 가져옵니다.</div>';
}
function updateLinkControls() {
  const rows=[...document.querySelectorAll('.related-row')];
  document.querySelector('#add-link').disabled=rows.length>=6;
  rows.forEach((row,index)=>{row.querySelector('.link-up').disabled=index===0;row.querySelector('.link-down').disabled=index===rows.length-1;});
}
function addLinkRow(link={}) {
  if(document.querySelectorAll('.related-row').length>=6)return;
  const row=document.createElement('div');row.className='related-row';
  row.innerHTML=`<div class="link-field"><input class="link-label" maxlength="40" required aria-label="관련 주소 이름" placeholder="교사용 설정" value="${escape(link.label||'')}"></div><div class="link-field"><input class="link-url" type="url" required aria-label="관련 웹 주소" placeholder="https://" value="${escape(link.url||'')}"></div><div class="link-actions"><button type="button" class="icon-button link-up" aria-label="관련 주소 위로 이동">↑</button><button type="button" class="icon-button link-down" aria-label="관련 주소 아래로 이동">↓</button><button type="button" class="icon-button remove-link" aria-label="관련 주소 삭제">×</button></div>`;
  row.querySelector('.remove-link').onclick=()=>{row.remove();updateLinkControls();};
  row.querySelector('.link-up').onclick=()=>{row.previousElementSibling?.before(row);updateLinkControls();};
  row.querySelector('.link-down').onclick=()=>{row.nextElementSibling?.after(row);updateLinkControls();};
  document.querySelector('#related-links').appendChild(row);updateLinkControls();
}
document.querySelector('#add-link').onclick=()=>{addLinkRow();document.querySelector('.related-row:last-child .link-label')?.focus();};
document.querySelector('#choose-thumbnail').onclick=()=>document.querySelector('#thumbnail-file').click();
document.querySelector('#thumbnail-file').addEventListener('change',event=>{
  cancelImageRead();imageError();const file=event.target.files[0];if(!file)return;
  if(file.size>4*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type)){imageInvalid=true;imageError('JPG, PNG, WebP 파일을 4MB 이하로 올려 주세요.');event.target.value='';syncSaveButton();return;}
  const version=imageReadVersion,reader=new FileReader();activeReader=reader;imageLoading=true;syncSaveButton();
  const failed=()=>{if(version!==imageReadVersion||!editor.open)return;imageLoading=false;imageInvalid=true;activeReader=null;imageError('이미지를 읽지 못했습니다. 파일을 다시 선택하거나 자동 썸네일을 사용해 주세요.');syncSaveButton();};
  reader.onerror=failed;
  reader.onload=async()=>{
    if(version!==imageReadVersion||!editor.open)return;
    try{const img=new Image();img.src=reader.result;await img.decode();}
    catch{failed();return;}
    if(version!==imageReadVersion||!editor.open)return;
    imageChange=reader.result;selectedFile=file;imageLoading=false;activeReader=null;document.querySelector('#editor-error').textContent='';syncSaveButton();preview();
  };
  reader.readAsDataURL(file);
});
document.querySelector('#reset-thumbnail').onclick=()=>{cancelImageRead();imageError();imageChange=null;selectedFile=null;document.querySelector('#thumbnail-file').value='';document.querySelector('#editor-error').textContent='';preview();};
editor.addEventListener('close',cancelImageRead);
document.querySelector('#reload-editor').onclick=async()=>{
  if(busy)return;
  const wasExisting=!!editing?.id,targetId=editing?.id||draftId;
  if(wasExisting&&!confirm('입력 중인 내용을 최신 저장 내용으로 바꿀까요?'))return;
  setBusy(true);
  try{
    await refresh();const latest=apps.find(app=>app.id===targetId);
    if(latest){editor.close();setBusy(false);openEditor(latest);}
    else if(wasExisting){editor.close();toast('이 웹앱은 다른 곳에서 삭제되었습니다. 최신 목록을 불러왔습니다.');}
    else{document.querySelector('#reload-editor').hidden=true;document.querySelector('#editor-error').textContent='최신 목록을 불러왔습니다. 입력한 내용은 유지했습니다. 다시 저장해 주세요.';}
  }catch(error){document.querySelector('#editor-error').textContent=errorMessage(error);}
  finally{setBusy(false);}
};
for(const id of ['close-editor','cancel-editor']) document.querySelector(`#${id}`).onclick=requestClose;
editor.addEventListener('cancel',event=>{event.preventDefault();requestClose();});
form.addEventListener('focusout',event=>{if(event.target.matches('input:not([type=radio]):not([type=checkbox]):not([type=file]),textarea'))fieldError(event.target,validationMessage(event.target));});
form.addEventListener('input',event=>{if(event.target.hasAttribute('aria-invalid'))fieldError(event.target,validationMessage(event.target));});
function resizeEditor(){
  const viewport=window.visualViewport;
  editor.style.setProperty('--editor-viewport-height',`${viewport?.height||innerHeight}px`);
  editor.style.setProperty('--editor-viewport-top',`${viewport?.offsetTop||0}px`);
}
window.visualViewport?.addEventListener('resize',resizeEditor);window.visualViewport?.addEventListener('scroll',resizeEditor);window.addEventListener('resize',resizeEditor);resizeEditor();
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||imageLoading||imageInvalid||!validateEditor(form))return;setBusy(true);document.querySelector('#editor-error').textContent='';
  try {
    const payload={name:form.elements.name.value,url:form.elements.url.value,description:form.elements.description.value,category:form.elements.category.value,visible:form.elements.visible.checked,primary_label:primaryLabel(form.elements.primary_label.value),links:relatedLinks([...document.querySelectorAll('.related-row')].map(row=>({label:row.querySelector('.link-label').value,url:row.querySelector('.link-url').value})))};
    let id=editing?.id;
    if(id) await api(`/api/admin/apps/${id}`,{method:'PUT',body:payload});
    else {const created=await api('/api/admin/apps',{method:'POST',body:{...payload,request_id:draftId}});id=created.id;editing=created;}
    if(imageChange!==undefined) await api(`/api/admin/apps/${id}/thumbnail`,{method:'PUT',body:{image:imageChange}});
    editor.close();await refresh();toast(isPages?'저장했습니다. 공개 페이지에 반영되기까지 잠시 걸릴 수 있습니다.':'저장했습니다.');
  }catch(error){document.querySelector('#editor-error').textContent=errorMessage(error);if(error.status===409||error.code==='conflict')document.querySelector('#reload-editor').hidden=false;}
  finally{setBusy(false);}
});
let booting=false;
async function bootstrap(){
  if(booting)return;booting=true;clearInterval(polling);
  const query=new URLSearchParams(location.search);let notice=oauthErrors[query.get('auth_error')]||'';
  if(query.has('auth_error')){const url=new URL(location.href);url.searchParams.delete('auth_error');history.replaceState(null,'',url);}
  try{
    for(let attempt=0;attempt<2;attempt++){
      try{
        const session=await api('/api/session');sessionInfo=session;
        if(session.authenticated)await startDashboard();else showLogin(session,notice);
        return;
      }catch(error){
        if(attempt===0&&(error.status===401||(error.status===403&&error.code==='access_denied'))){notice=error.message;continue;}
        main.innerHTML=`<div class="empty-state"><h2>관리자 연결을 확인해 주세요.</h2><p>${escape(error.message)}</p><button class="button" id="retry-admin">다시 시도</button><a class="back-link" href="${homeUrl}">← 공개 페이지로 돌아가기</a></div>`;
        document.querySelector('#retry-admin').onclick=()=>bootstrap();return;
      }
    }
  }finally{booting=false;}
}
bootstrap();
