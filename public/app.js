import { api, escape, categories, thumbnail, bindImageErrors } from './shared.js';
import { relatedLinks } from './catalog.js';
let apps = [], category = 'all', transition, loadState='loading';
const search = document.querySelector('#search'), results = document.querySelector('#results');
const tabs = [...document.querySelectorAll('.tab')];
const indicator = document.querySelector('.tab-indicator');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function updateIndicator() {
  const tab = document.querySelector('.tab.active');
  indicator.style.width = `${tab.offsetWidth}px`;
  indicator.style.height = `${tab.offsetHeight}px`;
  indicator.style.transform = `translate(${tab.offsetLeft}px,${tab.offsetTop}px)`;
}
function card(app) {
  let links=[];
  try { links=relatedLinks(app.links); } catch { /* Invalid legacy links are never rendered. */ }
  return `<article class="app-item"><a class="app-card" href="${escape(app.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(app.name)} — 새 탭에서 열기"><div class="card-image">${thumbnail(app)}</div><div class="card-body"><span class="category-label ${escape(app.category)}"><i></i>${categories[app.category]}</span><div class="card-title-row"><h2>${escape(app.name)}</h2><span class="card-arrow" aria-hidden="true">↗</span></div><p class="card-description">${escape(app.description || '웹앱을 열어 확인하세요.')}</p></div></a><div class="card-footer"><span class="primary-label">${escape(app.primary_label || '프로그램')}</span><div class="related-links">${links.map(link=>`<a class="related-link" href="${escape(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(app.name)} ${escape(link.label)} — 새 탭에서 열기">${escape(link.label)} ↗</a>`).join('')}</div></div></article>`;
}
function render(animate = false) {
  transition?.cancel();
  if(loadState!=='ready'){
    document.querySelector('#result-status').textContent=loadState==='loading'?'웹앱을 불러오는 중입니다.':'목록 연결을 확인해 주세요.';
    results.innerHTML=loadState==='loading'?'<div class="empty-state"><span class="loader"></span><h2>웹앱을 불러오는 중입니다.</h2></div>':'<div class="empty-state"><h2>목록을 불러오지 못했습니다.</h2><p>연결을 확인한 뒤 다시 시도해 주세요.</p><button class="button" id="retry">다시 시도</button></div>';
    document.querySelector('#retry')?.addEventListener('click',load);updateIndicator();return;
  }
  const query = search.value.trim().toLocaleLowerCase();
  const filtered = apps.filter(app => (category === 'all' || app.category === category) && `${app.name} ${app.description}`.toLocaleLowerCase().includes(query));
  for (const key of ['all',...Object.keys(categories)]) document.querySelector(`#count-${key}`).textContent = key === 'all' ? apps.length : apps.filter(app=>app.category === key).length;
  document.querySelector('#result-status').textContent = `${category === 'all' ? '전체' : categories[category]} 프로그램 ${filtered.length}개${query ? `, 검색어 ${query}` : ''}`;
  if (!filtered.length) {
    results.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">${apps.length ? '⌕' : '▦'}</div><h2>${apps.length ? '검색 결과가 없습니다.' : '아직 등록된 웹앱이 없습니다.'}</h2><p>${apps.length ? '다른 검색어나 분류로 찾아보세요.' : '웹앱이 등록되면 이곳에서 확인할 수 있습니다.'}</p>${apps.length ? '<button class="text-button" id="reset-filters">전체 보기 ↗</button>' : ''}</div>`;
    document.querySelector('#reset-filters')?.addEventListener('click',()=>{ search.value=''; tabs[0].click(); });
  } else {
    results.innerHTML = `<div class="app-grid" data-layout="${filtered.length===1?'single':filtered.length===2?'two':'many'}">${filtered.map(card).join('')}</div>`;
    bindImageErrors(results);
  }
  updateIndicator();
  if (animate && !reducedMotion.matches) transition = results.animate([{ opacity:.2, transform:'translateY(7px)' },{ opacity:1, transform:'translateY(0)' }],{ duration:220, easing:'cubic-bezier(.2,.7,.2,1)' });
}
for (const tab of tabs) {
  tab.addEventListener('click',()=>{
    const changed=category!==tab.dataset.category;
    category=tab.dataset.category;
    document.documentElement.dataset.category=category;
    tabs.forEach(button=>{ button.classList.toggle('active',button===tab); button.setAttribute('aria-pressed',String(button===tab)); });
    render(changed);
  });
  tab.addEventListener('keydown',event=>{
    const index=tabs.indexOf(tab);
    const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
    if(next!==null){event.preventDefault();tabs[next].focus();tabs[next].click();}
  });
}
search.addEventListener('input',()=>render());
document.addEventListener('keydown',event=>{ if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!document.activeElement.isContentEditable&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){ event.preventDefault(); search.focus(); } });
new ResizeObserver(updateIndicator).observe(document.querySelector('.tabs'));
document.fonts.ready.then(updateIndicator);
async function load() {
  loadState='loading';render();
  try { apps=await api('/api/apps');loadState='ready'; }
  catch { loadState='error'; }
  render();
}
load();
