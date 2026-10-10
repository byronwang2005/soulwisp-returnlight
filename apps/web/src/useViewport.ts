import {useEffect} from 'react';

export function useViewport(){
  useEffect(()=>{
    const viewport=window.visualViewport;
    const fit=()=>{
      // Use the keyboard-reduced visual viewport without reflowing the page on pinch zoom.
      const height=viewport&&Math.abs(viewport.scale-1)<.01?viewport.height:window.innerHeight;
      document.documentElement.style.setProperty('--viewport-height',`${Math.max(1,Math.floor(height))}px`);
    };
    fit();window.addEventListener('resize',fit);viewport?.addEventListener('resize',fit);
    return()=>{window.removeEventListener('resize',fit);viewport?.removeEventListener('resize',fit);document.documentElement.style.removeProperty('--viewport-height');};
  },[]);
}
