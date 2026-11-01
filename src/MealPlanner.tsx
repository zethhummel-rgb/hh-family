import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,ChefHat,ChevronLeft,ChevronRight,Plus,Search,ShoppingBasket,Utensils,X} from 'lucide-react';
import {shiftDay} from './calendarData';
import {adjacentWeek,overviewRange,type OverviewMode} from './weekOverview';
import type {MealPlan,SavedMeal} from './mealPlannerData';
import type {useMealPlanner} from './useMealPlanner';
import './meal-planner.css';

export type MealState=ReturnType<typeof useMealPlanner>;
type OpenPlan=(plan:MealPlan,opener:HTMLElement)=>void;
type AddPlan=(date:string,opener:HTMLElement)=>void;
const dateLabel=(date:string,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',...options}).format(new Date(date+'T12:00:00Z'));
function ready(state:MealState,from:string,to:string){return !!state.loadedRange&&state.loadedRange.from<=from&&state.loadedRange.to>=to}
function LoadNotice({state}:{state:MealState}){return state.error?<div className="meal-error" role="alert"><p>Meal plans couldn’t be refreshed. {state.error}</p><button className="text-button" type="button" disabled={state.loading} onClick={()=>void state.refresh()}>Try again</button></div>:null}

export function MealPreview({state,today,onOpenPlan,onAdd,onAll}:{state:MealState;today:string;onOpenPlan:OpenPlan;onAdd:AddPlan;onAll:()=>void}){
 const available=ready(state,today,shiftDay(today,1)),dinner=available?state.plans.find(plan=>plan.meal_date===today):undefined;
 return <section className="card meal-preview" aria-labelledby="meal-preview-title"><div className="meal-preview-top"><span className="round-icon peach"><Utensils size={21}/></span><div><p className="meal-eyebrow">AT THE TABLE</p><h2 id="meal-preview-title">Tonight’s dinner</h2></div><button className="text-button" type="button" onClick={onAll}>Plan meals<ArrowRight size={17}/></button></div><LoadNotice state={state}/>
  {!available&&!state.error?<p className="quiet" role="status">Loading tonight’s plan…</p>:dinner?<button className="meal-tonight" type="button" onClick={event=>onOpenPlan(dinner,event.currentTarget)}><span><b>{dinner.title}</b><small>{dinner.ingredients.length?`${dinner.ingredients.length} ${dinner.ingredients.length===1?'ingredient':'ingredients'} · Open for the details`:'A little less deciding at dinner time.'}</small></span><ArrowRight size={18}/></button>:!state.error&&<div className="meal-tonight-empty"><p>A favourite meal, leftovers, or an evening out.</p><button type="button" className="text-button" onClick={event=>onAdd(today,event.currentTarget)}><Plus size={16}/>Plan dinner</button></div>}
 </section>;
}

type Props={state:MealState;today:string;onBack:()=>void;onAdd:AddPlan;onOpenPlan:OpenPlan;onAddRecipe:(opener:HTMLElement)=>void;onOpenRecipe:(recipe:SavedMeal,opener:HTMLElement)=>void;onShop:(plans:MealPlan[],opener:HTMLElement)=>void};
export default function MealPlanner({state,today,onBack,onAdd,onOpenPlan,onAddRecipe,onOpenRecipe,onShop}:Props){
 const [section,setSection]=useState<'plan'|'saved'>('plan'),[mode,setMode]=useState<OverviewMode>('upcoming'),[anchor,setAnchor]=useState(today),[query,setQuery]=useState('');
 const heading=useRef<HTMLHeadingElement>(null),{start,end,days}=overviewRange(anchor,today,mode),available=ready(state,start,end);
 useEffect(()=>{heading.current?.focus({preventScroll:true})},[]);
 useEffect(()=>state.onRange(start,end),[start,end,state.onRange]);
 const plans=available?state.plans.filter(plan=>plan.meal_date>=start&&plan.meal_date<end):[];
 const saved=useMemo(()=>{const needle=query.trim().toLocaleLowerCase();return state.savedMeals.filter(meal=>!needle||meal.title.toLocaleLowerCase().includes(needle)||meal.ingredients.some(ingredient=>ingredient.title.toLocaleLowerCase().includes(needle))).sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id))},[state.savedMeals,query]);
 function navigate(direction:-1|1){setAnchor(adjacentWeek(anchor,today,mode,direction));setMode('week')}
 const label=dateLabel(start,{month:'short',day:'numeric',year:start.slice(0,4)!==end.slice(0,4)?'numeric':undefined})+' – '+dateLabel(shiftDay(end,-1),{month:'short',day:'numeric',year:'numeric'});
 return <section className="meal-planner" aria-label="Meal planner"><button type="button" className="text-button meal-back" onClick={onBack}><ArrowLeft size={16}/>Back to Home</button>
  <div className="meal-page-heading"><div><p className="meal-eyebrow">A LITTLE LESS “WHAT’S FOR DINNER?”</p><h1 ref={heading} tabIndex={-1}>Meals, together.</h1><p>Simple plans. Familiar favourites. One shared list.</p></div><span className="meal-heading-art" aria-hidden="true"><ChefHat size={31}/></span></div>
  <div className="meal-sections" role="group" aria-label="Meal planner view"><button type="button" aria-pressed={section==='plan'} onClick={()=>setSection('plan')}><Utensils size={16}/>Plan week</button><button type="button" aria-pressed={section==='saved'} onClick={()=>setSection('saved')}><BookOpen size={16}/>Saved meals</button></div>
  {section==='plan'?<>
   <div className="meal-range"><div><h2>{mode==='upcoming'?'Next 7 days':'This week’s table'}</h2><p aria-live="polite">{label}</p></div><div className="meal-navigation"><button type="button" className="icon-button" aria-label="Previous meal week" onClick={()=>navigate(-1)}><ChevronLeft size={20}/></button><button type="button" className="meal-current" disabled={mode==='upcoming'} onClick={()=>{setAnchor(today);setMode('upcoming')}}>Next 7 days</button><button type="button" className="icon-button" aria-label="Next meal week" onClick={()=>navigate(1)}><ChevronRight size={20}/></button></div></div>
   <p className="meal-range-help">{mode==='upcoming'?'Today first, then the next six days.':'Sunday to Saturday.'} A dinner name is enough to get started.</p><LoadNotice state={state}/>
   {!available&&!state.error&&<p className="quiet" role="status">Loading meals for these dates…</p>}
   <div className="meal-days">{days.map(date=>{const plan=plans.find(item=>item.meal_date===date);return <article key={date} className={'meal-day'+(date===today?' is-today':'')+(date<today?' is-past':'')}><div className="meal-day-date"><span>{dateLabel(date,{weekday:'short'})}</span><b>{Number(date.slice(-2))}</b>{date===today&&<em>Today</em>}</div><div className="meal-day-content"><h3>{dateLabel(date,{weekday:'long',month:'short',day:'numeric'})}</h3>{plan?<button type="button" className="meal-day-plan" aria-label={'Read dinner '+plan.title} onClick={event=>onOpenPlan(plan,event.currentTarget)}><span><b>{plan.title}</b><small>{plan.ingredients.length?`${plan.ingredients.length} ${plan.ingredients.length===1?'ingredient':'ingredients'}`:'Dinner is decided.'}</small></span><ChevronRight size={17}/></button>:available&&!state.error?<button type="button" className="meal-day-add" aria-label={'Add dinner on '+dateLabel(date,{weekday:'long',month:'long',day:'numeric'})} onClick={event=>onAdd(date,event.currentTarget)}><Plus size={16}/>Add dinner<span>Keep it simple.</span></button>:<p className="meal-day-pending">{state.error?'Plan unavailable':'Loading…'}</p>}</div></article>})}</div>
   <div className="meal-shopping-card"><span className="round-icon sage"><ShoppingBasket size={22}/></span><div><h2>From plans to the pantry.</h2><p>Choose the ingredients you need for these dates.</p></div><button type="button" className="button primary" disabled={!available||!!state.error||!plans.some(plan=>plan.ingredients.length)} onClick={event=>onShop(plans,event.currentTarget)}><ShoppingBasket size={16}/>Shop ingredients</button></div>
   <p className="meal-footnote">Meal plans are shared with your household. Groceries are added only when you choose them.</p>
  </>:<>
   <div className="meal-library-heading"><div><h2>Your familiar favourites</h2><p>Save a meal once, bring it back whenever you like.</p></div><button type="button" className="button primary" onClick={event=>onAddRecipe(event.currentTarget)}><Plus size={16}/>Save a meal</button></div>
   <label className="meal-search"><Search size={18}/><input type="search" aria-label="Search saved meals" placeholder="Find a meal or ingredient…" value={query} onChange={event=>setQuery(event.target.value)}/>{query&&<button type="button" className="icon-button" aria-label="Clear meal search" onClick={()=>setQuery('')}><X size={16}/></button>}</label>
   {state.savedError&&<div className="meal-error" role="alert"><p>Saved meals couldn’t be refreshed. {state.savedError}</p><button className="text-button" type="button" disabled={state.savedLoading} onClick={()=>void state.refresh()}>Try again</button></div>}
   {!state.savedLoaded&&!state.savedError&&<p className="quiet" role="status">Loading saved meals…</p>}
   <div className="meal-library">{saved.map(meal=><button type="button" className="meal-recipe-card" key={meal.id} onClick={event=>onOpenRecipe(meal,event.currentTarget)} aria-label={'Read saved meal '+meal.title}><span className="meal-recipe-icon"><BookOpen size={21}/></span><span><b>{meal.title}</b><small>{meal.ingredients.length?`${meal.ingredients.length} ${meal.ingredients.length===1?'ingredient':'ingredients'}`:'Ready for another evening'}{meal.instructions?' · Cooking notes':''}</small></span><ChevronRight size={17}/></button>)}</div>
   {state.savedLoaded&&!state.savedError&&!saved.length&&<div className="meal-empty"><ChefHat size={34}/><h3>{query?'No meals match yet.':'The meals you come back to.'}</h3><p>{query?'Try another meal name or ingredient.':'A family recipe or an easy weeknight favourite. Start with its name; add details whenever you need them.'}</p><button type="button" className="text-button" onClick={event=>query?setQuery(''):onAddRecipe(event.currentTarget)}>{query?'Clear search':'Save your first meal'}<ArrowRight size={16}/></button></div>}
  </>}
 </section>;
}
