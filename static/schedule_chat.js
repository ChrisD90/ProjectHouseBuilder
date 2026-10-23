/* Conversational Gantt planning. Never apply a model response without explicit consent. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = $('aiScheduleChatPanel');
  if (!panel) return;
  let history = [];
  let taskCount = 0;
  let connected = false;
  let pendingId = null;
  let busy = false;
  const fieldLabel = {
    name:'Arbeitsschritt',phase:'Bauphase',trade:'Gewerk',
    execution_type:'Ausführung',duration:'Dauer (Tage)',
    lag_days:'Abstand (Tage)',predecessors:'Vorgänger',
    earliest_start:'Frühester Beginn',notes:'Notizen',
    status:'Status',progress:'Fortschritt (%)',
    start:'Projektstart',code:'ID',Arbeitspaket:'Arbeitspaket'
  };
  const desc = value => {
    if (value === undefined || value === null || value === '') return '–';
    if (Array.isArray(value)) return value.join(', ') || 'Keine';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };
  const formatTime = iso => {
    try {return new Intl.DateTimeFormat('de-DE',{dateStyle:'medium',timeStyle:'short',
      timeZone:'Europe/Berlin'}).format(new Date(iso));}catch{return iso;}
  };
  const status = message => {$('scheduleChatStatus').textContent = message;};
  async function request(url,method='GET',body) {
    const options = {method,headers:{'X-PHB-AI':'1'}};
    if (body !== undefined) {
      options.headers['Content-Type']='application/json';
      options.body=JSON.stringify(body);
    }
    const res=await fetch(url,options);
    let result;
    try {result=await res.json();} catch {throw Error('Antwort vom Server nicht lesbar.');}
    if (!res.ok) throw Error(result.error||'Anfrage fehlgeschlagen.');
    return result;
  }
  function make(tag,cls,text) {
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=text;
    return el;
  }
  function showChanges(changes,container) {
    container.replaceChildren();
    for (const op of changes) {
      const action=op.action;
      const header=(action==='add'?'Neu':action==='remove'?'Entfernen':'Ändern')+
        ': '+op.code+' · '+(op.name||'Arbeitspaket');
      const item=make('article','schedule-diff-item');
      item.append(make('strong','',header));
      if(op.changes?.length){
        const list=make('ul','');
        for(const field of op.changes) {
          const name=fieldLabel[field.field]||field.field;
          list.append(make('li','',name+': '+desc(field.before)+' → '+desc(field.after)));
        }
        item.append(list);
      }
      container.append(item);
    }
    if(!changes.length)container.append(make('p','','Keine Änderungen vorgeschlagen.'));
  }
  function renderPreview(id,preview) {
    pendingId=id;
    $('scheduleChatPreview').hidden=false;
    $('scheduleChatPreviewIntro').textContent=preview.length+
      ' Änderungen geplant. Bitte jeden Arbeitsschritt und seine Abhängigkeiten prüfen. Ohne Freigabe bleibt der Bauzeitenplan unverändert.';
    showChanges(preview,$('scheduleChatChangeList'));
    $('scheduleChatInput').disabled=true;
    $('scheduleChatSend').disabled=true;
    status('Vorschlag offen. Bitte übernehmen oder verwerfen, bevor du fortfährst.');
  }
  function clearPreview() {
    pendingId=null;
    $('scheduleChatPreview').hidden=true;
    $('scheduleChatChangeList').replaceChildren();
    $('scheduleChatInput').disabled=false;
    $('scheduleChatSend').disabled=false;
  }
  function renderHistory() {
    const container=$('scheduleHistoryEntries');
    container.replaceChildren();
    $('scheduleHistoryCount').textContent=history.length+
      (history.length===1?' Eintrag':' Einträge');
    if(!history.length) {
      container.append(make('p','schedule-history-empty',
        'Noch keine Entscheidungen oder Änderungen protokolliert.'));
      return;
    }
    for(const item of history) {
      const article=make('article','schedule-history-entry');
      const heading=make('div','schedule-history-heading');
      heading.append(make('strong','',item.kind+' · '+item.status));
      heading.append(make('time','',formatTime(item.created_at)));
      article.append(heading);
      if(item.request)article.append(make('p','schedule-history-request','Besprochen: '+item.request));
      if(item.decision)article.append(make('p','schedule-history-decision',
        'Entscheidung: '+item.decision));
      if(item.answer)article.append(make('p','',item.answer));
      const changes=Array.isArray(item.changes)?item.changes:
        Array.isArray(item.changes?.preview)?item.changes.preview:[];
      if(changes.length){
        const fold=make('details','schedule-history-diff');
        fold.append(make('summary','',changes.length+
          (changes.length===1?' betroffener Arbeitsschritt':' betroffene Arbeitsschritte')+
          ' – Details ansehen'));
        const holder=make('div','schedule-change-list');
        showChanges(changes,holder);
        fold.append(holder);article.append(fold);
      }
      container.append(article);
    }
  }
  function renderConversation() {
    const container=$('scheduleChatMessages');
    container.replaceChildren();
    const turns=history.filter(x=>x.kind==='KI'&&
      ['Besprochen','Vorschlag','Umgesetzt','Verworfen','Veraltet','Abgelaufen','Ersetzt'].includes(x.status))
      .slice(0,12).reverse();
    if(!turns.length) {
      container.append(make('p','schedule-chat-intro',
        'Beispiel: „Wir möchten die Deckenheizung selbst verlegen und vorher die Elektroinstallation abschließen.“'));
    }
    for(const turn of turns) {
      if(turn.request){
        const user=make('div','schedule-chat-bubble schedule-chat-user');
        user.append(make('span','schedule-chat-author','Deine Nachricht · '+formatTime(turn.created_at)));
        user.append(make('p','',turn.request));container.append(user);
      }
      if(turn.answer){
        const assistant=make('div','schedule-chat-bubble schedule-chat-assistant');
        assistant.append(make('span','schedule-chat-author','ChatGPT · '+turn.status));
        assistant.append(make('p','',turn.answer));
        if(turn.decision)assistant.append(make('small','',
          'Entscheidung: '+turn.decision));
        container.append(assistant);
      }
    }
    container.scrollTop=container.scrollHeight;
    const outstanding=history.find(x=>x.kind==='KI'&&x.status==='Vorschlag'&&
      (Array.isArray(x.changes?.preview)||Array.isArray(x.changes)));
    if(outstanding&&taskCount)renderPreview(outstanding.id,
      Array.isArray(outstanding.changes)?outstanding.changes:outstanding.changes.preview);
    else clearPreview();
  }
  async function loadHistory() {
    const data=await request('/api/schedule/history');
    history=data.history||[];
    renderHistory();
    renderConversation();
  }
  function visibility() {
    panel.hidden = !(taskCount>0 && connected);
  }
  document.addEventListener('phb-schedule-updated',event=>{
    taskCount=event.detail.taskCount;
    visibility();
  });
  document.addEventListener('phb-ai-status',event=>{
    connected=Boolean(event.detail?.sharing);
    visibility();
  });
  $('scheduleHistoryDetails').addEventListener('toggle',()=>{
    if($('scheduleHistoryDetails').open)loadHistory().catch(e=>status(e.message));
  });
  $('scheduleChatForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy||pendingId!==null)return;
    const message=$('scheduleChatInput').value.trim();
    if(message.length<3){status('Bitte beschreibe kurz dein Vorhaben.');return;}
    let selection;
    try {selection=window.PHBAI?.selection();
      if(!selection)throw Error('Bitte zuerst ChatGPT verbinden.');
    } catch (e){status(e.message);return;}
    busy=true;
    const button=$('scheduleChatSend');button.disabled=true;
    status('ChatGPT gleicht die Entscheidung mit dem aktuellen Bauzeitenplan ab …');
    try {
      const data=await request('/api/ai/schedule/chat','POST',{
        ...selection,message
      });
      $('scheduleChatInput').value='';
      await loadHistory();
      if(data.requires_approval){
        renderPreview(data.id,data.preview||[]);
        status('Vorschlag zur Prüfung erstellt. Noch nichts im Plan geändert.');
      }else{
        status('Antwort dokumentiert. Keine Änderungen am Bauzeitenplan.');
      }
    }catch(e){status(e.message);}
    finally{busy=false;if(pendingId===null)button.disabled=false;}
  });
  async function resolve(approve){
    if(!pendingId||busy)return;
    if(approve&&!confirm('Die angezeigten Arbeitsschritte und Abhängigkeiten wirklich in den Bauzeitenplan übernehmen? Alle vorgeschlagenen Änderungen werden als eine Transaktion gespeichert.'))return;
    const id=pendingId;
    busy=true;
    $('scheduleChatApprove').disabled=true;
    $('scheduleChatReject').disabled=true;
    status(approve?'Bestätigte Änderungen werden übernommen …':'Vorschlag wird verworfen …');
    try{
      const data=await request('/api/ai/schedule/chat/'+id+'/resolve','POST',{confirm:approve});
      clearPreview();
      await reload();
      await loadHistory();
      status(approve?data.changed+' Änderungen übernommen und protokolliert.':'Vorschlag verworfen und protokolliert.');
    }catch(e){
      status(e.message);
      await loadHistory().catch(()=>{});
    }finally{
      busy=false;
      $('scheduleChatApprove').disabled=false;
      $('scheduleChatReject').disabled=false;
    }
  }
  $('scheduleChatApprove').addEventListener('click',()=>resolve(true));
  $('scheduleChatReject').addEventListener('click',()=>resolve(false));
  // The audit log is also readable without an active ChatGPT login.
  loadHistory().catch(error=>{
    $('scheduleHistoryEntries').textContent='Historie nicht verfügbar: '+error.message;
  });
})();