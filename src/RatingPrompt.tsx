import {useId,useRef,useState} from 'react';
import {Star} from 'lucide-react';
import MemberPopup from './MemberPopup';
import './rating-prompt.css';

const ratings=[1,2,3,4,5];
const commentLimit=1000;
export type MemberRating={stars:number;comment:string;allow_quote:boolean};

export default function RatingPrompt({onSubmit,onSkip,onOpen}:{
 onSubmit:(rating:MemberRating)=>Promise<void>;onSkip:()=>Promise<void>;onOpen?:()=>void;
}){
 const id=useId();
 const [stars,setStars]=useState(0);
 const [comment,setComment]=useState('');
 const [allowQuote,setAllowQuote]=useState(true);
 const [busy,setBusy]=useState<'rating'|'skip'|null>(null);
 const [error,setError]=useState('');
 const [complete,setComplete]=useState(false);
 const submitting=useRef(false);

 async function finish(action:'rating'|'skip'){
  if(submitting.current||(action==='rating'&&!stars))return;
  submitting.current=true;
  setBusy(action);
  setError('');
  try{
   const cleanComment=comment.trim();
   if(action==='rating')await onSubmit({stars,comment:cleanComment,allow_quote:!!cleanComment&&allowQuote});
   else await onSkip();
   setComplete(true);
  }catch{
   setError(action==='rating'?'Your rating couldn’t be saved. Try again.':'The prompt couldn’t be dismissed. Try again.');
  }finally{
   submitting.current=false;
   setBusy(null);
  }
 }

 if(complete)return null;
 return <MemberPopup className="member-rating-dialog" onOpen={onOpen} onCancel={()=>void finish('skip')}>
  {({headingId,headingRef})=><form className="member-rating-form" aria-busy={busy!==null} onSubmit={event=>{
   event.preventDefault();void finish('rating');
  }}>
   <header className="member-notice-header">
    <span className="member-notice-icon" aria-hidden="true"><Star size={22} strokeWidth={1.6}/></span>
    <h2 id={headingId} ref={headingRef} tabIndex={-1}>How’s HH working for you?</h2>
   </header>
   <fieldset className="member-rating-fieldset" disabled={busy!==null}>
    <legend>Choose a star rating</legend>
    <div className="member-rating-stars">
     {ratings.map(value=><label className="member-rating-choice" key={value}>
      <input type="radio" name={`${id}-stars`} value={value} checked={stars===value}
       aria-label={`${value} ${value===1?'star':'stars'}`} onChange={()=>setStars(value)}/>
      <span className={value<=stars?'is-filled':undefined} aria-hidden="true"><Star size={24}/></span>
     </label>)}
    </div>
    <label className="member-rating-comment" htmlFor={`${id}-comment`}>Comment <small>(optional)</small></label>
    <textarea id={`${id}-comment`} value={comment} rows={3} maxLength={commentLimit}
     onChange={event=>setComment(event.target.value)} placeholder="What’s working well? What could be better?"/>
    <label className="member-rating-consent">
     <input type="checkbox" checked={allowQuote} onChange={event=>setAllowQuote(event.target.checked)}/>
     <span>HH may quote my comment on its website <small>(optional)</small></span>
    </label>
   </fieldset>
   {error&&<p className="member-rating-error" role="alert">{error}</p>}
   <footer className="member-rating-actions">
    <button type="button" className="button" aria-describedby={`${id}-dismiss-note`} disabled={busy!==null} onClick={()=>void finish('skip')}>{busy==='skip'?'Dismissing…':'Dismiss for now'}</button>
    <button type="submit" className="button primary" disabled={!stars||busy!==null}>{busy==='rating'?'Saving…':'Send rating'}</button>
    <p className="member-rating-dismiss-note" id={`${id}-dismiss-note`}>Dismissing pauses the prompt for 24 hours.</p>
   </footer>
  </form>}
 </MemberPopup>;
}
