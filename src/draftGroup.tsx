import {createContext,useCallback,useContext,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
type Draft={dirty:boolean;busy:boolean;save:()=>Promise<boolean>;discard:()=>void};
const Context=createContext<ReturnType<typeof useController>|null>(null);
function useController(){
 const entries=useRef(new Map<string,Draft>()),[,refresh]=useState(0),pending=useRef(false);
 const register=useCallback((id:string,draft:Draft)=>{const old=entries.current.get(id);entries.current.set(id,draft);if((old?.dirty||false)!==draft.dirty||(old?.busy||false)!==draft.busy)refresh(v=>v+1)},[]);
 const remove=useCallback((id:string)=>{const old=entries.current.get(id);entries.current.delete(id);if(old?.dirty||old?.busy)refresh(v=>v+1)},[]);
 const saveAll=useCallback(async()=>{if(pending.current)return false;pending.current=true;try{for(const entry of Array.from(entries.current.values()))if(entry.dirty&&!await entry.save())return false;return true}finally{pending.current=false}},[]);
 const discardAll=useCallback(()=>{for(const entry of entries.current.values())if(entry.dirty)entry.discard()},[]);
 return {register,remove,saveAll,discardAll,dirty:Array.from(entries.current.values()).some(v=>v.dirty),busy:Array.from(entries.current.values()).some(v=>v.busy)};
}
export function DraftScope({children}:{children:ReactNode}){const value=useController();return <Context.Provider value={value}>{children}</Context.Provider>}
export function useDraftGroup(){return useContext(Context)}
export function useRegisteredDraft(draft:Draft){
 const group=useContext(Context),id=useId(),latest=useRef(draft);latest.current=draft;
 const entry=useMemo(()=>({get dirty(){return latest.current.dirty},get busy(){return latest.current.busy},save:()=>latest.current.save(),discard:()=>latest.current.discard()}),[]);
 // Store snapshots of the flags so changes are observable even though callbacks stay current.
 useLayoutEffect(()=>{group?.register(id,{...entry,dirty:draft.dirty,busy:draft.busy})});
 useLayoutEffect(()=>()=>group?.remove(id),[group?.remove,id]);
}
