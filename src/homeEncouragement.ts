// Original, household-neutral messages. Rotate by Eastern calendar day.
const messages=[
 'Small moments can make a lovely day.',
 'You don’t have to do it all to make today count.',
 'A little kindness goes a long way.',
 'There’s room for a little joy today.',
 'One small step is still a step forward.',
 'The everyday moments are part of the good stuff.',
 'Take a breath. You can begin again.',
 'A shared laugh can brighten an ordinary day.',
 'Make a little space for something you enjoy.',
 'You bring something good to this day.',
 'Progress can be quiet, too.',
 'A kind word might be someone’s favourite moment.',
 'Some days, showing up is plenty.',
 'A little fresh air, a little fresh perspective.',
 'You deserve the kindness you give to others.',
 'Good things can start small.',
 'There’s no perfect way to have a good day.',
 'Leave a little room for an unexpected smile.',
 'One thing at a time is a perfectly good pace.',
 'A little encouragement can change a whole afternoon.',
 'Rest is part of moving forward.',
 'Today has room for a new favourite memory.',
 'The small things you do with care matter.',
 'Let something simple make you smile today.',
 'You’re allowed to enjoy the little wins.',
 'A warm hello can be a bright beginning.',
 'There is good in taking things slowly.',
 'A small moment of togetherness can mean a lot.',
 'Your best today can look different from yesterday.',
 'Make a little time for what makes you laugh.',
 'Ordinary days can hold lovely surprises.',
];
export function homeEncouragement(date:Date){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const get=(type:string)=>Number(parts.find(part=>part.type===type)!.value);
 const day=Math.floor(Date.UTC(get('year'),get('month')-1,get('day'))/86400000);
 return messages[((day%messages.length)+messages.length)%messages.length];
}
