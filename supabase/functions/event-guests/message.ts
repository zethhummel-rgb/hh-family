import {guestEventDate, replyLabels, type GuestEvent, type Reply} from './event.ts';

const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function eventGuestMessage(app:string, token:string, sender:string, event:GuestEvent, message:string){
 const url=new URL(app);
 url.search='';
 const links=Object.fromEntries((Object.keys(replyLabels) as Reply[]).map(reply=>{
  url.hash=new URLSearchParams({'event-invite':token,reply}).toString();
  return [reply,url.href];
 })) as Record<Reply,string>;
 const date=guestEventDate(event);
 const intro=sender+' invited you to an event on HH.';
 const about=new URL('about.html#start',app).href;
 const footer='HH Family gives your household one place for shared plans, grocery lists, and reminders. Want to try it with your family?';
 const callToAction='Learn about HH and request an invite';
 const text=[intro,event.title,date,event.location,message,...(Object.keys(links) as Reply[]).map(reply=>replyLabels[reply]+'\n'+links[reply]),'Open your invitation to confirm your reply. You can respond without an HH account.','Curious about HH?\n'+footer+'\n'+callToAction+': '+about].filter(Boolean).join('\n\n');
 const html='<!doctype html><html lang="en"><body style="margin:0;background:#fff7fa;color:#523b45;font-family:Arial,sans-serif">'+
  '<table role="presentation" style="width:100%;padding:24px 12px"><tr><td align="center">'+
  '<table role="presentation" style="max-width:560px;width:100%;background:#fffcfd;border:1px solid #efdae3;border-radius:20px"><tr><td style="padding:24px">'+
  '<p>'+escape(intro)+'</p><h1 style="font-family:Georgia,serif">'+escape(event.title)+'</h1><p>'+escape(date)+'</p>'+
  (event.location?'<p>'+escape(event.location)+'</p>':'')+(message?'<p style="white-space:pre-wrap">'+escape(message)+'</p>':'')+
  (Object.keys(links) as Reply[]).map(reply=>'<p><a style="display:inline-block;background:#85485f;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none" href="'+escape(links[reply])+'">'+escape(replyLabels[reply])+'</a></p>').join('')+
  '<p>Open your invitation to confirm your reply. You can respond without an HH account.</p>'+
  '<div style="border-top:1px solid #efdae3;margin-top:24px;padding-top:14px"><p><strong>Curious about HH?</strong></p>'+
  '<p>'+escape(footer)+'</p><p><a href="'+escape(about)+'" style="color:#85485f">'+escape(callToAction)+'</a></p></div></td></tr></table></td></tr></table></body></html>';
 return {subject:"You're invited to an event on HH",text,html,links};
}
