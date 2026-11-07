import type {MealIngredient} from './mealPlannerData';
export type ShoppingTotal=MealIngredient&{lines:number};
export function totalMealIngredients(ingredients:MealIngredient[]):ShoppingTotal[]{
 const groups=new Map<string,ShoppingTotal>();
 for(const item of ingredients){const key=JSON.stringify([item.title.trim().toLowerCase().replace(/\s+/g,' '),(item.unit||'').trim().toLowerCase(),item.quantity==null]);const found=groups.get(key);if(found){found.lines++;if(found.quantity!=null&&item.quantity!=null)found.quantity=(Math.round(found.quantity*1000)+Math.round(item.quantity*1000))/1000}else groups.set(key,{...item,title:item.title.trim(),unit:item.unit?.trim()||null,lines:1})}
 return [...groups.values()];
}
