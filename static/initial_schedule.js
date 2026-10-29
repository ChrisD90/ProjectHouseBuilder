/* Interactive initial schedule: clarify first, generate and apply only after review. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const dialog=$('initialScheduleDialog');
  const opener=$('openInitialSchedule');
  if(!dialog||!opener)return;
  let state={turns:[],ai_ready:false,user_ready:false,can_generate:false,summary:''};
  let proposal=null;
  let busy=false;
  const flow=PHBFlow.manage({dialog:'initialScheduleDialog',forms:['initialScheduleForm'],
    dismiss:['closeInitialSchedule'],isBusy:()=>busy});
  const status=message=>{$('initialScheduleStatus').textContent=message;};
  const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};

  async function request(url,{method='GET',body,ai=false}={}){
    const headers={'X-PHB-AI':'1'};
    let payload=body;
    if(ai){
      const selection=window.PHBAI?.selection();
      if(!selection)throw Error('Bitte zuerst ChatGPT verbinden.');
      payload={...selection,...(body||{})};
    }
    const options={method,headers};
    if(payload!==undefined){headers['Content-Type']='application/json';options.body=JSON.stringify(payload);}
    const response=await fetch(url,options);let data;
    try{data=await response.json();}catch{throw Error('Antwort vom Server nicht lesbar.');}
    if(!response.ok)throw Error(data.error||'Anfrage fehlgeschlagen.');
    return data;
  }

  function renderConversation(){
    const host=$('initialScheduleMessages');host.replaceChildren();
    if(!state.turns.length){
      host.append(make('p','schedule-chat-intro','Beschreibe Gebäude, Sanierungsumfang, Eigenleistungen und wichtige Termine. ChatGPT fragt nach, wenn für einen brauchbaren Ablauf noch etwas fehlt.'));
    }
    for(const turn of state.turns){
      const user=make('article','initial-message initial-message-user');
      user.append(make('span','schedule-chat-author','Du'));
      user.append(make('p','',turn.request));host.append(user);
      const assistant=make('article','initial-message initial-message-ai');
      assistant.append(make('span','schedule-chat-author','ChatGPT'));
      assistant.append(make('p','',turn.answer));
      if(turn.questions?.length){
        const list=make('ol','initial-question-list');
        turn.questions.forEach(question=>list.append(make('li','',question)));
        assistant.append(list);
      }
      host.append(assistant);
    }
    host.scrollTop=host.scrollHeight;
    $('initialUserReady').textContent=state.user_ready?'Deine Angaben: vollständig':'Deine Angaben: offen';
    $('initialAIReady').textContent=state.ai_ready?'KI-Prüfung: ausreichend':'KI-Prüfung: Rückfragen möglich';
    $('initialUserReady').classList.toggle('is-ready',state.user_ready);
    $('initialAIReady').classList.toggle('is-ready',state.ai_ready);
    $('initialGeneratePanel').hidden=!state.can_generate;
    $('initialScheduleSummary').textContent=state.summary||'Die geklärten Angaben reichen für einen ersten unverbindlichen Ablauf.';
  }

  async function loadState(){
    state=await request('/api/ai/schedule/intake');renderConversation();
  }

  async function reset(force=false){
    if(!force&&state.turns.length&&!await PHBUI.confirm('Das bisherige Planungsgespräch verwerfen und neu beginnen?'))return;
    state=await request('/api/ai/schedule/intake/reset',{method:'POST',body:{}});
    proposal=null;$('initialSchedulePreview').hidden=true;$('initialScheduleInput').value='';
    renderConversation();flow.snapshot();status('Neues Planungsgespräch gestartet.');
  }

  async function send(userReady){
    if(busy)return;
    let message=$('initialScheduleInput').value.trim();
    if(userReady&&!message)message='Ich halte meine bisherigen Angaben für vollständig. Bitte prüfe, ob noch eine wesentliche Information fehlt.';
    if(message.length<3){status('Bitte beschreibe dein Vorhaben oder beantworte die Rückfragen.');return;}
    proposal=null;$('initialSchedulePreview').hidden=true;
    busy=true;flow.setBusy(true);$('initialScheduleSend').disabled=true;$('initialScheduleReady').disabled=true;
    status(userReady?'ChatGPT prüft, ob die Angaben ausreichen …':'ChatGPT prüft deine Angaben und mögliche Rückfragen …');
    try{
      state=await request('/api/ai/schedule/intake',{method:'POST',ai:true,body:{message,user_ready:userReady}});
      $('initialScheduleInput').value='';renderConversation();flow.snapshot();
      status(state.can_generate?'Beide Seiten sind bereit. Du kannst jetzt den Planvorschlag erzeugen.':state.ai_ready?'Die KI hält die Angaben für ausreichend. Bestätige noch, dass auch deine Angaben vollständig sind.':'Bitte beantworte die offenen Rückfragen.');
    }catch(error){status(error.message);}
    finally{busy=false;flow.setBusy(false);$('initialScheduleSend').disabled=false;$('initialScheduleReady').disabled=false;}
  }

  function renderProposal(data){
    proposal={phases:data.phases||[],tasks:data.tasks||[]};
    $('initialScheduleOverview').textContent=data.overview||'';
    $('initialPhaseCount').textContent=proposal.phases.length+' Bauphase'+(proposal.phases.length===1?'':'n');
    $('initialTaskCount').textContent=proposal.tasks.length+' Arbeitspaket'+(proposal.tasks.length===1?'':'e');
    $('initialPhaseList').replaceChildren(...proposal.phases.map(phase=>{
      const row=make('article','initial-phase-card');
      row.append(make('strong','',phase.title));
      row.append(make('span','',phase.start_date+(phase.end_date?' – '+phase.end_date:' · offenes Ende')));
      if(phase.description)row.append(make('small','',phase.description));
      return row;
    }));
    $('initialTaskList').replaceChildren(...proposal.tasks.map(task=>{
      const row=make('div','template-step');
      row.textContent=`${task.code} · ${task.name} · ${task.phase} · ${task.trade} · ${task.execution_type} · ${task.duration} Tage · Vorgänger: ${(task.predecessors||[]).join(', ')||'keine'}`;
      return row;
    }));
    $('initialSchedulePreview').hidden=false;
    $('initialSchedulePreview').scrollIntoView({behavior:'smooth',block:'start'});
  }

  opener.addEventListener('click',async()=>{
    flow.open();status('Planungsgespräch wird geladen …');
    try{await loadState();status(state.turns.length?'Planungsgespräch fortgesetzt.':'Beschreibe dein Vorhaben, damit ChatGPT gezielt nachfragen kann.');}
    catch(error){status(error.message);}
  });
  $('initialScheduleForm').addEventListener('submit',event=>{event.preventDefault();void send(false);});
  $('initialScheduleReady').addEventListener('click',()=>void send(true));
  $('initialScheduleReset').addEventListener('click',()=>void reset());
  $('initialScheduleGenerate').addEventListener('click',async()=>{
    if(busy||!state.can_generate)return;
    busy=true;flow.setBusy(true);$('initialScheduleGenerate').disabled=true;status('Bauphasen und Arbeitspakete werden als prüfbarer Vorschlag erzeugt …');
    try{const data=await request('/api/ai/schedule/suggest',{method:'POST',ai:true,body:{}});renderProposal(data);status(data.notice||'Planvorschlag erstellt.');}
    catch(error){status(error.message);}
    finally{busy=false;flow.setBusy(false);$('initialScheduleGenerate').disabled=false;}
  });
  $('initialScheduleApply').addEventListener('click',async()=>{
    if(busy||!proposal)return;
    if(!await PHBUI.confirm('Die angezeigten Bauphasen und Arbeitspakete wirklich in den leeren Bauzeitenplan übernehmen?'))return;
    busy=true;flow.setBusy(true);$('initialScheduleApply').disabled=true;status('Geprüfter Plan wird übernommen …');
    try{
      const data=await request('/api/ai/schedule/apply',{method:'POST',body:{confirm:true,...proposal}});
      proposal=null;flow.finish();await window.reloadSchedule();
      await PHBUI.alert(`${data.phases} Bauphasen und ${data.created} Arbeitspakete wurden übernommen.`);
    }catch(error){status(error.message);}
    finally{busy=false;flow.setBusy(false);$('initialScheduleApply').disabled=false;}
  });
})();
