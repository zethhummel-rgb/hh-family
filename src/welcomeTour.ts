const key=(userId:string,householdId:string)=>`hh:welcome:v1:${userId}:${householdId}`;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function queueWelcome(userId:string,householdId:string,pending?:Store){
 try{(pending??sessionStorage).setItem(key(userId,householdId),'pending')}catch{/* Replay remains available in Tutorials. */}
}
export function welcomePending(userId:string,householdId:string,pending?:Store,seen?:Store){
 try{return (pending??sessionStorage).getItem(key(userId,householdId))==='pending'&&(seen??localStorage).getItem(key(userId,householdId))!=='seen'}catch{return false}
}
export function finishWelcome(userId:string,householdId:string,pending?:Store,seen?:Store){
 try{(pending??sessionStorage).removeItem(key(userId,householdId))}catch{/* Storage may be unavailable. */}
 try{(seen??localStorage).setItem(key(userId,householdId),'seen')}catch{/* Replay remains available in Tutorials. */}
}
