/* Shared visual preferences and truthful async feedback. No external dependencies. */
(() => {
  'use strict';
  const key='phb-color-mode-v1';
  const root=document.documentElement;
  const system=window.matchMedia('(prefers-color-scheme: dark)');
  let mode='system';
  try {const stored=localStorage.getItem(key);if(['light','dark','system'].includes(stored))mode=stored;}catch(_){}
  const selectedTheme=()=>mode==='system'?(system.matches?'dark':'light'):mode;
  function applyTheme(){
    root.dataset.phbTheme=selectedTheme();
    root.style.colorScheme=selectedTheme();
    const chooser=document.getElementById('phbThemeMode');
    if(chooser)chooser.value=mode;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',selectedTheme()==='dark'?'#111c29':'#f5f8fa');
  }
  applyTheme();
  if(typeof system.addEventListener==='function')system.addEventListener('change',()=>{if(mode==='system')applyTheme();});
  function setTheme(next){
    if(!['system','light','dark'].includes(next))return;
    mode=next;
    try{localStorage.setItem(key,next);}catch(_){}
    applyTheme();
  }
  const nativeFetch=window.fetch.bind(window);
  let lastAction=null,lastActionAt=0;
  let active=0;
  let seq=0,shown=false;
  const inflight=new Map();
  let topIndicator,overlay,titleNode,overlayText,screenStatus;
  const buttonCounts=new WeakMap();
  const labelFor=(path,method,form)=>{
    if(path.includes('/api/ai/schedule/chat'))return 'ChatGPT prüft deine Bauzeitenplanung …';
    if(path.includes('/api/ai/schedule'))return 'ChatGPT erstellt deinen Bauzeitenplan …';
    if(path.includes('/api/ai/offers/compare'))return 'ChatGPT vergleicht die Angebote …';
    if(path.includes('/api/ai/'))return 'ChatGPT verarbeitet deine Anfrage …';
    if(path.includes('/api/financing/loans/ai/extract'))return 'ChatGPT liest die Kreditunterlagen …';
    if(path.includes('/api/receipts')&&method==='POST'&&!/\/book|\/unbook/.test(path)){
      return form?.get?.('analysis_mode')==='ai'?'ChatGPT prüft deine Rechnung …':'Rechnung wird lokal analysiert …';
    }
    if(path.includes('/api/offers')&&method==='POST'&&form?.has?.('file')){
      return form.get('analysis_mode')==='ai'?'ChatGPT analysiert das Angebot …':'Angebots-PDF wird analysiert …';
    }
    if(path.includes('/api/backup'))return 'Projektsicherung wird geprüft und erstellt …';
    if(path.includes('/documents')&&method==='POST')return 'Dokument wird gespeichert …';
    if(path.includes('/api/tasks/initialize'))return 'Arbeitsschritte werden angelegt …';
    if(method!=='GET')return 'Änderungen werden verarbeitet …';
    return 'Projektinformationen werden geladen …';
  };
  function classify(url,method,form){
    const expensive=/\/api\/ai\/|\/api\/financing\/loans\/ai\/extract|\/api\/backup\/(manual|create)|\/api\/tasks\/initialize|\/api\/tasks\/clear/.test(url);
    const upload=method==='POST'&&form instanceof FormData&&form.has('file');
    return {long:expensive||upload,message:labelFor(url,method,form)};
  }
  function update(){
    if(!topIndicator)return;
    topIndicator.hidden=!shown;
    if(overlay){
      const entries=[...inflight.values()].filter(x=>x.visible&&x.long);
      overlay.hidden=!entries.length;
      if(entries.length){
        const mostRecent=entries[entries.length-1];
        overlayText.textContent=mostRecent.message;
        titleNode.textContent=/Sicherung/.test(mostRecent.message)
          ?'Backup wird erstellt'
          :/ChatGPT/.test(mostRecent.message)
            ?'ChatGPT bearbeitet deine Anfrage'
            :/Rechnung|Angebot|Dokument|Datei/.test(mostRecent.message)
              ?'Dokument wird verarbeitet'
              :'Vorgang wird bearbeitet';
      }
    }
    if(screenStatus)screenStatus.textContent=active>0?
      (active===1?'Eine Anfrage wird bearbeitet.':active+' Anfragen werden bearbeitet.'):'Bereit';
    document.body?.classList.toggle('phb-network-busy',shown);
  }
  function markButton(button,yes){
    if(!button||!button.isConnected||!(button instanceof HTMLButtonElement))return;
    const count=buttonCounts.get(button)||0;
    const next=Math.max(0,count+(yes?1:-1));
    buttonCounts.set(button,next);
    if(next)button.setAttribute('data-phb-busy','true');
    else button.removeAttribute('data-phb-busy');
    if(next)button.setAttribute('aria-busy','true');
    else button.removeAttribute('aria-busy');
  }
  function start(info){
    const id=++seq;
    const btn=(Date.now()-lastActionAt<1200&&lastAction?.isConnected)?lastAction:null;
    const state={...info,visible:false,button:btn};
    inflight.set(id,state);active++;
    const delay=info.long?130:320;
    state.timer=setTimeout(()=>{
      if(!inflight.has(id))return;
      state.visible=true;shown=true;
      markButton(btn,true);
      update();
    },delay);
    return id;
  }
  function end(id){
    const state=inflight.get(id);
    if(!state)return;
    clearTimeout(state.timer);
    inflight.delete(id);active=Math.max(0,active-1);
    if(state.visible)markButton(state.button,false);
    shown=[...inflight.values()].some(x=>x.visible);
    update();
  }
  document.addEventListener('click',e=>{
    const button=e.target.closest?.('button');
    if(button&&!button.disabled){lastAction=button;lastActionAt=Date.now();}
  },true);
  document.addEventListener('submit',e=>{
    if(e.submitter){lastAction=e.submitter;lastActionAt=Date.now();}
  },true);
  window.fetch=(input,init)=> {
    let pathname='',method='GET',form;
    try{
      const request=input instanceof Request?input:null;
      const raw=request?request.url:String(input);
      const url=new URL(raw,location.href);
      if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))
        return nativeFetch(input,init);
      pathname=url.pathname;
      method=(init?.method||request?.method||'GET').toUpperCase();
      form=init?.body;
    }catch(_){return nativeFetch(input,init);}
    const id=start(classify(pathname,method,form));
    try{
      const result=nativeFetch(input,init);
      return Promise.resolve(result).finally(()=>end(id));
    }catch(error){end(id);throw error;}
  };
  function setup(){
    const select=document.getElementById('phbThemeMode');
    if(select){select.value=mode;select.addEventListener('change',()=>setTheme(select.value));}
    topIndicator=document.getElementById('phbLoadTrack');
    overlay=document.getElementById('phbBusyOverlay');
    titleNode=document.getElementById('phbBusyTitle');
    overlayText=document.getElementById('phbBusyMessage');
    screenStatus=document.getElementById('phbBusyStatus');
    update();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
  else setup();

  // Native <dialog> instead of blocking browser confirm/alert/prompt.
  async function ask(message,{title='Bitte bestätigen',confirm='Bestätigen',cancel=true,initial}={}){
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='phb-messagebox';
      const heading=document.createElement('h2');heading.textContent=title;
      const paragraph=document.createElement('p');paragraph.textContent=String(message);
      const actions=document.createElement('div');actions.className='phb-messagebox-actions';
      dialog.append(heading,paragraph);
      let field;
      if(initial!==undefined){
        field=document.createElement('input');field.type='text';field.value=String(initial);
        field.setAttribute('aria-label','Eingabe');dialog.append(field);
      }
      if(cancel){
        const cancelButton=document.createElement('button');cancelButton.textContent='Abbrechen';cancelButton.type='button';
        cancelButton.onclick=()=>dialog.close('cancel');actions.append(cancelButton);
      }
      const acceptButton=document.createElement('button');acceptButton.textContent=confirm;acceptButton.type='button';acceptButton.className='primary';
      acceptButton.onclick=()=>{dialog._answer=field?field.value:true;dialog.close('accept');};
      actions.append(acceptButton);dialog.append(actions);document.body.append(dialog);
      dialog.addEventListener('close',()=>{
        const result=dialog.returnValue==='accept'?dialog._answer:(field?null:false);
        dialog.remove();resolve(result);
      },{once:true});
      dialog.showModal();(field||acceptButton).focus();
    });
  }
  const currencyNames=new Set([
    'amount','gross','net','vat','gross_amount','net_amount','vat_amount',
    'unit_price','optional_amount','labor_amount','paid_amount','advance_deduction',
    'estimate','offer','committed','paid','own_hourly','expected','confirmed','received',
    'principal','monthly_payment','opening_balance','reserve'
  ]);
  function isMoneyField(input){
    return input instanceof HTMLInputElement &&
      (input.dataset.euro==='true'||(currencyNames.has(input.name)&&input.dataset.euro!=='false'));
  }
  function parseMoney(raw){
    if(typeof raw==='number')return raw;
    const input=String(raw??'').trim().replace(/\s/g,'');
    if(!input)return null;
    if(!/^[0-9.,]+$/.test(input))return NaN;
    const normalized=input.includes(',')
      ?input.replace(/\./g,'').replace(',','.')
      :/^\d{1,3}(?:\.\d{3})+$/.test(input)?input.replace(/\./g,''):input;
    const num=Number(normalized);
    return Number.isFinite(num)?num:NaN;
  }
  const formatMoney=amount=>amount==null||amount===''?''
    :new Intl.NumberFormat('de-DE',{minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(amount));
  function moneyEdit(input){
    const old=input.value,caret=input.selectionStart??old.length;
    const digitCount=(old.slice(0,caret).match(/\d/g)||[]).length;
    const clean=old.replace(/[^0-9,]/g,'');
    const commaIndex=clean.indexOf(',');
    const integer=(commaIndex<0?clean:clean.slice(0,commaIndex)).replace(/^0+(?=\d)/,'');
    const decimals=commaIndex<0?'':clean.slice(commaIndex+1).replace(/,/g,'').slice(0,2);
    const formatted=integer.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+
      (commaIndex<0?'':','+decimals);
    input.value=formatted;
    let pos=0,count=0;
    while(pos<formatted.length&&count<digitCount){
      if(/\d/.test(formatted[pos]))count++;
      pos++;
    }
    if(commaIndex>=0&&caret>old.indexOf(','))pos=Math.max(pos,formatted.indexOf(',')+1);
    input.setSelectionRange(pos,pos);
  }
  function prepareCurrency(input){
    if(!isMoneyField(input))return;
    if(input.type==='number'){input.type='text';input.inputMode='decimal';input.removeAttribute('step');input.removeAttribute('min');}
    input.dataset.phbCurrency='true';
    const n=parseMoney(input.value);
    if(input.value!==''&&Number.isFinite(n))input.value=formatMoney(n);
  }
  function normalizeMoneyForm(form){
    for(const field of form.querySelectorAll('input')){
      if(!isMoneyField(field))continue;
      const n=parseMoney(field.value);
      if(field.value.trim()!==''&&!Number.isFinite(n))throw Error('Ungültiger Euro-Betrag: '+(field.name||'Eingabe'));
      field.value=n==null?'':String(n);
    }
  }
  document.addEventListener('focusin',e=>{
    if(isMoneyField(e.target))prepareCurrency(e.target);
  },true);
  document.addEventListener('input',e=>{
    if(isMoneyField(e.target)&&e.target.type==='text')moneyEdit(e.target);
  },true);
  document.addEventListener('focusout',e=>{
    if(isMoneyField(e.target)){const n=parseMoney(e.target.value);if(Number.isFinite(n))e.target.value=formatMoney(n);}
  },true);

  // Shared, opt-in dialog controller. Handles consistent closure, dirty forms,
  // accessible status notices and one pending save per dialog.
  const dialogs={
    init(root=document){
      const managed=[...root.querySelectorAll('dialog[data-phb-dialog]')];
      for(const dialog of managed){
        if(dialog.dataset.phbInitialized==='1')continue;
        dialog.dataset.phbInitialized='1';
        dialog.classList.add('phb-managed-dialog');
        const form=dialog.querySelector('form[data-phb-dirty]');
        let baseline='',busy=false,armed=false,confirming=false;
        const signature=()=>!form?'':JSON.stringify(
          [...form.elements].filter(el=>el.name&&!el.disabled).map(el=>{
            if(el.type==='checkbox'||el.type==='radio')return [el.name,el.checked,el.value];
            if(el.type==='file')return [el.name,[...el.files].map(f=>[f.name,f.size,f.lastModified])];
            return [el.name,el.value];
          }));
        const arm=()=>{baseline=signature();armed=true;};
        const observer=new MutationObserver(()=>{
          if(dialog.open){
            armed=false;queueMicrotask(arm);
          }else{
            armed=false;confirming=false;busy=false;
            dialog.removeAttribute('aria-busy');
          }
        });
        observer.observe(dialog,{attributes:true,attributeFilter:['open']});
        dialog.addEventListener('phb-dialog-saved',arm);
        dialog.addEventListener('phb-dialog-busy',event=>{
          busy=Boolean(event.detail?.busy);
          dialog.setAttribute('aria-busy',String(busy));
        });
        const dirty=()=>armed&&form&&signature()!==baseline;
        const requestClose=async()=>{
          if(busy||confirming)return;
          if(dirty()){
            confirming=true;
            let discard=false;
            try{discard=await ask('Ungespeicherte Änderungen verwerfen?',{
              title:'Änderungen verwerfen?',confirm:'Verwerfen'});}
            finally{confirming=false;}
            if(!discard)return;
          }
          dialog.close();
        };
        // Capture close-button clicks before page-specific onClick callbacks
        // can close a dirty editor without confirmation.
        dialog.addEventListener('click',event=>{
          const button=event.target.closest('[data-phb-close]');
          if(!button||!dialog.contains(button))return;
          if(busy||dirty()){
            event.preventDefault();event.stopImmediatePropagation();
            void requestClose();
          }
        },true);
        dialog.addEventListener('cancel',event=>{
          if(event.defaultPrevented)return;
          if(busy||dirty()){
            event.preventDefault();
            void requestClose();
          }
        });
        dialog.addEventListener('close',()=>{armed=false;});
      }
    },
    busy(dialog,active){
      if(dialog)dialog.dispatchEvent(new CustomEvent('phb-dialog-busy',{
        detail:{busy:Boolean(active)}}));
    },
    saved(dialog){
      if(dialog)dialog.dispatchEvent(new Event('phb-dialog-saved'));
    },
    notice(dialog,message,error=false){
      if(!dialog)return;
      let slot=dialog.querySelector('[data-phb-dialog-notice]');
      if(!slot){
        slot=document.createElement('p');
        slot.dataset.phbDialogNotice='';
        slot.className='phb-dialog-notice';
        slot.setAttribute('role','status');
        const footer=dialog.querySelector('[data-phb-footer]');
        (footer?.parentElement||dialog).insertBefore(slot,footer||null);
      }
      slot.textContent=String(message);
      slot.classList.toggle('is-error',Boolean(error));
    }
  };
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',()=>dialogs.init(),{once:true});
  else dialogs.init();

  window.PHBUI={
    setTheme,currentTheme:selectedTheme,dialogs,
    confirm:message=>ask(message),
    alert:message=>ask(message,{title:'Hinweis',confirm:'OK',cancel:false}),
    prompt:(message,initial='')=>ask(message,{title:'Eingabe',confirm:'Übernehmen',initial}),
    currency:{parse:parseMoney,format:formatMoney,prepare:prepareCurrency,
              normalizeForm:normalizeMoneyForm,bind:root=>root.querySelectorAll('input').forEach(prepareCurrency)}
  };
})();