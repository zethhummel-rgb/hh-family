export const groceryNameKey=(title:string)=>title.trim().toLowerCase().replace(/\s+/g,' ');
type NamedGrocery={id:string;title:string;done:boolean|number;kind?:string};
export function matchingGroceries<T extends NamedGrocery>(items:T[],title:string,excludedIds:string[]=[]):T[]{
 const key=groceryNameKey(title);
 return key?items.filter(item=>!item.done&&(!item.kind||item.kind==='grocery')&&!excludedIds.includes(item.id)&&groceryNameKey(item.title)===key):[];
}
