import {ArrowRight,CalendarPlus,RefreshCw} from 'lucide-react';
import {useId} from 'react';

export default function CalendarSetupChoices({onChoose,disabled}:{
 onChoose:(calendar:'new'|'existing')=>void;disabled:boolean;
}){
 const id=useId();
 const description='Both options sync two ways. Add, edit, or delete events in either HH or Google.';
 const options=[
  {
   calendar:'new' as const,Icon:CalendarPlus,
   title:'Create an HH calendar in Google',
   description:'Start with your HH plans in a new Google calendar dedicated to your household.'
  },
  {
   calendar:'existing' as const,Icon:RefreshCw,
   title:'Use an existing Google calendar',
   description:'Bring events from a Google calendar you already use into HH and keep both calendars in sync.'
  }
 ];
 return <div className="calendar-setup-options" role="group" aria-label="Two-way Google Calendar sync" aria-describedby={id}>
  <p id={id}>{description}</p>
  {options.map(({calendar,Icon,title,description})=><button type="button" className="calendar-setup-option"
   key={calendar} aria-labelledby={id+calendar} aria-describedby={id+calendar+'-description'} disabled={disabled} onClick={()=>onChoose(calendar)}>
   <Icon size={19} aria-hidden="true"/>
   <span><strong id={id+calendar}>{title}</strong><small id={id+calendar+'-description'}>{description}</small></span>
   <ArrowRight size={17} aria-hidden="true"/>
  </button>)}
 </div>;
}
