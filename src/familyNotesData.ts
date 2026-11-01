import {supabase} from './supabase';

export type FamilyNote={id:string;household_id:string;title:string;body:string;pinned:boolean;created_at:string;updated_at:string;version:number};
export type FamilyNoteDraft={title:string;body:string;pinned:boolean};
const fields='id,household_id,title,body,pinned,created_at,updated_at,version';
export class NoteConflictError extends Error{
 constructor(){super('This note was changed or removed by someone in your household. Review the latest note before trying again.');this.name='NoteConflictError'}
}
const failure=(error:{message?:string})=>Error(error.message||'Could not load or save family notes.');
export const sortFamilyNotes=(notes:FamilyNote[])=>[...notes].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id));

export async function loadFamilyNotes(hid:string):Promise<FamilyNote[]>{
 const notes:FamilyNote[]=[];let after:string|undefined;
 // A stable ID cursor avoids the API's default row cap and does not skip rows
 // when another family member edits or pins a note between pages.
 while(true){
  let query=supabase.from('household_notes').select(fields).eq('household_id',hid).order('id').limit(200);
  if(after)query=query.gt('id',after);
  const result=await query;if(result.error)throw failure(result.error);
  const page=result.data as FamilyNote[];notes.push(...page);
  if(page.length<200)break;
  const next=page.at(-1)?.id;if(!next||next===after)throw Error('Could not finish loading family notes. Please try again.');after=next;
 }
 return sortFamilyNotes(notes);
}
export async function loadFamilyNote(hid:string,id:string):Promise<FamilyNote|null>{
 const result=await supabase.from('household_notes').select(fields).eq('household_id',hid).eq('id',id).maybeSingle();
 if(result.error)throw failure(result.error);return result.data as FamilyNote|null;
}
export async function saveFamilyNote(hid:string,draft:FamilyNoteDraft,current?:FamilyNote|null):Promise<FamilyNote>{
 const title=draft.title.trim(),body=draft.body;
 if(!title||title.length>160)throw Error('Give your note a title of up to 160 characters.');
 if(!body.trim()||body.length>10000)throw Error('Write a note of up to 10,000 characters.');
 if(typeof draft.pinned!=='boolean')throw Error('Choose whether to pin this note.');
 const value={title,body,pinned:draft.pinned};
 const result=current?await supabase.from('household_notes').update(value).eq('household_id',hid).eq('id',current.id).eq('version',current.version).select(fields).maybeSingle():await supabase.from('household_notes').insert({household_id:hid,...value}).select(fields).single();
 if(result.error)throw failure(result.error);if(!result.data)throw new NoteConflictError();return result.data as FamilyNote;
}
export async function deleteFamilyNote(hid:string,current:FamilyNote):Promise<void>{
 const result=await supabase.from('household_notes').delete().eq('household_id',hid).eq('id',current.id).eq('version',current.version).select('id').maybeSingle();
 if(result.error)throw failure(result.error);if(!result.data)throw new NoteConflictError();
}
export async function pinFamilyNote(hid:string,current:FamilyNote,pinned:boolean):Promise<FamilyNote>{
 const result=await supabase.from('household_notes').update({pinned}).eq('household_id',hid).eq('id',current.id).eq('version',current.version).select(fields).maybeSingle();
 if(result.error)throw failure(result.error);if(!result.data)throw new NoteConflictError();return result.data as FamilyNote;
}
