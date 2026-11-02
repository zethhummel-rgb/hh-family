import {useCallback,useEffect,useRef,useState} from 'react';
import {dayKey} from './calendarData';
import {upcomingRange} from './weekOverview';
import {addMealIngredients,deleteMealPlan,deleteSavedMeal,loadMealPlans,loadSavedMeals,saveMealPlan,saveSavedMeal,sortMealPlans,sortSavedMeals,type MealContentDraft,type MealIngredientSelection,type MealPlan,type MealPlanDraft,type SavedMeal} from './mealPlannerData';

type Range={from:string;to:string};
type PlanState={householdId:string;range:Range;plans:MealPlan[];loading:boolean;error:string;loadedRange:Range|null};
type RecipeState={householdId:string;savedMeals:SavedMeal[];savedLoaded:boolean;savedLoading:boolean;savedError:string};
const initialRange=():Range=>{const range=upcomingRange(dayKey(new Date()));return {from:range.start,to:range.end}};
const sameRange=(a:Range,b:Range)=>a.from===b.from&&a.to===b.to;
const emptyPlans=(householdId:string,range:Range):PlanState=>({householdId,range,plans:[],loading:true,error:'',loadedRange:null});
const emptyRecipes=(householdId:string):RecipeState=>({householdId,savedMeals:[],savedLoaded:false,savedLoading:true,savedError:''});
const message=(error:unknown)=>error instanceof Error?error.message:(error as {message?:string})?.message||'Could not load your meals.';

