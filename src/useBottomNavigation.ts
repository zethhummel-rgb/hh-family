import {useEffect} from 'react';

// Safari's visible viewport can move independently as its browser controls or
// keyboard open. Anchor the body-level menu to that viewport, not page content.
export function useBottomNavigation(){
 useEffect(()=>{
  let frame=0;
  const viewport=window.visualViewport;
  const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   const bottom=viewport?Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop):0;
   document.documentElement.style.setProperty('--hh-navigation-bottom',`${bottom}px`);
  })};
  update();viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);
  window.addEventListener('resize',update);window.addEventListener('scroll',update,{passive:true});window.addEventListener('pageshow',update);
  return()=>{cancelAnimationFrame(frame);viewport?.removeEventListener('resize',update);viewport?.removeEventListener('scroll',update);window.removeEventListener('resize',update);window.removeEventListener('scroll',update);window.removeEventListener('pageshow',update);document.documentElement.style.removeProperty('--hh-navigation-bottom')};
 },[]);
}
