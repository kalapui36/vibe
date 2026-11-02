import { api, escape, categories, thumbnail, bindImageErrors } from './shared.js';
let apps = [], category = 'all';
const search = document.querySelector('#search'), results = document.querySelector('#results');
function render() {
  const query = search.value.trim().toLocaleLowerCase();
  const filtered = apps.filter(app => (category === 'all' || app.category === category) && `${app.name} ${app.description}`.toLocaleLowerCase().includes(query));
  for (const key of ['all',...Object.keys(categories)]) document.querySelector(`#count-${key}`).textContent = key === 'all' ? apps.length : apps.filter(app=>app.category === key).length;
  document.querySelector('#total-count').textContent = apps.length;
  if (!filtered.length) {
    results.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">${apps.length ? '⌕' : '▦'}</div><h3>${apps.length ? '검색 결과가 없습니다.' : '아직 등록된 웹앱이 없습니다.'}</h3><p>${apps.length ? '다른 검색어나 분류로 찾아보세요.' : '웹앱이 등록되면 이곳에서 확인할 수 있습니다.'}</p>${apps.length ? '<button class="text-button" id="reset-filters">전체 보기 ↗</button>' : ''}</div>`;
    document.querySelector('#reset-filters')?.addEventListener('click',()=>{ search.value=''; document.querySelector('[data-category="all"]').click(); });
    return;
  }
  results.innerHTML = `<div class="app-grid">${filtered.map(app=>`<a class="app-card" href="${escape(app.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(app.name)} — 새 탭에서 열기"><div class="card-image">${thumbnail(app)}<span class="card-launch" aria-hidden="true">↗</span></div><div class="card-body"><span class="category-label ${escape(app.category)}"><i></i>${categories[app.category]}</span><h3>${escape(app.name)}</h3><p>${escape(app.description || '웹앱을 열어 확인하세요.')}</p><span class="card-domain">${escape(new URL(app.url).hostname + new URL(app.url).pathname.replace(/\/$/, ''))}</span></div></a>`).join('')}</div>`;
  bindImageErrors(results);
}
for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click',()=>{
  category=tab.dataset.category;
  document.querySelectorAll('.tab').forEach(button=>{ button.classList.toggle('active',button===tab); button.setAttribute('aria-pressed',String(button===tab)); });
  render();
});
search.addEventListener('input',render);
document.addEventListener('keydown',event=>{ if(event.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){ event.preventDefault(); search.focus(); } });
async function load() {
  try { apps = await api('/api/apps'); render(); }
  catch { results.innerHTML='<div class="empty-state"><h3>목록을 불러오지 못했습니다.</h3><p>연결을 확인한 뒤 다시 시도해 주세요.</p><button class="button" id="retry">다시 시도</button></div>'; document.querySelector('#retry').onclick=load; }
}
load();
