/* Default PDF viewer hints only; originals and download URLs are unchanged. */
(()=>{
 'use strict';if(window.PHBPDF)return;
 function fitWidth(value){
  if(!value||value==='about:blank')return value;
  const [base,...fragment]=String(value).split('#'),params=new URLSearchParams(fragment.join('#'));
  if(params.has('zoom')||params.has('view'))return value;
  params.set('view','FitH');params.set('zoom','page-width');return base+'#'+params;
 }
 function decorate(root){
  if(!(root instanceof Element))return;
  const frames=root.matches('iframe[src],a[href]')?[root]:root.querySelectorAll('iframe[src],a[href]');
  for(const frame of frames){const attr=frame.matches('a')?'href':'src';if(attr==='href'&&(frame.hasAttribute('download')||frame.target!=='_blank'))continue;const source=frame.getAttribute(attr);if(!source)continue;
   try{const url=new URL(source,location.href);if(url.origin!==location.origin||!url.pathname.startsWith('/api/')||!(/preview|\/document$|\.pdf$/i.test(url.pathname)))continue;
    const fitted=fitWidth(source);if(fitted!==source)frame.setAttribute(attr,fitted);
   }catch(_){}
  }
 }
 window.PHBPDF={fitWidth};
 const start=()=>{decorate(document.documentElement);new MutationObserver(changes=>{for(const change of changes){if(change.type==='attributes')decorate(change.target);else for(const node of change.addedNodes)decorate(node);}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href']});};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
