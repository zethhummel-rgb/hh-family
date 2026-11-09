import {createContext,useCallback,useContext,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,Check,CircleHelp,RotateCcw,X} from 'lucide-react';
import ChoiceDialog from './ChoiceDialog';
import {tutorialGuides,type PracticeKind,type TutorialGuide,type TutorialStep} from './tutorialGuides';
import './interactive-tutorial.css';

type Session={id:string;index:number;started:boolean;complete:boolean};
type Controller={active:boolean;start:(id:string)=>void;intercept:(kind:PracticeKind)=>boolean;registerReset:(reset:()=>void)=>(()=>void);completed:string[]};
const Context=createContext<Controller|null>(null);
const inactive={active:false,intercept:(_:PracticeKind)=>false};
export const useTutorialPractice=()=>useContext(Context)||inactive;
export function useInteractiveTutorial(){const value=useContext(Context);if(!value)throw Error('Tutorial provider is missing');return value}
export function useTutorialHost(reset:()=>void){const tutorial=useInteractiveTutorial(),latest=useRef(reset);latest.current=reset;useLayoutEffect(()=>tutorial.registerReset(()=>latest.current()),[tutorial.registerReset])}
const visible=(el:HTMLElement)=>el.getClientRects().length>0&&!el.closest('[hidden],[inert]')&&getComputedStyle(el).visibility!=='hidden';
export function findTutorialTarget(selector:string){return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(visible)||null}
const focusable='button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]';

