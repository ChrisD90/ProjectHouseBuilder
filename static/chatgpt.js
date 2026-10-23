/* All ChatGPT access goes through the local Python runtime. No OAuth tokens in JS. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  if (!$('phbChatGPTButton') || !$('phbAIDialog')) return;
  let state={connected:false,sharing:false}, models=[];
  const dialog=$('phbAIDialog');
  const label=$('phbChatGPTLabel');
  const dot=$('phbChatGPTDot');
  const connect=$('phbAIConnect');
  const disconnect=$('phbAIDisconnect');
  const model=$('phbAIModel');
  const message=msg=>{$('phbAIMessage').textContent=msg;};
  async function api(path,method='GET',body){
    const headers={'X-PHB-AI':'1'};
    if (body!==undefined)headers['Content-Type']='application/json';
    const res=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    let data;
    try{data=await res.json();}catch{throw Error('Server-Antwort nicht lesbar.');}
    if (!res.ok)throw Error(data.error||'ChatGPT-Anfrage fehlgeschlagen.');
    return data;
  }
  async function refresh(){
    try {
      state=await api('/api/ai/status');
      $('phbChatGPTLogo').hidden=!state.connected;
      dot.classList.toggle('phb-ai-dot-on',!!state.sharing);
      label.textContent=state.connected?(state.sharing?'ChatGPT verbunden':'ChatGPT: Berechtigung fehlt'):'ChatGPT verbinden';
      $('phbAIConnection').textContent=state.connected
        ? 'Verbunden: '+(state.email||'ChatGPT-Konto')+(state.sharing?' · Plannutzung erlaubt':' · Plannutzung nicht erlaubt')
        : 'Nicht verbunden. Die lokale PDF-Analyse funktioniert weiterhin.';
      connect.textContent=state.connected?'Erneut bei ChatGPT anmelden':'Mit ChatGPT anmelden';
      disconnect.hidden=!state.connected;
      $('phbAIModelWrap').hidden=!state.sharing;
      models=[];model.innerHTML='';
      if(state.sharing){
        try{const r=await api('/api/ai/models');models=r.models||[];
          model.innerHTML=models.map(x=>{
            const opt=document.createElement('option');opt.value=x.slug;opt.textContent=x.name;return opt.outerHTML;
          }).join('');
          if(!models.length)message('Für dieses Konto sind derzeit keine KI-Modelle verfügbar.');
        }catch(e){message(e.message);}
      }
    }catch(e){message('Verbindung konnte nicht geprüft werden: '+e.message);}
    document.dispatchEvent(new CustomEvent('phb-ai-status',{detail:state}));
  }
  function selection(){
    if (!state.sharing)throw Error('Bitte zuerst über den Header mit ChatGPT verbinden und die Plannutzung erlauben.');
    if(!$('phbAINoCredits').checked){dialog.showModal();throw Error('Bitte im ChatGPT-Menü erst die Credit-Warnung bestätigen.');}
    if(!model.value)throw Error('Kein ChatGPT-Modell verfügbar. Bitte Verbindung prüfen.');
    return {model:model.value,plan_only:true};
  }
  function show(){dialog.showModal();}
  $('phbChatGPTButton').onclick=show;
  connect.onclick=async()=>{
    connect.disabled=true;
    try{message('Sichere ChatGPT-Anmeldung wird geöffnet …');
      const data=await api('/api/ai/connect','POST',{});
      window.location.assign(data.authorize_url);
    }catch(e){message(e.message);connect.disabled=false;}
  };
  disconnect.onclick=async()=>{
    if(!confirm('ChatGPT-Verbindung lokal trennen und die Sitzung widerrufen?'))return;
    try{const res=await api('/api/ai/disconnect','POST',{});
      $('phbAINoCredits').checked=false;
      await refresh();message(res.warning||'Verbindung getrennt.');
    }catch(e){message(e.message);}
  };
  if(new URLSearchParams(location.search).get('ai')==='permission'){
    setTimeout(()=>{show();message('ChatGPT angemeldet, aber Plannutzung noch nicht erlaubt.');},200);
  }else if(new URLSearchParams(location.search).get('ai')==='error'){
    setTimeout(()=>{show();message('ChatGPT-Anmeldung fehlgeschlagen oder abgebrochen.');},200);
  }
  window.PHBAI={selection,show,refresh,connected:()=>state.sharing};
  refresh();
})();
