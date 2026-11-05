export {feedbackRecipient,validFeedbackArea,feedbackLimit} from '../../../shared/feedback.ts';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function feedbackMessage(row:{area:string;message:string;email:string;name:string;householdName:string;id:string},test:boolean){
 const subject=`${test?'[HH TEST]':'[HH]'} Feedback: ${row.area}`;
 const lines=[subject,'',`From: ${row.name} <${row.email}>`,`Household: ${row.householdName}`,`Area: ${row.area}`,`Reference: ${row.id}`,'',row.message];
 return {subject,text:lines.join('\n'),html:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#493540;line-height:1.7"><h2>${escape(subject)}</h2><p><b>From:</b> ${escape(row.name)} &lt;${escape(row.email)}&gt;<br><b>Household:</b> ${escape(row.householdName)}<br><b>Area:</b> ${escape(row.area)}</p><div style="white-space:pre-wrap;padding:20px;background:#fff5f9;border:1px solid #eed5de;border-radius:12px">${escape(row.message)}</div><p style="font-size:12px">Reference: ${escape(row.id)}</p></body></html>`};
}