export function useMealPlanner(householdId:string){
 const [requested,setRequested]=useState(()=>({householdId,...initialRange()}));
 const range=requested.householdId===householdId?{from:requested.from,to:requested.to}:initialRange();
 const rangeRef=useRef(range);rangeRef.current=range;
 const [planState,setPlanState]=useState(()=>emptyPlans(householdId,range));
 const [recipeState,setRecipeState]=useState(()=>emptyRecipes(householdId));
 const mounted=useRef(false),scope=useRef({householdId,epoch:0}),planGeneration=useRef(0),recipeGeneration=useRef(0);
 if(scope.current.householdId!==householdId)scope.current={householdId,epoch:scope.current.epoch+1};
 const isCurrent=useCallback((epoch:number)=>mounted.current&&scope.current.householdId===householdId&&scope.current.epoch===epoch,[householdId]);

 const refreshPlans=useCallback(async()=>{
  if(!mounted.current||scope.current.householdId!==householdId)return;
  const target={...rangeRef.current},epoch=scope.current.epoch,generation=++planGeneration.current;
  setPlanState(old=>({...((old.householdId===householdId&&sameRange(old.range,target))?old:emptyPlans(householdId,target)),loading:true}));
  try{
   const plans=await loadMealPlans(householdId,target.from,target.to);
   if(isCurrent(epoch)&&generation===planGeneration.current&&sameRange(target,rangeRef.current))setPlanState({householdId,range:target,plans,loading:false,error:'',loadedRange:target});
  }catch(error){if(isCurrent(epoch)&&generation===planGeneration.current&&sameRange(target,rangeRef.current))setPlanState(old=>({...((old.householdId===householdId&&sameRange(old.range,target))?old:emptyPlans(householdId,target)),loading:false,error:message(error)}))}
 },[householdId,isCurrent]);
 const refreshRecipes=useCallback(async()=>{
  if(!mounted.current||scope.current.householdId!==householdId)return;
  const epoch=scope.current.epoch,generation=++recipeGeneration.current;
  setRecipeState(old=>({...((old.householdId===householdId)?old:emptyRecipes(householdId)),savedLoading:true}));
  try{const savedMeals=await loadSavedMeals(householdId);if(isCurrent(epoch)&&generation===recipeGeneration.current)setRecipeState({householdId,savedMeals,savedLoaded:true,savedLoading:false,savedError:''})}
  catch(error){if(isCurrent(epoch)&&generation===recipeGeneration.current)setRecipeState(old=>({...((old.householdId===householdId)?old:emptyRecipes(householdId)),savedLoading:false,savedError:message(error)}))}
 },[householdId,isCurrent]);
 const refresh=useCallback(async()=>{await Promise.all([refreshPlans(),refreshRecipes()])},[refreshPlans,refreshRecipes]);
 const onRange=useCallback((from:string,to:string)=>{
  rangeRef.current={from,to};
  setRequested(old=>old.householdId===householdId&&old.from===from&&old.to===to?old:{householdId,from,to});
 },[householdId]);
 useEffect(()=>{
  mounted.current=true;setRequested(old=>old.householdId===householdId?old:{householdId,...initialRange()});setRecipeState(emptyRecipes(householdId));void refreshRecipes();
  const reload=()=>{if(!document.hidden)void refresh()};
  const timer=setInterval(reload,30000);window.addEventListener('focus',reload);window.addEventListener('online',reload);
  return()=>{mounted.current=false;scope.current.epoch++;planGeneration.current++;recipeGeneration.current++;clearInterval(timer);window.removeEventListener('focus',reload);window.removeEventListener('online',reload)};
 },[householdId,refresh,refreshRecipes]);
 useEffect(()=>{void refreshPlans()},[householdId,range.from,range.to,refreshPlans]);

 const savePlan=useCallback(async(draft:MealPlanDraft,current?:MealPlan|null,requestId?:string)=>{
  const epoch=scope.current.epoch,saved=await saveMealPlan(householdId,draft,current,requestId);
  if(isCurrent(epoch)){
   planGeneration.current++;const target={...rangeRef.current};
   setPlanState(old=>{
    const previous=old.householdId===householdId&&sameRange(old.range,target)?old:emptyPlans(householdId,target),existing=previous.plans.find(plan=>plan.id===saved.id);
    const next=existing&&existing.version>saved.version?previous.plans:[...previous.plans.filter(plan=>plan.id!==saved.id),...(saved.meal_date>=target.from&&saved.meal_date<target.to?[saved]:[])];
    return {...previous,loading:false,plans:sortMealPlans(next)};
   });void refreshPlans();
  }
  return saved;
 },[householdId,isCurrent,refreshPlans]);
 const removePlan=useCallback(async(current:MealPlan)=>{
  const epoch=scope.current.epoch;await deleteMealPlan(householdId,current);
  if(isCurrent(epoch)){planGeneration.current++;setPlanState(old=>old.householdId===householdId?{...old,loading:false,plans:old.plans.filter(plan=>plan.id!==current.id)}:old);void refreshPlans()}
 },[householdId,isCurrent,refreshPlans]);
 const saveRecipe=useCallback(async(draft:MealContentDraft,current?:SavedMeal|null)=>{
  const epoch=scope.current.epoch,saved=await saveSavedMeal(householdId,draft,current);
  if(isCurrent(epoch)){
   recipeGeneration.current++;
   setRecipeState(old=>{const previous=old.householdId===householdId?old:emptyRecipes(householdId),existing=previous.savedMeals.find(meal=>meal.id===saved.id);return {...previous,savedLoading:false,savedMeals:sortSavedMeals(existing&&existing.version>saved.version?previous.savedMeals:[...previous.savedMeals.filter(meal=>meal.id!==saved.id),saved])}});
   void refreshRecipes();
  }
  return saved;
 },[householdId,isCurrent,refreshRecipes]);
 const removeRecipe=useCallback(async(current:SavedMeal)=>{
  const epoch=scope.current.epoch;await deleteSavedMeal(householdId,current);
  if(isCurrent(epoch)){recipeGeneration.current++;setRecipeState(old=>old.householdId===householdId?{...old,savedLoading:false,savedMeals:old.savedMeals.filter(meal=>meal.id!==current.id)}:old);void refreshRecipes()}
 },[householdId,isCurrent,refreshRecipes]);
 const addIngredients=useCallback((selections:MealIngredientSelection[])=>addMealIngredients(householdId,selections),[householdId]);
 const plans=planState.householdId===householdId&&sameRange(planState.range,range)?planState:emptyPlans(householdId,range);
 const recipes=recipeState.householdId===householdId?recipeState:emptyRecipes(householdId);
 return {...plans,...recipes,householdId,range,onRange,refresh,savePlan,removePlan,saveRecipe,removeRecipe,addIngredients};
}
export type MealPlannerState=ReturnType<typeof useMealPlanner>;
