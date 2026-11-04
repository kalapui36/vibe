import { webAddress } from './catalog.js';

let errorId=0;
export function fieldError(control, message='') {
  if(!control.dataset.errorId){
    const error=document.createElement('span');error.id=`field-error-${++errorId}`;error.className='inline-error';error.setAttribute('aria-live','polite');error.hidden=true;
    control.after(error);control.dataset.errorId=error.id;
    control.setAttribute('aria-describedby',[control.getAttribute('aria-describedby'),error.id].filter(Boolean).join(' '));
  }
  const error=document.getElementById(control.dataset.errorId);
  error.textContent=message;error.hidden=!message;
  if(message)control.setAttribute('aria-invalid','true');else control.removeAttribute('aria-invalid');
}
export function validationMessage(control) {
  const value=control.value.trim();
  if(control.name==='name'&&!value)return '웹앱 이름을 입력해 주세요.';
  if(control.classList.contains('link-label')&&!value)return '관련 주소 이름을 입력해 주세요.';
  if(control.type==='url'){
    if(!value)return '웹 주소를 입력해 주세요.';
    try{webAddress(value);}catch{return 'https:// 또는 http://로 시작하는 올바른 주소를 입력해 주세요.';}
  }
  if(control.maxLength>0&&control.value.length>control.maxLength)return `${control.maxLength}자 이내로 입력해 주세요.`;
  return '';
}
export function validateEditor(form) {
  let first;
  for(const control of form.querySelectorAll('input:not([type=radio]):not([type=checkbox]):not([type=file]),textarea')) {
    if(control.disabled)continue;
    const message=validationMessage(control);fieldError(control,message);if(message&&!first)first=control;
  }
  if(first){first.focus({preventScroll:true});first.scrollIntoView({block:'center',behavior:'instant'});}
  return !first;
}
export function clearFieldErrors(form) {
  for(const control of form.querySelectorAll('[data-error-id]'))fieldError(control);
}
