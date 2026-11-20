import {ArrowRight,CalendarPlus,RefreshCw} from 'lucide-react';
import {useId} from 'react';

export type CalendarSetupMode='share'|'two-way';

export default function CalendarSetupChoices({provider,heading,onChoose,disabled}:{
 provider:'Google'|'Outlook';heading:string;onChoose:(mode:CalendarSetupMode)=>void;disabled:boolean;
}){
 const id=useId();
 const options=[
  {
   mode:'share' as const,Icon:CalendarPlus,
   title:'Send HH events to '+provider,
   description:provider==='Google'?'Create a dedicated calendar in Google for your HH plans.':
    'Show your HH plans in Outlook. New events made in Outlook stay there.'
  },
  {
   mode:'two-way' as const,Icon:RefreshCw,
   title:'Use both HH and '+provider,
   description:provider==='Google'?'Bring in a Google calendar you already use and manage its plans from either app.':
    'Add plans in either app. Use a calendar you already have or create one for HH.'
  }
 ];
 return <div className="calendar-setup-options" role="group" aria-label={heading}>
  <p>{heading}</p>
  {options.map(({mode,Icon,title,description})=><button type="button" className="calendar-setup-option"
   key={mode} aria-labelledby={id+mode} aria-describedby={id+mode+'-description'} disabled={disabled} onClick={()=>onChoose(mode)}>
   <Icon size={19} aria-hidden="true"/>
   <span><strong id={id+mode}>{title}</strong><small id={id+mode+'-description'}>{description}</small></span>
   <ArrowRight size={17} aria-hidden="true"/>
  </button>)}
 </div>;
}
