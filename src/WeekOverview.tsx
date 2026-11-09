import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,CalendarDays,ChevronLeft,ChevronRight,Clock,ListChecks,Plus,Repeat2,Utensils} from 'lucide-react';
import PeopleDots from './PeopleDots';
import type {PersonProfile} from './people';
import {eventDate,eventEndDate,eventTime,shiftDay,zonedISO,type FamilyEvent} from './calendarData';
import {reminderWaiting,taskTimeLabel,type ReminderItem} from './taskReminders';
import {adjacentWeek,buildWeekOverview,overviewRange,upcomingRange,type OverviewMode} from './weekOverview';
import {mealTypeLabels,sortMealPlans,type MealPlan} from './mealPlannerData';
import './week-overview.css';

type DataProps={events:FamilyEvent[];items:ReminderItem[];today:string;calendarLoading:boolean;calendarError:string;itemsLoading:boolean;itemsError:string;loadedRange:{from:string;to:string}|null;meals:MealPlan[];mealsError:string;mealsLoadedRange:{from:string;to:string}|null};
const dateLabel=(date:string,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',...options}).format(new Date(date+'T12:00:00Z'));
function rangeLabel(start:string,end:string){return dateLabel(start,{month:'short',day:'numeric',year:start.slice(0,4)!==end.slice(0,4)?'numeric':undefined})+' – '+dateLabel(shiftDay(end,-1),{month:'short',day:'numeric',year:'numeric'})}
function calendarAvailable(props:DataProps,start:string,end:string){return !props.calendarError&&!!props.loadedRange&&props.loadedRange.from<=zonedISO(start)&&props.loadedRange.to>=zonedISO(end)}
function mealsAvailable(props:DataProps,start:string,end:string){return !props.mealsError&&!!props.mealsLoadedRange&&props.mealsLoadedRange.from<=start&&props.mealsLoadedRange.to>=end}

export function WeekPreview(props:DataProps&{onOpen:()=>void}){
 const {start,end}=upcomingRange(props.today),available=calendarAvailable(props,start,end),tasksAvailable=!props.itemsLoading&&!props.itemsError,mealsReady=mealsAvailable(props,start,end);
 const meals=mealsReady?sortMealPlans(props.meals.filter(meal=>meal.meal_date>=start&&meal.meal_date<end)):[];
 const week=buildWeekOverview(available?props.events:[],tasksAvailable?props.items:[],props.today,props.today,'upcoming');
 return <section className="week-preview card" aria-labelledby="week-preview-title"><div className="week-preview-heading"><span className="round-icon sage"><CalendarDays size={21}/></span><div><h2 id="week-preview-title">Next 7 days</h2><p>{rangeLabel(start,end)}</p></div><button type="button" className="text-button" data-tour="home-week" onClick={props.onOpen}>See plans<ArrowRight size={17}/></button></div>
  <div className="week-mini-days" aria-label="Next seven days at a glance">{week.days.map(day=><div key={day.date} className={day.date===props.today?'is-today':''} aria-label={dateLabel(day.date,{weekday:'long',month:'long',day:'numeric'})+(day.date===props.today?', today':'')}><small>{dateLabel(day.date,{weekday:'short'})}</small><b>{Number(day.date.slice(-2))}</b><span className="week-mini-marks">{available&&day.events.length>0&&<i className="week-event-mark" title={`${day.events.length} calendar events`}/>} {tasksAvailable&&day.tasks.length>0&&<i className="week-task-mark" title={`${day.tasks.length} to-dos`}/>} {meals.some(meal=>meal.meal_date===day.date)&&<i className="week-meal-mark" title="Meals planned"/>}</span></div>)}</div>
  <p className="week-preview-counts"><span><i className="week-event-mark"/>{available?`${week.eventCount} ${week.eventCount===1?'event':'events'}`:props.calendarError?'Calendar unavailable':'Loading events…'}</span><span><i className="week-task-mark"/>{tasksAvailable?`${week.taskCount} dated ${week.taskCount===1?'to-do':'to-dos'}`:props.itemsError?'To-dos unavailable':'Loading to-dos…'}</span><span><i className="week-meal-mark"/>{mealsReady?`${meals.length} ${meals.length===1?'meal':'meals'}`:props.mealsError?'Meals unavailable':'Loading meals…'}</span><small>Whole household</small></p>
 </section>;
}

type Props=DataProps&{anchor:string;onAnchor:(date:string)=>void;onRange:(from:string,to:string)=>void;onMealRange:(from:string,to:string)=>void;onBack:()=>void;onRefresh:()=>void;onEvent:(event:FamilyEvent)=>void;onTask:(item:ReminderItem)=>void;onMeal:(meal:MealPlan,opener:HTMLElement)=>void;onAddEvent:(date:string)=>void;onAllTasks:()=>void;onMealPlanner:()=>void;profiles:PersonProfile[]};
export default function WeekOverview(props:Props){
 const [mode,setMode]=useState<OverviewMode>(()=>props.anchor===props.today?'upcoming':'week');
 const {start,end}=overviewRange(props.anchor,props.today,mode),calendarReady=calendarAvailable(props,start,end),tasksReady=!props.itemsLoading&&!props.itemsError,mealsReady=mealsAvailable(props,start,end);
 const meals=mealsReady?sortMealPlans(props.meals.filter(meal=>meal.meal_date>=start&&meal.meal_date<end)):[];
 const week=buildWeekOverview(calendarReady?props.events:[],tasksReady?props.items:[],props.anchor,props.today,mode),heading=useRef<HTMLHeadingElement>(null),initial=useRef(true);
 const current=mode==='upcoming';
 useEffect(()=>{props.onRange(zonedISO(start),zonedISO(end))},[start,end,props.onRange]);
 useEffect(()=>{props.onMealRange(start,end)},[start,end,props.onMealRange]);
 useEffect(()=>{if(initial.current){initial.current=false;heading.current?.focus({preventScroll:true})}},[]);
 function navigate(date:string,nextMode:OverviewMode='week'){setMode(nextMode);props.onAnchor(date);heading.current?.focus({preventScroll:true})}
 const overdue=current?week.overdue:[];
 function when(event:FamilyEvent,date:string){
  if(event.all_day)return 'All day';
  const endTime=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit'}).format(new Date(event.ends_at));
  if(eventDate(event)<date)return eventEndDate(event)===date?'Continues until '+endTime:'Continues';
  return eventTime(event)+(eventEndDate(event)===date?' – '+endTime:' · continues');
 }
 function task(item:ReminderItem){return <button type="button" className="week-plan week-task" key={'task-'+item.id} onClick={()=>props.onTask(item)} aria-label={'Edit to do '+item.title}><span className="week-kind"><ListChecks size={16}/></span><span className="week-plan-copy"><small>To do{item.due<props.today?' · Overdue':''}{reminderWaiting(item,props.today)?' · Next repeat':''}</small><b>{item.title}</b><span className="week-task-meta">{item.person||'Everyone'}{item.reminder_time&&<> · Reminder {taskTimeLabel(item.reminder_time)}</>}{item.repeat_unit&&item.repeat_unit!=='none'&&<Repeat2 size={12} aria-label="Repeating to-do"/>}</span></span><ChevronRight size={15}/></button>}
 return <section className="week-overview" aria-label="Weekly overview">
  <button type="button" className="text-button week-back" onClick={props.onBack}><ArrowLeft size={16}/>Back to Home</button>
  <div className="week-toolbar"><div><h1 ref={heading} tabIndex={-1}>{current?'Next 7 days':'Week overview'}</h1><p aria-live="polite">{rangeLabel(start,end)}</p></div><div className="week-navigation"><button type="button" className="icon-button" aria-label="Previous week" onClick={()=>navigate(adjacentWeek(props.anchor,props.today,mode,-1))}><ChevronLeft size={20}/></button><button type="button" className="week-current" disabled={current} onClick={()=>navigate(props.today,'upcoming')}>Next 7 days</button><button type="button" className="icon-button" aria-label="Next week" onClick={()=>navigate(adjacentWeek(props.anchor,props.today,mode,1))}><ChevronRight size={20}/></button></div></div>
  <p className="week-description">{current?'Today first, then the next six days.':'Sunday to Saturday.'} Everyone’s plans, meals and dated to-dos, in Eastern time.</p>
  {(props.calendarError||props.itemsError||props.mealsError)&&<div className="week-load-error" role="alert"><p>{props.calendarError?'Calendar events could not be loaded. ':''}{props.itemsError?'To-dos could not be loaded. ':''}{props.mealsError?'Meal plans could not be loaded. ':''}The overview may be incomplete.</p><button type="button" className="text-button" onClick={props.onRefresh}>Try again</button></div>}
  {!calendarReady&&!props.calendarError&&<p className="quiet" role="status">Loading events for these dates…</p>}
  {!tasksReady&&!props.itemsError&&<p className="quiet" role="status">Loading to-dos…</p>}
  {!mealsReady&&!props.mealsError&&<p className="quiet" role="status">Loading meal plans…</p>}
  <div className="week-days">{week.days.map(day=><section key={day.date} className={'week-day'+(day.date===props.today?' is-today':'')+(day.date<props.today?' is-past':'')} aria-labelledby={'week-day-'+day.date}>
   <div className="week-day-heading"><div className="week-day-date"><span>{dateLabel(day.date,{weekday:'short'})}</span><b>{Number(day.date.slice(-2))}</b></div><h3 id={'week-day-'+day.date}>{dateLabel(day.date,{weekday:'long',month:'short',day:'numeric'})}{day.date===props.today&&<em>Today</em>}</h3><button type="button" className="icon-button" aria-label={'Add event on '+dateLabel(day.date,{weekday:'long',month:'long',day:'numeric'})} onClick={()=>props.onAddEvent(day.date)}><Plus size={19}/></button></div>
   <div className="week-day-plans">{day.events.map(event=><button type="button" className="week-plan" key={'event-'+event.id} onClick={()=>props.onEvent(event)} aria-label={'View event '+event.title}><span className="week-kind"><CalendarDays size={16}/></span><span className="week-plan-copy"><small>{when(event,day.date)}</small><b>{event.title}</b><PeopleDots event={event} profiles={props.profiles}/>{event.location&&<span className="week-location">{event.location}</span>}</span><ChevronRight size={15}/></button>)}{meals.filter(meal=>meal.meal_date===day.date).map(meal=><button type="button" className="week-plan week-meal" key={'meal-'+meal.id} aria-label={'View '+mealTypeLabels[meal.meal_type]+' '+meal.title} onClick={event=>props.onMeal(meal,event.currentTarget)}><span className="week-kind"><Utensils size={16}/></span><span className="week-plan-copy"><small>{mealTypeLabels[meal.meal_type]} · Whole household</small><b>{meal.title}</b></span><ChevronRight size={15}/></button>)}{day.tasks.map(task)}{calendarReady&&tasksReady&&mealsReady&&!day.events.length&&!day.tasks.length&&!meals.some(meal=>meal.meal_date===day.date)&&<p className="week-open-day">A little room to breathe.</p>}</div>
  </section>)}</div>
  {tasksReady&&overdue.length>0&&<details className="week-overdue"><summary><Clock size={16}/>{overdue.length} earlier overdue {overdue.length===1?'to-do':'to-dos'}</summary>{overdue.map(item=><div key={item.id}><small className="week-old-date">Due {dateLabel(item.due,{month:'short',day:'numeric',year:'numeric'})}</small>{task(item)}</div>)}</details>}
  <p className="week-footnote">Repeating to-dos show their next saved due date. Complete them in To Do &amp; Reminders to schedule the following one. Undated to-dos stay on your list.</p><div className="week-footer-actions"><button type="button" className="text-button week-all-tasks" onClick={props.onAllTasks}>Open all to-dos<ArrowRight size={16}/></button><button type="button" className="text-button week-all-tasks" onClick={props.onMealPlanner}>Open meal planner<Utensils size={16}/></button></div>
 </section>;
}
