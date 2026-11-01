// Capture before authentication initializes. The one-use Google import completion
// token stays in memory only; it is never kept in browser storage or a query URL.
let pendingToken:string|null=null;
if(typeof location!=='undefined'){
 const url=new URL(location.href),fragment=new URLSearchParams(url.hash.slice(1));
 if(fragment.has('calendar_import_token')){
  const token=fragment.get('calendar_import_token')||'';
  if(/^[A-Za-z0-9_-]{43}$/.test(token))pendingToken=token;
  fragment.delete('calendar_import_token');url.hash=fragment.toString();
  history.replaceState(history.state,'',url.href);
 }
}
let completing:{actor:string;promise:Promise<void>}|null=null;
export function clearGoogleImportReturn(){pendingToken=null}
export async function completeGoogleImportReturn(householdId:string,userId:string,complete:(token:string)=>Promise<unknown>){
 const token=pendingToken;if(!token)return;
 const actor=householdId+':'+userId;
 // React may remount during startup. A one-use token must have one request.
 if(completing?.actor===actor)return completing.promise;
 const promise=(async()=>{await complete(token);if(pendingToken===token)pendingToken=null})();
 completing={actor,promise};
 try{await promise}finally{if(completing?.promise===promise)completing=null}
}
