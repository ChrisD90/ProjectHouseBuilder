/* Scope each document independently; never use a shared active-project cookie. */
(()=>{
 const current=Number(new URLSearchParams(location.search).get('project_id')||location.pathname.match(/^\/p\/(\d+)/)?.[1]||1);
 const appRoutes=new Set(['/','/kosten','/angebote','/belege','/finanzierung','/energieplanung','/stammdaten','/dokumente','/daten','/aufgaben']);
 const urlFor=value=>{const url=new URL(value,location.href);if(url.origin!==location.origin)return value;if(url.pathname.startsWith('/api/'))url.searchParams.set('project_id',String(current));else if(appRoutes.has(url.pathname))url.pathname='/p/'+current+url.pathname;else return value;return url.pathname+url.search+url.hash;};
 window.PHBProject={id:current,url:urlFor};
 function fix(node){if(!(node instanceof Element))return;for(const element of [node,...node.querySelectorAll('a[href],iframe[src],img[src]')]){const attr=element.matches('a[href]')?'href':element.matches('iframe[src],img[src]')?'src':null;if(!attr||element.hasAttribute('data-project-global'))continue;const value=element.getAttribute(attr);if(!value||!value.startsWith('/'))continue;if(attr==='src'&&!value.startsWith('/api/'))continue;const next=urlFor(value);if(next!==value)element.setAttribute(attr,next);}}
 const observer=new MutationObserver(records=>{for(const record of records){if(record.type==='attributes')fix(record.target);else for(const node of record.addedNodes)fix(node);}});
 const start=()=>{fix(document.documentElement);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href','src']});};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