export function InteractiveTutorialProvider({userId,householdId,children}:{userId:string;householdId:string;children:ReactNode}){
 const key=`hh:interactive-tutorial:v1:${location.pathname}:${userId}:${householdId}`;
 const [session,setSession]=useState<Session|null>(null),[acted,setActed]=useState(false),[notice,setNotice]=useState(''),[exitRequested,setExitRequested]=useState(false);
 const [completed,setCompleted]=useState<string[]>(()=>{try{const saved=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(saved)?saved.filter(id=>tutorialGuides.some(g=>g.id===id)):[]}catch{return []}});
 const reset=useRef<()=>void>(()=>{}),latest=useRef({session});latest.current={session};
 const registerReset=useCallback((callback:()=>void)=>{reset.current=callback;return()=>{if(reset.current===callback)reset.current=()=>{}}},[]);
 const start=useCallback((id:string)=>{if(!tutorialGuides.some(g=>g.id===id))return;reset.current();setExitRequested(false);setNotice('');setActed(false);setSession({id,index:0,started:false,complete:false})},[]);
 const guide=tutorialGuides.find(g=>g.id===session?.id),step=guide?.steps[session?.index||0];
 const markComplete=useCallback(()=>{const current=latest.current.session;if(!current||current.complete)return;setSession({...current,complete:true});setCompleted(old=>{const next=Array.from(new Set([...old,current.id]));try{localStorage.setItem(key,JSON.stringify(next))}catch{}return next})},[key]);
 const intercept=useCallback((kind:PracticeKind)=>{
  const current=latest.current.session;if(!current)return false;
  const currentStep=tutorialGuides.find(g=>g.id===current.id)?.steps[current.index];
  if(current.started&&currentStep?.action==='save'&&currentStep.kind===kind)markComplete();
  else setNotice('Finish the highlighted step first. Nothing has been saved or sent.');
  return true;
 },[markComplete]);
 const stop=useCallback(()=>{reset.current();setSession(null);setExitRequested(false);setActed(false);setNotice('')},[]);
 const advance=useCallback(()=>{const current=latest.current.session;if(!current)return;const g=tutorialGuides.find(g=>g.id===current.id)!;if(current.index===g.steps.length-1){markComplete();return}setActed(false);setNotice('');setSession({...current,index:current.index+1})},[markComplete]);
 useEffect(()=>{setActed(false);setNotice('')},[session?.id,session?.index]);
 useLayoutEffect(()=>{
  if(!session)return;
  document.documentElement.classList.add('tutorial-practice-active');
  const fieldOK=(target:HTMLElement)=>{if(target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement)return target.checkValidity()&&(target instanceof HTMLInputElement&&target.type==='checkbox'||target.value.trim().length>0);return true};
  const allowed=(target:EventTarget|null)=>{if(!(target instanceof Element))return false;const control=session.started&&!session.complete&&step?findTutorialTarget(step.target):null;const form=step?.action==='save'?((control instanceof HTMLButtonElement?control.form:null)||control?.closest('form,.my-calendar-color')):null;return !!target.closest('[data-tutorial-overlay]')||!!control&&(control===target||control.contains(target)||target.closest('label')?.contains(control))||!!form&&form.contains(target)&&target.matches('input,select,textarea')};
  const pointer=(e:PointerEvent)=>{if(!exitRequested&&!allowed(e.target)){e.preventDefault();e.stopImmediatePropagation()}};
  const click=(e:MouseEvent)=>{
   if(exitRequested)return;
   if(!allowed(e.target)){e.preventDefault();e.stopImmediatePropagation();setNotice('Use the highlighted control, or choose Exit practice.');return}
   if(!session.started||session.complete||!step||(e.target as Element).closest('[data-tutorial-overlay]'))return;
   const target=findTutorialTarget(step.target);if(!target)return;
   if(step.action==='change'&&target instanceof HTMLSelectElement){setActed(fieldOK(target));return}
   if(step.action!=='click')return;
   setActed(fieldOK(target));
   // Labels also dispatch a click to their input. Advance only once per step.
   if(!target.matches('input,select,textarea')){const index=session.index,id=session.id;requestAnimationFrame(()=>{if(latest.current.session?.index===index&&latest.current.session.id===id)advance()})}
  };
  const change=(e:Event)=>{if(!step||!session.started||session.complete)return;const target=findTutorialTarget(step.target);if(target&&(target===e.target||target.contains(e.target as Node))&&(['input','change'].includes(step.action)||step.action==='click'&&target.matches('input,select,textarea'))){const currentId=session.id,currentIndex=session.index;queueMicrotask(()=>{if(latest.current.session?.id!==currentId||latest.current.session?.index!==currentIndex)return;setActed(fieldOK(target));setNotice('')})}};
  const submit=(e:Event)=>{const control=step?findTutorialTarget(step.target):null;const form=control instanceof HTMLButtonElement?control.form:null;const review=step?.action==='click'&&!!control?.closest('.email-invitation-form');if(exitRequested||session.complete||!session.started||e.target!==form||(step?.action!=='save'&&!review)){e.preventDefault();e.stopImmediatePropagation();setNotice('Finish the highlighted step before trying Save.')}};
  const keys=(e:KeyboardEvent)=>{
   if(exitRequested)return;
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();setExitRequested(true);return}
   if(e.key!=='Tab')return;
   const target=session.started&&!session.complete&&step?findTutorialTarget(step.target):null,coach=document.querySelector<HTMLElement>('[data-tutorial-overlay]');
   const nodes=Array.from(new Set([...(target?[...(target.matches(focusable)?[target]:[]),...target.querySelectorAll<HTMLElement>(focusable)]:[]),...Array.from(coach?.querySelectorAll<HTMLElement>(focusable)||[])])).filter(el=>visible(el)&&!el.closest('[inert]'));
   if(!nodes.length)return;e.preventDefault();e.stopImmediatePropagation();const index=nodes.indexOf(document.activeElement as HTMLElement);nodes[(index+(e.shiftKey?-1:1)+nodes.length)%nodes.length]?.focus({preventScroll:true});
  };
  document.addEventListener('pointerdown',pointer,true);document.addEventListener('click',click,true);document.addEventListener('input',change,true);document.addEventListener('change',change,true);document.addEventListener('submit',submit,true);document.addEventListener('keydown',keys,true);
  return()=>{document.documentElement.classList.remove('tutorial-practice-active');document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('click',click,true);document.removeEventListener('input',change,true);document.removeEventListener('change',change,true);document.removeEventListener('submit',submit,true);document.removeEventListener('keydown',keys,true)};
 },[session,step,exitRequested,advance]);
 const controller=useMemo(()=>({active:session!==null,start,intercept,registerReset,completed}),[session!==null,start,intercept,registerReset,completed]);
 return <Context.Provider value={controller}>{children}{session&&guide&&<TutorialCoach guide={guide} step={step!} session={session} acted={acted} notice={notice} onStart={()=>setSession({...session,started:true})} onNext={advance} onBack={()=>{setActed(false);setSession({...session,index:Math.max(0,session.index-1)})}} onRestart={()=>start(guide.id)} onExit={()=>setExitRequested(true)} onFinish={stop} hidden={exitRequested}/>} {exitRequested&&<ChoiceDialog title="Exit practice?" onCancel={()=>setExitRequested(false)} actions={[{label:'Keep practising',primary:true,run:()=>setExitRequested(false)},{label:'Exit practice',run:stop}]}><p>Your practice entries will be discarded. Nothing will be added or sent to your household.</p></ChoiceDialog>}</Context.Provider>;
}

