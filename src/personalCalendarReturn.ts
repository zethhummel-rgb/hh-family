type GoogleReturn={state:string;code:string};
let pending:GoogleReturn|null=null;
let completion:{actor:string;promise:Promise<void>}|null=null;

if(typeof location!=='undefined'){
 const url=new URL(location.href),fragment=new URLSearchParams(url.hash.slice(1));
 if(fragment.has('personal_calendar_state')||fragment.has('personal_calendar_code')){
  const state=fragment.get('personal_calendar_state')||'',code=fragment.get('personal_calendar_code')||'';
  if(/^hhp_[A-Za-z0-9_-]{43}$/.test(state)&&code.length>0&&code.length<=4096)pending={state,code};
  fragment.delete('personal_calendar_state');
  fragment.delete('personal_calendar_code');
  url.hash=fragment.toString();
  history.replaceState(history.state,'',url.href);
 }
}

export function completePersonalCalendarReturn(actor:string,finish:(result:GoogleReturn)=>Promise<unknown>){
 if(completion?.actor===actor)return completion.promise;
 if(!pending)return Promise.reject(Error('Google connection expired. Start again in Settings.'));
 const receipt=pending;
 pending=null;
 const promise=(async()=>{await finish(receipt)})();
 completion={actor,promise};
 return promise;
}
