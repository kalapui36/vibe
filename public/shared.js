export const categories = { class: '수업', mind: '사회정서교육', work: '업무' };
export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
export const isPages = document.querySelector('meta[name="vibe-runtime"]')?.content === 'pages';
export async function api(path, options = {}) {
  if (isPages) {
    if (path !== '/api/apps') return (await import('./github-store.js')).pagesApi(path, options);
    const response = await fetch(new URL('../content/apps.json', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error('웹앱 목록을 불러오지 못했습니다.');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('웹앱 목록 형식을 확인해 주세요.');
    return rows.filter(row => row.visible !== false).filter(row => {
      try { return ['http:', 'https:'].includes(new URL(row.url).protocol) && categories[row.category]; }
      catch { return false; }
    }).sort((a,b) => (a.position || 0) - (b.position || 0)).map(row => {
      const image=row.thumbnail||row.capture||row.image||null;
      return { ...row, image:image?new URL(image,new URL('../',import.meta.url)).href:null, preview:row.preview?new URL(row.preview,new URL('../',import.meta.url)).href:null };
    });
  }
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-Vibe-Request': '1', ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  let data;
  try { data = await response.json(); } catch { throw new Error('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) { const error = new Error(data.error || '요청에 실패했습니다.'); error.status = response.status; throw error; }
  return data;
}
export const captureMessages = {
  dns: '주소를 확인하지 못했습니다. 도메인과 네트워크 연결을 확인해 주세요.',
  browser: '캡처용 브라우저를 시작하지 못했습니다.',
  navigation: '웹앱에 접속하지 못했습니다. 주소와 접속 제한을 확인해 주세요.',
  http: '웹앱이 오류 응답을 반환했습니다.',
  screenshot: '첫 화면 이미지 저장에 실패했습니다.',
  unknown: '캡처에 실패했습니다. 다시 시도하거나 이미지를 올려 주세요.'
};
export function thumbnail(app) {
  if (app.image) return `<img src="${escape(app.image)}" alt="${escape(app.name)} 첫 화면" loading="lazy">`;
  if (app.preview) return `<img class="preview-art" src="${escape(app.preview)}" alt="${escape(app.name)} 대표 이미지" loading="lazy">`;
  const icons = { class: '<path d="M6 7h12l6 3 6-3h12v27H30l-6 3-6-3H6zM24 10v27"/>', mind:'<path d="M24 40S6 29 6 17a10 10 0 0 1 18-5 10 10 0 0 1 18 5c0 12-18 23-18 23z"/>', work:'<rect x="7" y="14" width="34" height="27" rx="3"/><path d="M17 14V7h14v7M7 25c11 5 23 5 34 0"/>' };
  return `<div class="thumbnail-fallback ${escape(app.category)}"><svg viewBox="0 0 48 48" aria-hidden="true">${icons[app.category]}</svg><span>${app.capture_status === 'pending' ? '첫 화면 준비 중' : categories[app.category]}</span></div>`;
}
export function bindImageErrors(root) {
  root.querySelectorAll('img').forEach(img => img.addEventListener('error', () => { const fallback = document.createElement('div'); fallback.className='image-unavailable'; fallback.textContent='이미지를 불러올 수 없습니다'; img.replaceWith(fallback); }, { once:true }));
}
