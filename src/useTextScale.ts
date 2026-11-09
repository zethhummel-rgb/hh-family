import {useLayoutEffect} from 'react';
export function useTextScale(){
 useLayoutEffect(()=>{
  const probe=document.createElement('span');
  probe.setAttribute('aria-hidden','true');probe.style.cssText='position:fixed;left:-10000px;top:0;width:1em;height:1em;font-size:1rem;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  const update=()=>document.documentElement.toggleAttribute('data-large-text',probe.getBoundingClientRect().width>22);
  const observer=new ResizeObserver(update);observer.observe(probe);update();
  return()=>{observer.disconnect();probe.remove();document.documentElement.removeAttribute('data-large-text')};
 },[]);
}
