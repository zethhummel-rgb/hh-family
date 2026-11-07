export function householdName(value:string){
 const name=value.trim().replace(/^(?:the\s+)+/i,'').trim();
 if(!name||name.toLowerCase()==='the')throw Error('Enter your family or household name after “The”.');
 if(name.length>76)throw Error('Keep your household name within 80 characters, including “The”.');
 return 'The '+name;
}
