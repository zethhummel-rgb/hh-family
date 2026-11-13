import {dateObj,shiftDay} from './calendarData';

export type CalendarHoliday = {name:string; shortName?:string};

// Oudin's Gregorian Easter calculation, as published by the US Naval Observatory.
function easterSunday(year:number){
 const whole=Math.trunc;
 const century=whole(year/100);
 const lunarYear=year%19;
 const correction=whole((century-17)/25);
 const moon=(century-whole(century/4)-whole((century-correction)/3)+19*lunarYear+15)%30;
 const adjustedMoon=moon-whole(moon/28)*(1-whole(moon/28)*whole(29/(moon+1))*whole((21-lunarYear)/11));
 const weekday=(year+whole(year/4)+adjustedMoon+2-century+whole(century/4))%7;
 const offset=adjustedMoon-weekday;
 const month=3+whole((offset+40)/44);
 const day=offset+28-31*whole(month/4);
 return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function mondayOnOrAfter(date:string){
 return shiftDay(date,(8-dateObj(date).getDay())%7);
}

/** Canadian and Ontario holiday dates, with a few familiar observances. */
export function calendarHolidays(year:number):ReadonlyMap<string,CalendarHoliday>{
 const easter=easterSunday(year);
 return new Map<string,CalendarHoliday>([
  [`${year}-01-01`,{name:'New Year’s Day',shortName:'New Year'}],
  ...(year>=2008?[[mondayOnOrAfter(`${year}-02-15`),{name:'Family Day'}] as const]:[]),
  [shiftDay(easter,-2),{name:'Good Friday'}],
  [easter,{name:'Easter Sunday',shortName:'Easter'}],
  [shiftDay(easter,1),{name:'Easter Monday'}],
  [mondayOnOrAfter(`${year}-05-18`),{name:'Victoria Day'}],
  [`${year}-07-01`,{name:'Canada Day'}],
  [mondayOnOrAfter(`${year}-08-01`),{name:'Civic Holiday'}],
  [mondayOnOrAfter(`${year}-09-01`),{name:'Labour Day'}],
  ...(year>=2021?[[`${year}-09-30`,{name:'National Day for Truth and Reconciliation',shortName:'Truth & Reconciliation'}] as const]:[]),
  [mondayOnOrAfter(`${year}-10-08`),{name:'Thanksgiving'}],
  [`${year}-11-11`,{name:'Remembrance Day'}],
  [`${year}-12-24`,{name:'Christmas Eve'}],
  [`${year}-12-25`,{name:'Christmas Day',shortName:'Christmas'}],
  [`${year}-12-26`,{name:'Boxing Day'}],
  [`${year}-12-31`,{name:'New Year’s Eve'}],
 ]);
}
