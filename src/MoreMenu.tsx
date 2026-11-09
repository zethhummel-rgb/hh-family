import {useEffect,useRef} from 'react';
import {BookOpen,ArrowRight,MessageSquare,NotebookPen,Utensils,X} from 'lucide-react';
import './more-menu.css';

type Destination='Meals'|'Notes'|'Feedback'|'Help';
type Props={activeTab:string;opener:HTMLElement|null;onSelect:(destination:Destination)=>void;onClose:()=>void};

export default function MoreMenu({activeTab,opener,onSelect,onClose}:Props){
 const dialog=useRef<HTMLElement>(null),firstAction=useRef<HTMLButtonElement>(null),selected=useRef(false),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  const overflow=document.body.style.overflow;document.body.style.overflow='hidden';firstAction.current?.focus({preventScroll:true});
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.current();return}
   if(event.key!=='Tab')return;
   const buttons=Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]).filter(button=>button.getClientRects().length>0),first=buttons[0],last=buttons.at(-1);
   if(!first){event.preventDefault();return}
   if(event.shiftKey&&(document.activeElement===first||!dialog.current?.contains(document.activeElement))){event.preventDefault();last?.focus()}
   else if(!event.shiftKey&&(document.activeElement===last||!dialog.current?.contains(document.activeElement))){event.preventDefault();first.focus()}
  };
  document.addEventListener('keydown',key);
  return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);requestAnimationFrame(()=>{
   if(document.querySelector('.more-menu-dialog'))return;
   const target=selected.current?document.querySelector<HTMLElement>('.meal-planner h1,.family-notes-page h1,.settings-dialog #settings-title'):opener;
   if(target?.isConnected&&!target.closest('[inert]'))target.focus({preventScroll:true});
  })};
 },[]);
 function choose(destination:Destination){selected.current=true;onSelect(destination)}
 return <div className="more-menu-backdrop" onClick={event=>{if(event.target===event.currentTarget)onClose()}}>
  <section ref={dialog} id="more-menu-dialog" className="more-menu-dialog" role="dialog" aria-modal="true" aria-labelledby="more-menu-title">
   <div className="more-menu-heading"><div><p className="eyebrow">A LITTLE MORE TOGETHER</p><h2 id="more-menu-title">More for your home</h2></div><button type="button" className="icon-button" aria-label="Close More menu" onClick={onClose}><X size={20}/></button></div>
   <div className="more-menu-options">
    <button ref={firstAction} type="button" className={'more-menu-option'+(activeTab==='Meals'?' is-current':'')} aria-current={activeTab==='Meals'?'page':undefined} data-tour="more-Meals" onClick={()=>choose('Meals')}><span className="round-icon sage"><Utensils size={22}/></span><span><b>Meal planner</b><small>Daily meals, favourites and ingredients.</small></span><ArrowRight size={18}/></button>
    <button type="button" className={'more-menu-option'+(activeTab==='Notes'?' is-current':'')} aria-current={activeTab==='Notes'?'page':undefined} data-tour="more-Notes" onClick={()=>choose('Notes')}><span className="round-icon sage"><NotebookPen size={22}/></span><span><b>Family notes</b><small>The useful details, shared together.</small></span><ArrowRight size={18}/></button>
    <button type="button" className="more-menu-option" data-tour="more-Feedback" onClick={()=>choose('Feedback')}><span className="round-icon sage"><MessageSquare size={22}/></span><span><b>Send Feedback</b><small>Share a comment or suggest a new feature.</small></span><ArrowRight size={18}/></button>
    <button type="button" className="more-menu-option" onClick={()=>choose('Help')}><span className="round-icon sage"><BookOpen size={22}/></span><span><b>Help &amp; tutorials</b><small>Practise on the real pages, step by step.</small></span><ArrowRight size={18}/></button>
   </div>
  </section>
 </div>;
}
