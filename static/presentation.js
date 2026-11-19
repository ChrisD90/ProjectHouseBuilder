/* Shared browser presentation. Stored values and form submissions stay canonical. */
(() => {
 'use strict';
 if(typeof window==='undefined'||typeof document==='undefined')return;
 if(window.PHBDisplay)return;
 const KEY='phb-display-settings-v1',defaults={language:'de',dateFormat:'de',currencyDisplay:'symbol',unitDisplay:'short'};
 const normalize=value=>({language:'de',dateFormat:['de','iso','slash'].includes(value?.dateFormat)?value.dateFormat:'de',currencyDisplay:value?.currencyDisplay==='code'?'code':'symbol',unitDisplay:value?.unitDisplay==='long'?'long':'short'});
 let settings=defaults;try{settings=normalize(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch(_){}
 const read=()=>{try{settings=normalize(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch(_){}return settings;};
 const parseDate=value=>{
  if(value instanceof Date)return value;
  const text=String(value||'');return /^\d{4}-\d{2}-\d{2}$/.test(text)?new Date(text+'T12:00:00'):new Date(text);
 };
 const date=(value,options)=>{
  if(!value)return '';const d=parseDate(value);if(!Number.isFinite(d.getTime()))return String(value);
  if(options&&(options.month==='long'||options.month==='short'||options.weekday))return new Intl.DateTimeFormat('de-DE',options).format(d);
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return settings.dateFormat==='iso'?`${y}-${m}-${day}`:settings.dateFormat==='slash'?`${day}/${m}/${y}`:`${day}.${m}.${y}`;
 };
 const dateTime=value=>{const d=parseDate(value);return Number.isFinite(d.getTime())?date(d)+' '+new Intl.DateTimeFormat('de-DE',{hour:'2-digit',minute:'2-digit'}).format(d):String(value||'');};
 const number=(value,options={})=>new Intl.NumberFormat('de-DE',options).format(Number(value)||0);
 const money=(value,currency='EUR')=>new Intl.NumberFormat('de-DE',{style:'currency',currency,currencyDisplay:settings.currencyDisplay}).format(Number(value)||0);
 const units={'mm':'Millimeter','cm':'Zentimeter','m':'Meter','km':'Kilometer','m²':'Quadratmeter','m³':'Kubikmeter','cm²':'Quadratzentimeter','mm²':'Quadratmillimeter','cm³':'Kubikzentimeter','mm³':'Kubikmillimeter','m2':'Quadratmeter','m3':'Kubikmeter','kg':'Kilogramm','g':'Gramm','l':'Liter','L':'Liter','Std.':'Stunden','h':'Stunden','Stk.':'Stück','Stk':'Stück','lfm':'laufende Meter'};
 const unit=value=>settings.unitDisplay==='long'?(units[value]||value):value;
 const unitPattern=/(?<![\p{L}_])(cm²|mm²|cm³|mm³|m²|m³|m2|m3|Stk\.|Stk|lfm|mm|cm|km|kg|Std\.|m|g|l|L|h)(?![\p{L}\p{N}_])/gu;
 const label=value=>String(value??'').replace(unitPattern,match=>unit(match)).replace(/€|\bEUR\b/g,()=>settings.currencyDisplay==='code'?'EUR':'€');
 const text=value=>label(String(value).replace(/(?<![\p{L}\p{N}_/\-])(?:(\d{4})-(\d{2})-(\d{2})|(\d{2})[./](\d{2})[./](\d{4}))(?![\p{L}\p{N}_/\-]|\.[\p{L}\p{N}])/gu,(match,y,m,d,day,month,year)=>{
  const iso=y?`${y}-${m}-${d}`:`${year}-${month}-${day}`,parsed=parseDate(iso);
  return Number.isFinite(parsed.getTime())&&parsed.getFullYear()===Number(y||year)&&parsed.getMonth()+1===Number(m||month)&&parsed.getDate()===Number(d||day)?date(iso):match;
 }));
 const originals=new WeakMap(),dateStyles=new WeakMap();let queued=false;
 function decorateDate(input){
  let previous=dateStyles.get(input);if(!previous){previous={color:input.style.color,backgroundImage:input.style.backgroundImage,backgroundRepeat:input.style.backgroundRepeat,backgroundPosition:input.style.backgroundPosition};dateStyles.set(input,previous);}
  Object.assign(input.style,previous);
  if(document.activeElement===input||!input.value)return;
  const tone=getComputedStyle(input).color;
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="190" height="24"><text x="0" y="17" font-family="Arial,sans-serif" font-size="14" fill="'+tone+'">'+date(input.value)+'</text></svg>';
  input.style.color='transparent';input.style.backgroundImage='url("data:image/svg+xml,'+encodeURIComponent(svg)+'")';input.style.backgroundRepeat='no-repeat';input.style.backgroundPosition='12px center';
 }
 let companies=new Map();
 function orderCompanies(){
  for(const select of document.querySelectorAll('select')){
   if((!/company|contractor/i.test(select.id+' '+select.name)&&!(select.id==='bulkValue'&&document.getElementById('bulkField')?.value==='contractor_id'))||select.multiple)continue;
   const options=Array.from(select.options),known=options.filter(o=>companies.has(Number(o.value))&&/^\d+$/.test(o.value));
   if(!known.length)continue;
   for(const option of known){const clean=option.textContent.replace(/^★\s*/,'');const text=(companies.get(Number(option.value)).favorite?'★ ':'')+clean;if(option.textContent!==text)option.textContent=text;}
   known.sort((a,b)=>Number(companies.get(Number(b.value)).favorite)-Number(companies.get(Number(a.value)).favorite)||a.textContent.replace(/^★\s*/,'').localeCompare(b.textContent.replace(/^★\s*/,''),'de',{sensitivity:'base'}));
   const desired=options.map(o=>companies.has(Number(o.value))&&/^\d+$/.test(o.value)?known.shift():o),value=select.value;
   if(desired.some((o,i)=>o!==options[i])){select.replaceChildren(...desired);select.value=value;}
  }
 }
 function refresh(){
  queued=false;
  if(!document.body)return;
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.parentElement?.closest('script,style,textarea,input,code,pre,[contenteditable="true"],[data-phb-raw]')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  let node;while((node=walker.nextNode())){
   if(!node.data.trim())continue;
   // An option without a value attribute derives its submitted value from its
   // text. Use its display-only label instead, so unit/date preferences can
   // never change the value submitted by an existing native form.
   const option=node.parentElement?.closest('option');
   if(option&&!option.hasAttribute('value')){const shown=text(node.data);if(option.label!==shown)option.label=shown;continue;}
   let record=originals.get(node);if(!record||record.last!==node.data)record={raw:node.data,last:node.data};
   const result=text(record.raw);if(result!==node.data)node.data=result;record.last=result;originals.set(node,record);
  }
  document.querySelectorAll('input[type="date"]').forEach(decorateDate);orderCompanies();
 }
 const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(refresh);}};
 function changed(){read();schedule();window.dispatchEvent(new Event('phb-display-change'));}
 function set(value){settings=normalize({...settings,...value});try{localStorage.setItem(KEY,JSON.stringify(settings));}catch(_){}
  changed();for(const frame of document.querySelectorAll('iframe')){try{frame.contentWindow.dispatchEvent(new Event('phb-display-reload'));}catch(_){}}
 }
 async function loadCompanies(){
  const id=Number(new URLSearchParams(location.search).get('project_id')||location.pathname.match(/^\/p\/(\d+)/)?.[1]||1);
  try{const response=await fetch('/api/contractors/preferences?project_id='+id,{headers:{'X-PHB-Project':String(id)}});if(response.ok){const data=await response.json();companies=new Map(data.companies.map(c=>[c.id,c]));schedule();}}catch(_){}
 }
 window.PHBDisplay={get:()=>({...settings}),snapshot:()=>JSON.stringify(settings),set,date,dateTime,number,money,unit,label,
  companyOptions:(rows,labelFor)=>[...rows].sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite)||String(a.name||a.title).localeCompare(String(b.name||b.title),'de',{sensitivity:'base'})).map(c=>({value:String(c.id),label:(c.favorite?'★ ':'')+(labelFor?labelFor(c):c.name||c.title)})),
  refresh:schedule,reloadCompanies:loadCompanies};
 window.addEventListener('storage',e=>{if(e.key===KEY)changed();});window.addEventListener('phb-display-reload',changed);window.addEventListener('phb-company-favorites',loadCompanies);
 document.addEventListener('input',e=>{if(e.target.matches?.('input[type="date"]'))decorateDate(e.target);});
 document.addEventListener('focusin',e=>{if(e.target.matches?.('input[type="date"]'))decorateDate(e.target);});
 document.addEventListener('focusout',e=>{if(e.target.matches?.('input[type="date"]'))schedule();});
 const start=()=>{const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-mantine-color-scheme','data-phb-theme']});observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['value','open','data-mantine-color-scheme','data-phb-theme']});schedule();loadCompanies();};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
