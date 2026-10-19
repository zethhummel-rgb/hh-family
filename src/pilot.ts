export const PILOT_INVITE_KEY='hh:pilot-invite';
export const FAMILY_INVITE_KEY='hh:family-invite';
export function invitationFrom(params:URLSearchParams,storedPilot='',storedFamily=''){
 // An explicit link always takes precedence over an older invitation on this device.
 if(params.has('invite'))return {pilot:'',family:params.get('invite')||''};
 if(params.has('pilot'))return {pilot:params.get('pilot')||'',family:''};
 return {pilot:storedPilot,family:storedFamily};
}
export function invitationRedirect(base:string,pilot:string,family:string){const url=new URL(base);url.search='';url.hash='';if(family)url.searchParams.set('invite',family);else if(pilot)url.searchParams.set('pilot',pilot);return url.href}
