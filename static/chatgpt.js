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
  const check=$('phbAINoCredits');
  const warning=check.closest('label');
  let consentSaving=false;
  const aiFlow=PHBFlow.manage({
    dialog:'phbAIDialog',
    dismiss:[dialog.querySelector('.phb-ai-close')],
    isBusy:()=>consentSaving,track:false
  });
  const message=msg=>{$('phbAIMessage').textContent=msg;};
  const diagnosticBox=document.createElement('details');
  diagnosticBox.className='phb-ai-diagnostics';
  diagnosticBox.hidden=true;
  const diagnosticSummary=document.createElement('summary');
  diagnosticSummary.textContent='Technische Details anzeigen';
  const diagnosticContent=document.createElement('pre');
  diagnosticContent.className='phb-ai-diagnostics-content';
  diagnosticBox.append(diagnosticSummary,diagnosticContent);
  $('phbAIMessage').insertAdjacentElement('afterend',diagnosticBox);
  let diagnosticSource=null;

  function showDiagnostics(source){
    diagnosticSource=source;
    diagnosticBox.open=false;
    diagnosticBox.hidden=false;
    diagnosticContent.textContent='Zum Laden der Details aufklappen.';
  }
  function clearDiagnostics(){
    diagnosticSource=null;
    diagnosticBox.open=false;
    diagnosticBox.hidden=true;
    diagnosticContent.textContent='';
  }
  function formatDiagnostics(diag){
    const flags=diag.checks||{};
    const flag=(key)=>flags[key]===true?'Ja':flags[key]===false?'Nein':'Unbekannt';
    return [
      'Referenz: '+(diag.reference||'—'),
      'Fehlerphase: '+(diag.phase||'Unbekannt'),
      'Fehlercode: '+(diag.code||'callback_failed'),
      'Ursache: '+(diag.explanation||'Keine Details verfügbar.'),
      '',
      'Rückrufprüfungen:',
      'Autorisierungscode vorhanden: '+flag('code_received'),
      'OAuth-State vorhanden: '+flag('state_received'),
      'Client-ID vorhanden: '+flag('client_id_received'),
      'Lokale Browsersitzung vorhanden: '+flag('browser_session_available'),
      'ChatGPT-Plannutzung im Rückruf: '+flag('plan_scope_in_callback'),
      '',
      'Aus Sicherheitsgründen werden keine Zugangscodes, Tokens oder vollständigen Callback-URLs angezeigt.'
    ].join('\n');
  }
  diagnosticBox.addEventListener('toggle',async()=>{
    if(!diagnosticBox.open)return;
    const source=diagnosticSource;
    if(source==='callback'){
      diagnosticContent.textContent='Diagnose wird geladen …';
      try{
        const response=await api('/api/ai/diagnostics');
        if(diagnosticBox.open&&diagnosticSource===source){
          diagnosticContent.textContent=response.available
            ?formatDiagnostics(response.diagnostic||{})
            :'Keine gespeicherte Diagnose vorhanden. Bitte Anmeldung erneut durchführen.';
        }
      }catch(e){
        if(diagnosticBox.open&&diagnosticSource===source){
          diagnosticContent.textContent='Diagnose konnte nicht geladen werden: '+e.message;
        }
      }
    }else if(source){
      diagnosticContent.textContent=source;
    }
  });
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
      check.checked=!!state.credits_acknowledged;
      check.disabled=!!state.credits_acknowledged || !state.sharing;
      warning.hidden=!!state.credits_acknowledged;
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
    }catch(e){message('Verbindung konnte nicht geprüft werden: '+e.message);showDiagnostics('Schritt: Verbindungsstatus prüfen\nUrsache: '+e.message);}
    document.dispatchEvent(new CustomEvent('phb-ai-status',{detail:state}));
  }
  function selection(){
    if (!state.sharing)throw Error('Bitte zuerst über den Header mit ChatGPT verbinden und die Plannutzung erlauben.');
    if(!state.credits_acknowledged){if(!dialog.open)aiFlow.open();throw Error('Bitte die Credit-Warnung einmalig nach der Anmeldung bestätigen.');}
    if(!model.value)throw Error('Kein ChatGPT-Modell verfügbar. Bitte Verbindung prüfen.');
    return {model:model.value,plan_only:true};
  }
  check.addEventListener('change',async()=>{
    if(!check.checked||state.credits_acknowledged||consentSaving)return;
    consentSaving=true;check.disabled=true;
    try{
      await api('/api/ai/acknowledge-credits','POST',{acknowledged:true});
      await refresh();
      message('Einmalige Bestätigung sicher gespeichert. Bei der nächsten Nutzung ist kein erneutes Häkchen nötig.');
    }catch(error){check.checked=false;check.disabled=false;message(error.message);}
    finally{consentSaving=false;}
  });
  function show(){if(!dialog.open)dialog.showModal();}
  $('phbChatGPTButton').onclick=show;
  connect.onclick=async()=>{
    connect.disabled=true;
    try{clearDiagnostics();message('Sichere ChatGPT-Anmeldung wird geöffnet …');
      const data=await api('/api/ai/connect','POST',{});
      window.location.assign(data.authorize_url);
    }catch(e){message(e.message);showDiagnostics('Schritt: Anmeldung starten\nUrsache: '+e.message);connect.disabled=false;}
  };
  disconnect.onclick=async()=>{
    if(!await PHBUI.confirm('ChatGPT-Verbindung lokal trennen und die Sitzung widerrufen?'))return;
    try{const res=await api('/api/ai/disconnect','POST',{});
      check.checked=false;
      await refresh();message(res.warning||'Verbindung getrennt.');
    }catch(e){message(e.message);}
  };
  if(new URLSearchParams(location.search).get('ai')==='connected'){
    setTimeout(async()=>{
      await refresh();
      if(!state.credits_acknowledged){
        show();
        message('ChatGPT ist verbunden. Bitte die Credit-Warnung jetzt einmalig für dieses Konto bestätigen.');
      }
    },200);
  }else if(new URLSearchParams(location.search).get('ai')==='permission'){
    setTimeout(()=>{show();message('ChatGPT angemeldet, aber Plannutzung noch nicht erlaubt.');},200);
  }else if(new URLSearchParams(location.search).get('ai')==='error'){
    setTimeout(()=>{show();message('ChatGPT-Anmeldung fehlgeschlagen. Die technischen Details kannst du bei Bedarf aufklappen.');showDiagnostics('callback');},200);
  }
  window.PHBAI={selection,show,refresh,connected:()=>state.sharing};
  refresh();
})();
