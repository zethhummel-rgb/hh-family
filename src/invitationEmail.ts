import {supabase} from './supabase';
export type InviteKind='family'|'pilot';
export type EmailInvitation={kind:InviteKind;token:string;email:string;url:string;sent:boolean;error:string};
export function invitationLink(kind:InviteKind,token:string,base=location.origin+location.pathname){const url=new URL(base);url.search='';url.hash='';url.searchParams.set(kind==='family'?'invite':'pilot',token);return url.href}
export async function sendInvitationEmail(kind:InviteKind,token:string){
 const initial=await supabase.auth.getSession();const session=initial.data.session;if(initial.error||!session)throw Error('Sign in again to send an invitation.');
 const invoke=(access:string)=>supabase.functions.invoke('invitation-email',{body:{action:'send',kind,token},headers:{Authorization:'Bearer '+access}});
 let response=await invoke(session.access_token);
 if(response.error?.context?.status===401){const current=await supabase.auth.getSession();if(current.error||current.data.session?.user.id!==session.user.id)throw Error('Sign in again to send an invitation.');const fresh=await supabase.auth.refreshSession();if(fresh.error||fresh.data.session?.user.id!==session.user.id)throw Error('Sign in again to send an invitation.');response=await invoke(fresh.data.session.access_token)}
 if(response.error){let message='Email delivery could not be confirmed. Copy the invitation link or retry in a minute.';try{message=(await response.error.context?.json())?.error||message}catch{}throw Error(message)}
 if(!response.data?.sent)throw Error('Email delivery could not be confirmed. Copy the invitation link or retry in a minute.');
}
export async function deliverInvitation(invite:EmailInvitation):Promise<EmailInvitation>{try{await sendInvitationEmail(invite.kind,invite.token);return {...invite,sent:true,error:''}}catch(e){return {...invite,sent:false,error:(e as Error).message||'Email delivery could not be confirmed. You can copy and share the link.'}}}
export async function createEmailInvitation(kind:InviteKind,email:string):Promise<EmailInvitation>{
 const recipient=email.trim().toLowerCase();
 const r=kind==='family'?await supabase.rpc('create_household_invite',{invite_email:recipient}):await supabase.rpc('pilot_invitations',{action:'create',invite_email:recipient});
 if(r.error)throw r.error;const token=kind==='family'?r.data:r.data?.token;
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('Could not create an invitation.');
 return deliverInvitation({kind,token,email:recipient,url:invitationLink(kind,token),sent:false,error:''});
}
