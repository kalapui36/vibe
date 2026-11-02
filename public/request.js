// Keep the deadline active until the JSON body has also finished downloading.
export async function requestJson(url,options={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  const abort=()=>controller.abort();
  if(options.signal?.aborted)controller.abort();
  options.signal?.addEventListener('abort',abort,{once:true});
  let response;
  try{
    response=await fetch(url,{...options,signal:controller.signal});
    let data;
    try{data=response.status===204?null:await response.json();}
    catch(error){if(controller.signal.aborted)throw error;throw Object.assign(new Error('서버 응답을 확인하지 못했습니다. 다시 시도해 주세요.'),{status:response.status,code:'invalid_response'});}
    return {response,data};
  }catch(error){
    if(controller.signal.aborted)throw Object.assign(new Error('연결 시간이 초과되었습니다. 연결을 확인한 뒤 다시 시도해 주세요.'),{status:408,code:'timeout'});
    if(error.status)throw error;
    throw Object.assign(new Error('서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'),{code:'network'});
  }finally{clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);}
}
