export function webAddress(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('올바른 웹 주소를 입력해 주세요.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new Error('HTTP 또는 HTTPS 주소를 입력해 주세요.');
  return url.href;
}
export function relatedLinks(value = []) {
  if (!Array.isArray(value) || value.length > 6) throw new Error('관련 주소는 최대 6개까지 등록할 수 있습니다.');
  return value.map(link => {
    const label = String(link?.label || '').trim();
    if (!label || label.length > 40) throw new Error('관련 주소 이름을 1~40자로 입력해 주세요.');
    return { label, url: webAddress(link.url) };
  });
}
export function primaryLabel(value = '') {
  const label=String(value).trim();
  if(label.length>40)throw new Error('기본 주소 이름은 40자 이내로 입력해 주세요.');
  return label;
}
