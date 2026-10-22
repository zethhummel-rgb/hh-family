type Store=Pick<Storage,'getItem'|'setItem'>;
const key=(userId:string,householdId:string)=>`hh:notification-prompt:v1:${userId}:${householdId}`;
const handledInSession=new Set<string>();
export function notificationPromptHandled(userId:string,householdId:string,storage?:Store){
 const id=key(userId,householdId);
 if(handledInSession.has(id))return true;
 try{return (storage??localStorage).getItem(id)==='handled'}catch{return false}
}
export function finishNotificationPrompt(userId:string,householdId:string,storage?:Store){
 const id=key(userId,householdId);handledInSession.add(id);
 try{(storage??localStorage).setItem(id,'handled')}catch{/* Keep dismissal for this app session. */}
}
export function canOfferNotifications({installed,supported,permission,handled,enabled}:{installed:boolean;supported:boolean;permission:NotificationPermission;handled:boolean;enabled:boolean}){
 return installed&&supported&&permission!=='denied'&&!handled&&!enabled;
}
