type OutlookReceipt={state:string;code:string};
let receipt:OutlookReceipt|null=null;
let completing:{actor:string;task:Promise<unknown>}|null=null;

if(typeof location!=='undefined'){
 const url=new URL(location.href);
 const fragment=new URLSearchParams(url.hash.slice(1));
 if(fragment.has('outlook_state')||fragment.has('outlook_code')){
  const state=fragment.get('outlook_state')||'',code=fragment.get('outlook_code')||'';
  if(/^[A-Za-z0-9_-]{43}$/.test(state)&&code.length>0&&code.length<=4096)receipt={state,code};
  fragment.delete('outlook_state');
  fragment.delete('outlook_code');
  url.hash=fragment.toString();
  history.replaceState(history.state,'',url.href);
 }
}

export function completeOutlookReturn(actor:string,finish:(data:OutlookReceipt)=>Promise<unknown>){
 if(completing?.actor===actor)return completing.task;
 if(!receipt)return Promise.reject(Error('Microsoft sign-in expired. Connect Outlook again.'));
 const current=receipt;
 receipt=null;
 const task=finish(current);
 completing={actor,task};
 return task;
}
