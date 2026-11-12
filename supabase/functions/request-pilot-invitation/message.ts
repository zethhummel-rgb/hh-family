import {validMailAddress} from '../invitation-email/message.ts';
export {feedbackRecipient as pilotRequestRecipient} from '../../../shared/feedback.ts';

const interestLabels={yes:'Yes, I’d like to join',maybe:'I’d like to learn more',no:'No, I have a question'};
type Interest=keyof typeof interestLabels;
type Answers={requestId:string;name:string;email:string;source:string;interest:Interest;message:string};
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));

export function pilotAnswers(input:Record<string,unknown>):Answers|null{
 const {requestId,name,email,source,interest,message}=input;
 if(typeof requestId!=='string'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId))
  ||typeof email!=='string'||!validMailAddress(email.trim())
  ||typeof name!=='string'||!name.trim()||name.trim().length>80||/[\u0000-\u001f\u007f]/.test(name)
  ||typeof source!=='string'||!source.trim()||source.trim().length>160||/[\u0000-\u001f\u007f]/.test(source)
  ||typeof interest!=='string'||!Object.hasOwn(interestLabels,interest)
  ||typeof message!=='string'||message.trim().length>1500||message.includes('\0'))return null;
 return {requestId:requestId.toLowerCase(),name:name.trim(),email:email.trim().toLowerCase(),source:source.trim(),interest:interest as Interest,message:message.trim()};
}

export function pilotRequestMessage(answers:Answers,test:boolean){
 const subject=test?'[HH TEST] Invitation request':'[HH] Invitation request';
 const fields=[['Name',answers.name],['Email',answers.email],['Heard about HH from',answers.source],['Pilot interest',interestLabels[answers.interest]]];
 const text=[subject,'',...fields.map(([label,value])=>label+': '+value),...(answers.message?['','Message:',answers.message]:[])].join('\n');
 const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#304336;line-height:1.6">
  <h2>${escape(subject)}</h2><dl>${fields.map(([label,value])=>`<dt><b>${escape(label)}</b></dt><dd>${escape(value)}</dd>`).join('')}</dl>
  ${answers.message?`<h3>Message</h3><p style="white-space:pre-wrap">${escape(answers.message)}</p>`:''}
  </body></html>`;
 return {subject,text,html};
}