function TutorialCoach({guide,step,session,acted,notice,onStart,onNext,onBack,onRestart,onExit,onFinish,hidden}:{guide:TutorialGuide;step:TutorialStep;session:Session;acted:boolean;notice:string;onStart:()=>void;onNext:()=>void;onBack:()=>void;onRestart:()=>void;onExit:()=>void;onFinish:()=>void;hidden:boolean}){
 const id=useId(),panel=useRef<HTMLElement>(null),[target,setTarget]=useState<HTMLElement|null>(null),[layout,setLayout]=useState({left:12,top:12,width:320,height:0,x:0,y:0,w:0,h:0}),[disabled,setDisabled]=useState(false),[resolving,setResolving]=useState(true),dialogs=useRef(new Map<HTMLElement,string|null>());
 const lastStep=useRef('');
 useLayoutEffect(()=>{
  let frame=0,alive=true;setTarget(null);setResolving(true);const missingTimer=setTimeout(()=>setResolving(false),600);
  const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   if(!alive)return;const el=session.started&&!session.complete?findTutorialTarget(step.target):null;setTarget(old=>old===el?old:el);if(el)setResolving(false);setDisabled(!!el?.matches(':disabled'));
   // Size the coach from viewport limits, not its changing scrollHeight: otherwise
   // resizing a scrollable coach can feed back into its placement indefinitely.
   const vv=window.visualViewport,vx=Math.max(0,vv?.offsetLeft||0),vy=Math.max(0,vv?.offsetTop||0);
   const right=Math.min(innerWidth,vx+(vv?.width||innerWidth)),bottom=Math.min(innerHeight,vy+(vv?.height||innerHeight));
   const vw=Math.max(1,right-vx),vh=Math.max(1,bottom-vy);
   const rect=el?.getBoundingClientRect(),width=Math.max(1,Math.min(356,vw-24)),height=Math.max(1,Math.min(280,vh*.44,vh-24));
   const x=Math.max(vx+4,rect?.left||0),y=Math.max(vy+4,rect?.top||0),w=Math.max(0,Math.min(rect?.right||0,right-4)-x),h=Math.max(0,Math.min(rect?.bottom||0,bottom-4)-y);
   const below=y+h+14,above=y-height-14;
   const proposedTop=rect?(below+height<=bottom-12?below:above>=vy+12?above:bottom-height-12):vy+Math.max(12,(vh-height)/2);
   const top=Math.max(vy+4,Math.min(proposedTop,bottom-height-4));
   const left=Math.max(vx+4,Math.min(vx+Math.max(12,(vw-width)/2),right-width-4));
   const next={left,top,width,height,x,y,w,h};setLayout(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
   const stepId=guide.id+':'+session.index+':'+session.started;
   if(el&&lastStep.current!==stepId){lastStep.current=stepId;el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});schedule()}
  })};
  const schedule=()=>update();
  const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,attributes:true});
  window.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);schedule();
  return()=>{alive=false;clearTimeout(missingTimer);cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule)};
 },[guide.id,session.index,session.started,session.complete,step.target]);
 useEffect(()=>{if(!target)return;const previous=target.getAttribute('aria-describedby');target.setAttribute('aria-describedby',`${previous||''} ${id}-copy`.trim());target.setAttribute('data-tutorial-highlight','true');return()=>{if(previous===null)target.removeAttribute('aria-describedby');else target.setAttribute('aria-describedby',previous);target.removeAttribute('data-tutorial-highlight')}},[target,id]);
 useEffect(()=>{const modal=target?.closest<HTMLElement>('[role="dialog"],[role="alertdialog"]');if(modal&&!dialogs.current.has(modal)){dialogs.current.set(modal,modal.getAttribute('aria-modal'));modal.setAttribute('aria-modal','false')}},[target]);
 useEffect(()=>()=>{for(const [modal,value] of dialogs.current){if(value===null)modal.removeAttribute('aria-modal');else modal.setAttribute('aria-modal',value)}},[]);
 useEffect(()=>{if(panel.current)panel.current.scrollTop=0;panel.current?.querySelector<HTMLElement>('h2')?.focus({preventScroll:true})},[guide.id,session.started,session.index,session.complete]);
 if(hidden)return null;
 const missing=session.started&&!session.complete&&!target&&!resolving;
 const mayContinue=step.action==='read'||acted;
 return createPortal(<div data-tutorial-overlay="true" className="tutorial-layer">
  {target&&!session.complete&&layout.w>0&&layout.h>0&&<div className="tutorial-spotlight" aria-hidden="true" style={{left:layout.x-4,top:layout.y-4,width:layout.w+8,height:layout.h+8}}/>}
  <section ref={panel} className="tutorial-coach" role="region" aria-labelledby={id+'-title'} onMouseDown={e=>{if((e.target as Element).closest('button'))e.preventDefault()}} onPointerDown={e=>{const button=(e.target as Element).closest('button');if(button)try{button.setPointerCapture(e.pointerId)}catch{}}} style={{left:layout.left,top:layout.top,width:layout.width,maxHeight:layout.height||280}}>
   <div className="tutorial-coach-top"><span><CircleHelp size={15}/>PRACTICE TUTORIAL</span><button type="button" aria-label="Exit practice tutorial" onClick={onExit}><X size={19}/></button></div>
   <p className="tutorial-counter" role="status">{session.complete?'Complete':session.started?`Step ${session.index+1} of ${guide.steps.length}`:'Learn by doing'}</p>
   <h2 id={id+'-title'} tabIndex={-1}>{session.complete?'You did it.':session.started?step.title:guide.title}</h2>
   <p id={id+'-copy'}>{session.complete?'Your practice entries were not saved or sent. Use the same controls when you are ready to make your own.':session.started?step.copy:'Follow the highlighted controls on the real pages. You must try each action to continue. Practice entries will not be added or emailed.'}</p>
   {missing&&<p className="tutorial-help" role="status">This control is not on the current screen. Restart the lesson to return to its beginning.</p>}
   {disabled&&<p className="tutorial-help">This option is unavailable here. You can skip this step.</p>}
   {notice&&<p className="tutorial-help" role="status">{notice}</p>}
   <div className="tutorial-coach-actions">{session.complete?<button type="button" className="button primary" onClick={onFinish}>Finish practice<Check size={16}/></button>:!session.started?<button type="button" className="button primary" onClick={onStart}>Start practice</button>:<><button type="button" className="text-button" disabled={session.index===0} onClick={onBack}><ArrowLeft size={15}/>Back</button>{missing?<button type="button" className="button soft" onClick={onRestart}><RotateCcw size={15}/>Restart lesson</button>:disabled?<button type="button" className="button soft" onClick={onNext}>Skip unavailable option</button>:<button type="button" className="button primary" disabled={!mayContinue||step.action==='save'} onClick={onNext}>{step.action==='read'?'Continue':acted?'Continue':'Try the highlighted control'}</button>}</>}</div>
  </section>
 </div>,document.body);
}
