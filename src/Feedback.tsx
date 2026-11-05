import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,MessageSquare,Send} from 'lucide-react';
import {feedbackAreas,feedbackLimit,feedbackRecipient} from '../shared/feedback';
import {feedbackAvailability,sendFeedback} from './feedbackData';
import './feedback.css';

export default function Feedback({userId,householdId,email,onBusy}:{userId:string;householdId:string;email:string;onBusy:(busy:boolean)=>void}){
 const [area,setArea]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState('');
 const inFlight=useRef(false),request=useRef<{content:string;id:string}|null>(null);
 const [available,setAvailable]=useState<boolean|null>(null);
 useEffect(()=>{let active=true;void feedbackAvailability().then(value=>{if(active)setAvailable(value)});return()=>{active=false}},[]);
 async function submit(event:React.FormEvent){
  event.preventDefault();if(inFlight.current||available===false)return;
  if(!area||!message.trim()){setError('Choose an area and write a comment before sending.');return}
  const content=JSON.stringify({area,message:message.trim()});
  if(request.current?.content!==content)request.current={content,id:crypto.randomUUID()};
  inFlight.current=true;setBusy(true);onBusy(true);setError('');
  try{await sendFeedback({requestId:request.current.id,householdId,area,message:message.trim()},userId);setSent(true);setMessage('');request.current=null}
  catch(e){setError(e instanceof Error?e.message:'Could not send your feedback. Your comment is still here.')}
  finally{inFlight.current=false;setBusy(false);onBusy(false)}
 }
 if(sent)return <section className="feedback-success" role="status"><CheckCircle2 size={36}/><h3>Thanks for helping HH grow.</h3><p>Your feedback has been sent to <strong>{feedbackRecipient}</strong>.</p><button type="button" className="button primary" onClick={()=>{setSent(false);setArea('');setError('')}}>Send more feedback</button></section>;
 return <div className="feedback-page"><div className="settings-page-intro"><MessageSquare size={25}/><p>Something not working? An idea that would make family life easier? We’d love to hear it.</p></div>
  <form onSubmit={submit} className="feedback-form" aria-busy={busy}>
   <label htmlFor="feedback-area">What is your feedback about?</label>
   <select id="feedback-area" value={area} required disabled={busy} onChange={e=>{setArea(e.target.value);setError('')}}><option value="" disabled>Choose an area of HH</option>{feedbackAreas.map(option=><option key={option} value={option}>{option}</option>)}</select>
   <label htmlFor="feedback-comment">Your comment</label>
   <textarea id="feedback-comment" value={message} required maxLength={feedbackLimit} rows={7} disabled={busy} aria-describedby="feedback-count feedback-privacy" placeholder={area==='New Feature Suggestion'?'What would you like HH to do? Tell us how it would help your family.':'Tell us what happened, what you expected, or what could work better.'} onChange={e=>{setMessage(e.target.value);setError('')}}/>
   <small id="feedback-count" className="feedback-count">{message.length.toLocaleString()} / {feedbackLimit.toLocaleString()}</small>
   <p id="feedback-privacy" className="feedback-caption">Sent directly to <strong>{feedbackRecipient}</strong>, with your account email ({email}) so we can reply. Please leave out passwords and sensitive family details.</p>
   {available===false&&<p className="feedback-caption" role="status">Sending feedback is temporarily unavailable. Please try again later.</p>}
   {error&&<p className="error" role="alert">{error}</p>}
   <button type="submit" className="button primary wide" disabled={busy||available===false||!area||!message.trim()}><Send size={17}/>{busy?'Sending…':'Send Feedback'}</button>
  </form>
 </div>;
}
