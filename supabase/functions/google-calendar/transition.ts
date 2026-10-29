// Shared transition protocol; only the explicitly configured household is accessible.
export async function transitionConfig(admin:any,householdId:string){
 const r=await admin.rpc('household_transition_service',{action:'config',payload:{householdId}});
 if(r.error)throw Error('The household transition is unavailable. Your original home is preserved.');return r.data;
}
export function transitionPeople(ids:unknown,map:Record<string,string>,reverse=false){
 if(ids===undefined||ids===null)return ids;if(!Array.isArray(ids)||ids.length>20)throw Error('Check the people tagged on this event');
 const lookup=reverse?Object.fromEntries(Object.entries(map).map(([a,b])=>[b,a])):map;
 return ids.map(id=>{if(typeof id!=='string'||!lookup[id])throw Error('An event person needs to be mapped before the transfer');return lookup[id]});
}
export async function transitionRequest(config:any,action:string,payload:any={},fetcher:typeof fetch=fetch){
 if(config.peerProject!=='ybizqfghnplcxlmlhvyn'||typeof config.token!=='string')throw Error('Invalid household transition');
 if(!['events','search','series','create','update','delete','transition_items','transition_change','transition_snapshot'].includes(action))throw Error('This action is unavailable during the household transition');
 const body={...payload,action,householdId:config.peerHouseholdId};
 if(body.event)body.event={...body.event,person_ids:transitionPeople(body.event.person_ids,config.personMap,true)};
 const response=await fetcher('https://ybizqfghnplcxlmlhvyn.supabase.co/functions/v1/google-calendar',{method:'POST',headers:{'Content-Type':'application/json','x-hh-transition':config.token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const text=await response.text();if(text.length>8000000)throw Error('The household response needs a larger preservation pass');
 let value;try{value=JSON.parse(text)}catch{throw Error('Your original home could not be reached. Please retry.')}
 if(!response.ok||value.error)throw Error(typeof value.error==='string'?value.error:'Your original home could not be reached. Please retry.');
 const mapEvent=(e:any)=>({...e,person_ids:transitionPeople(e.person_ids,config.personMap)});
 if(value.events)value.events=value.events.map(mapEvent);if(value.event)value.event=mapEvent(value.event);
 if(action!=='transition_snapshot'&&value.items)value.items=value.items.map((i:any)=>({...i,household_id:config.householdId}));
 return value;
}

const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export async function authorizeTransition(admin:any,req:Request){
 const raw=await req.clone().text();if(raw.length>20000)throw Error('Invalid transition request');
 const body=JSON.parse(raw);if(!uuid(body.householdId))throw Error('Invalid transition request');
 const token=req.headers.get('x-hh-transition')||'';if(!/^[a-f0-9]{64}$/.test(token))throw Error('Transition authorization required');
 const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 const r=await admin.rpc('household_transition_service',{action:'authorize',payload:{householdId:body.householdId,tokenHash}});
 if(r.error||!r.data)throw Error('Transition authorization required');
 if(!['events','search','series','create','update','delete','transition_items','transition_change','transition_snapshot'].includes(body.action))throw Error('Unsupported transition action');
 return {body,ownerId:r.data.ownerId};
}
export async function transitionItems(admin:any,hid:string){
 const r=await admin.from('household_items').select('*').eq('household_id',hid).order('created_at').limit(1001);
 if(r.error||!r.data||r.data.length>1000)throw Error('Family lists could not be read safely');return r.data;
}
export async function transitionChange(admin:any,hid:string,body:any){
 const b=body.change;if(!b||typeof b!=='object')throw Error('Invalid list change');
 const fields=['title','person','due','reminder_time','repeat_unit','repeat_every'];
 const pick=(v:any)=>Object.fromEntries(fields.filter(k=>v[k]!==undefined).map(k=>[k,k==='due'?(v[k]||null):v[k]]));
 let r:any;
 if(b.action==='add'){
  if(!uuid(b.requestId)||!['grocery','task'].includes(b.kind)||typeof b.title!=='string'||!b.title.trim()||b.title.length>160)throw Error('Invalid list item');
  const row={id:b.requestId,household_id:hid,kind:b.kind,title:b.title.trim(),category:b.category||'Other',person:b.person||'Everyone',due:b.due||null};
  r=await admin.from('household_items').insert(row).select('id').single();
  if(r.error?.code==='23505'){const old=await admin.from('household_items').select('id,household_id,kind,title').eq('id',b.requestId).eq('household_id',hid).maybeSingle();if(!old.error&&old.data?.kind===row.kind&&old.data.title===row.title)return {ok:true}}
 }else if(b.action==='save_reminder'){
  if(!b.reminder||typeof b.reminder!=='object')throw Error('Check the reminder');const draft=pick(b.reminder);
  if(b.current){if(!uuid(b.current.id)||!Number.isInteger(b.current.reminder_version))throw Error('Refresh the reminder');
   r=await admin.from('household_items').update(draft).eq('household_id',hid).eq('kind','task').eq('id',b.current.id).eq('reminder_version',b.current.reminder_version).select('id').maybeSingle();
  }else{if(!uuid(b.requestId))throw Error('Invalid list request');r=await admin.from('household_items').insert({...draft,id:b.requestId,kind:'task',household_id:hid}).select('id').single();
   if(r.error?.code==='23505'){const old=await admin.from('household_items').select('id').eq('id',b.requestId).eq('household_id',hid).eq('kind','task').maybeSingle();if(!old.error&&old.data)return {ok:true}}
  }
 }else if(b.action==='toggle'){
  if(!uuid(b.id)||typeof b.done!=='boolean')throw Error('Invalid list change');
  let q=admin.from('household_items').update({done:b.done}).eq('household_id',hid).eq('id',b.id);if(b.version!==undefined){if(!Number.isInteger(b.version))throw Error('Refresh the reminder');q=q.eq('reminder_version',b.version)}r=await q.select('id').maybeSingle();
 }else if(b.action==='delete'){
  if(!uuid(b.id))throw Error('Invalid list change');r=await admin.from('household_items').delete().eq('household_id',hid).eq('id',b.id).select('id').maybeSingle();
 }else throw Error('Unsupported list change');
 if(r.error||!r.data)throw Error('The item changed or could not be saved. Refresh before retrying.');return {ok:true};
}
