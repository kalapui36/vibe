// OAuth credentials are handled by the administrator server. The old token
// login stays available only until that server is connected for the first time.
const baseUrl=new URL('../',import.meta.url);
export async function pagesApi(path,options={}){
  const response=await fetch(new URL('content/config.json',baseUrl),{cache:'no-cache'});
  if(!response.ok)throw new Error('관리자 연결 설정을 불러오지 못했습니다.');
  const config=await response.json();
  if(!config.auth_url){
    const legacy=await import('./token-store.js');
    const result=await legacy.pagesApi(path,options);
    return path==='/api/session'?{...result,mode:'token',setup_required:true,setup_url:`https://render.com/deploy?repo=${encodeURIComponent('https://github.com/'+config.owner+'/'+config.repo)}`} : result;
  }
  const url=new URL(config.auth_url);
  const loopback=['localhost','127.0.0.1'].includes(url.hostname);
  if((url.protocol!=='https:'&&!(loopback&&url.protocol==='http:'))||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('관리자 연결 주소를 확인해 주세요.');
  const session={authenticated:false,configured:true,mode:'oauth',login_url:new URL('/auth/login',url).href};
  if(path==='/api/session')return session;
  throw Object.assign(new Error('GitHub 로그인 방식으로 전환되었습니다. 다시 로그인해 주세요.'),{status:401,code:'oauth_required',session});
}
