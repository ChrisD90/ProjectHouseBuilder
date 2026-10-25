let project={tasks:[],start:'',contractors:[],contractor_suggestions:{}};let editing=null, templatePreview=null;
const proposals=id=>(project.contractor_suggestions||{})[id]||[];
const assignedCompany=t=>(project.contractors||[]).find(c=>c.id===t.contractor_id)?.name||t.company||'';
const $=id=>document.getElementById(id);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const addDays=(d,n)=>{let x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
const diff=(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);
const fmt=d=>d?d.slice(8,10)+'.'+d.slice(5,7)+'.'+d.slice(0,4):'–';
const firstMonday=d=>addDays(d,-((new Date(d+'T12:00:00Z').getUTCDay()+6)%7));
function message(s){$('toast').textContent=s;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',3000)}
async function api(path,options={}){const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const data=await res.json();if(!res.ok)throw Error(data.error||'Serverfehler');return data}
async function reload(){try{project=await api('/api/project');render();document.dispatchEvent(new CustomEvent('phb-schedule-updated',{detail:{taskCount:project.tasks.length}}))}catch(e){message(e.message)}}
async function loadTemplatePreview(){try{templatePreview=await api('/api/tasks/template');renderTemplatePreview()}catch(e){$('templateMessage').textContent=e.message;$('initializeTemplate').disabled=true}}
function renderTemplatePreview(){
 const empty=project.tasks.length===0;
 $('templatePanel').hidden=!empty;
 $('aiSchedulePanel').hidden=!empty||!Boolean(window.PHBAI?.connected());
 $('clearSchedule').hidden=empty;
 if(!empty||!templatePreview)return;
 const count=project.tasks.length;$('templateCount').textContent=templatePreview.count;$('templateSelf').textContent=templatePreview.execution_types.Eigenleistung+' Eigenleistung';$('templateExternal').textContent=templatePreview.execution_types.Fremdleistung+' Fremdleistung';$('templatePhases').innerHTML=templatePreview.phases.map(x=>`<span class="phase-chip">${escapeHtml(x.name)} <b>${x.count}</b></span>`).join('');$('templateTasks').innerHTML=templatePreview.tasks.map(t=>`<div class="template-step"><code>${escapeHtml(t.code)}</code><span>${escapeHtml(t.name)}<small>${escapeHtml(t.phase)} · ca. ${t.duration} Kalendertage</small></span><span class="work-chip ${t.execution_type==='Eigenleistung'?'self':'external'}">${escapeHtml(t.execution_type)}</span></div>`).join('');const can=!count&&!templatePreviewBusy;$('templateConfirm').disabled=!can;$('initializeTemplate').disabled=!can||!$('templateConfirm').checked;$('templateMessage').textContent=count?`Der vorhandene Plan enthält ${count} Arbeitsschritte und bleibt unverändert. Die Vorlage kann nur in einen leeren Plan eingefügt werden. Über „Nur Bauzeitplan leeren“ kannst du den bestehenden Plan nach einem geprüften Komplettbackup gezielt entfernen; deine Kosten und Belege bleiben erhalten.`:'Beim Einfügen werden alle vorgeschlagenen Arbeitspakete und ihre Abhängigkeiten erstellt. Anschließend kannst du alles ändern oder löschen.'}
let templatePreviewBusy=false;
function visible(){return project.tasks.filter(t=>(!$('phase').value||t.phase===$('phase').value)&&(!$('workType').value||t.execution_type===$('workType').value)&&[t.code,t.name,t.phase,t.trade,t.company,t.execution_type].some(v=>String(v).toLowerCase().includes($('filter').value.toLowerCase())))}
function render(){let ts=project.tasks;$('projectStart').value=project.start;$('count').textContent=ts.length;$('end').textContent=fmt(ts.reduce((x,t)=>t.end>x?t.end:x,project.start));$('ongoing').textContent=ts.filter(t=>t.status==='In Arbeit').length;$('selfCount').textContent=ts.filter(t=>t.execution_type==='Eigenleistung').length;$('externalCount').textContent=ts.filter(t=>t.execution_type==='Fremdleistung').length;$('progress').textContent=(ts.length?Math.round(ts.reduce((s,t)=>s+t.progress,0)/ts.length):0)+' %';let phase=$('phase').value;let phases=[...new Set(ts.map(t=>t.phase))];$('phase').innerHTML='<option value="">Alle Bauphasen</option>'+phases.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');$('phase').value=phases.includes(phase)?phase:'';$('suggestionCount').textContent=(project.contracted_companies||[]).length?'('+(project.contracted_companies||[]).length+' Firmen)':'';renderGantt();renderTable();renderTemplatePreview()}
const taskListFlow=PHBFlow.manage({
 dialog:'taskListDialog',dismiss:['closeTaskList'],track:false
});
const companyAssignmentFlow=PHBFlow.manage({
 dialog:'companyProposalsDialog',forms:['companyProposalRows'],
 dismiss:['companyProposalsCancel']
});
$('openTaskList').onclick=()=>taskListFlow.open();
$('closeTaskList').onclick=()=>$('taskListDialog').close();
function renderTable(){let rows=visible().map(t=>`<tr data-id="${t.id}"><td>${escapeHtml(t.code)}</td><td>${escapeHtml(t.phase)}</td><td>${escapeHtml(t.trade)}</td><td class="tasktitle">${escapeHtml(t.name)}</td><td><span class="work-chip ${t.execution_type==='Eigenleistung'?'self':t.execution_type==='Fremdleistung'?'external':'unknown'}">${escapeHtml(t.execution_type||'Noch offen')}</span></td><td>${escapeHtml(assignedCompany(t)||'–')}</td><td>${escapeHtml(t.predecessors.join(', ')||'–')}</td><td>${fmt(t.start)}</td><td>${fmt(t.end)}</td><td><span class="status ${t.status.replace(' ','-')}">${escapeHtml(t.status)}</span></td><td>${t.progress}%</td></tr>`).join('');$('taskRows').innerHTML=rows||'<tr><td colspan="11">Keine passenden Aufgaben</td></tr>';document.querySelectorAll('#taskRows tr[data-id]').forEach(el=>el.onclick=()=>openTask(Number(el.dataset.id)))}
function renderGantt(){let list=visible();let isMonth=$('scale').value==='month';let size=isMonth?7:26;let earliest=list.reduce((x,t)=>t.start<x?t.start:x,project.start);let latest=list.reduce((x,t)=>t.end>x?t.end:x,addDays(project.start,365));let origin=firstMonday(earliest);if(isMonth)origin=origin.slice(0,8)+'01';let days=Math.min(2200,Math.max(120,diff(origin,latest)+35));let width=days*size;let step=isMonth?30:7;let axis=[];for(let d=0;d<days;d+=step){let current=addDays(origin,d);let label=isMonth?new Date(current+'T12:00:00Z').toLocaleDateString('de-DE',{month:'short',year:'2-digit',timeZone:'UTC'}):fmt(current).slice(0,5);axis.push(`<span class="axis" style="left:${d*size}px">${label}</span>`)}let timelineStyle=`width:${width}px;background-size:${step*size}px 100%`;let html=`<div class="gantt-header"><div class="gantt-label">Aufgaben / Gewerke</div><div class="gantt-timeline" style="${timelineStyle}">${axis.join('')}</div></div>`;
for(let t of list){let left=diff(origin,t.start)*size;let w=(diff(t.start,t.end)+1)*size;let cls=t.status==='Erledigt'?'done':t.status==='Pausiert'?'paused':t.status==='In Arbeit'?'working':'';html+=`<div class="gantt-row"><div class="gantt-label" data-id="${t.id}" title="${escapeHtml(t.name)} · ${escapeHtml(t.execution_type)}"><code>${escapeHtml(t.code)}</code><span class="work-dot ${t.execution_type==='Eigenleistung'?'self':t.execution_type==='Fremdleistung'?'external':'unknown'}" title="${escapeHtml(t.execution_type)}">${t.execution_type==='Eigenleistung'?'E':t.execution_type==='Fremdleistung'?'F':'?'}</span><span class="task-name">${escapeHtml(t.name)}<small class="task-firm">${escapeHtml(assignedCompany(t)||'Ohne Firma')}</small></span></div><div class="gantt-timeline" style="${timelineStyle}"><div class="bar ${cls} ${t.execution_type==='Eigenleistung'?'self-work':'external-work'}" data-id="${t.id}" title="${escapeHtml(t.name)} · ${fmt(t.start)}–${fmt(t.end)} · ${t.progress}%" style="left:${left}px;width:${w}px"><div class="donepart" style="width:${t.progress}%"></div></div></div></div>`}
$('gantt').innerHTML=html;document.querySelectorAll('#gantt [data-id]').forEach(el=>el.onclick=()=>openTask(Number(el.dataset.id)))}
function openTask(id){editing=id;let t=project.tasks.find(x=>x.id===id)||{code:'T'+String(Math.max(0,...project.tasks.map(x=>Number(x.code.replace(/\D/g,''))||0))+1).padStart(2,'0'),phase:'Allgemein',trade:'Sonstiges',execution_type:'Noch offen',name:'',company:'',contractor_id:null,duration:1,lag_days:0,earliest_start:'',status:'Offen',progress:0,actual_start:'',actual_end:'',notes:'',predecessors:[]};$('modalTitle').textContent=id?`Arbeitspaket ${t.code} bearbeiten`:'Neues Arbeitspaket';$('delete').style.display=id?'block':'none';$('complete').hidden=!id || (t.status==='Erledigt' && !!t.actual_end);$('error').textContent='';let f=$('taskForm');const c=f.elements.namedItem('contractor_id');c.innerHTML='<option value="">Keine Zuordnung</option>'+(project.contractors||[]).map(x=>`<option value="${x.id}">${escapeHtml(x.trade+' · '+x.name)}</option>`).join('');
 const names=[...new Set(['Sonstiges',...(project.trades||[]),...project.tasks.map(x=>x.trade),t.trade])].filter(Boolean);
 f.elements.namedItem('trade').innerHTML=names.sort((a,b)=>a.localeCompare(b,'de')).map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
 for(let [key,value] of Object.entries(t)){if(key==='predecessors')continue;if(f.elements.namedItem(key))f.elements.namedItem(key).value=value??''}let sel=f.elements.namedItem('predecessors');sel.innerHTML=project.tasks.filter(x=>x.id!==id).map(x=>`<option value="${escapeHtml(x.code)}" ${t.predecessors.includes(x.code)?'selected':''}>${escapeHtml(x.code)} — ${escapeHtml(x.name)}</option>`).join('');$('taskSuggestion').hidden=true;$('taskSuggestion').replaceChildren();$('overlay').classList.remove('hidden')}
function closeModal(){$('overlay').classList.add('hidden')}
$('cancel').onclick=closeModal;$('overlay').onclick=e=>{if(e.target===$('overlay'))closeModal()};
$('newTask').onclick=()=>openTask(null);$('filter').oninput=()=>{renderGantt();renderTable()};$('phase').onchange=()=>{renderGantt();renderTable()};$('scale').onchange=renderGantt;$('workType').onchange=()=>{renderGantt();renderTable()};
$('templateConfirm').onchange=renderTemplatePreview;
$('clearSchedule').onclick=async()=>{
 if(!project.tasks.length)return;
 const response=await PHBUI.prompt('Achtung: Alle Bauzeitplan-Aufgaben und deren Abhängigkeiten werden entfernt. Andere Projektdaten bleiben bestehen. Vorher ist ein vollständiges, geprüftes Backup Pflicht. Zur Bestätigung BAUZEITPLAN LEEREN eingeben:');
 if(response!=='BAUZEITPLAN LEEREN')return;
 if(!await PHBUI.confirm('Den Bauzeitplan nach vollständigem Backup wirklich leeren?'))return;
 $('clearSchedule').disabled=true;
 try{const result=await api('/api/tasks/clear',{method:'POST',headers:{'X-PHB-Schedule-Reset':'1'},body:JSON.stringify({confirmation:'BAUZEITPLAN LEEREN'})});$('phase').value='';$('filter').value='';$('workType').value='';await reload();if(!templatePreview)await loadTemplatePreview();message('Bauzeitplan geleert; Komplettbackup wurde erstellt.');$('templateMessage').textContent='Der Plan ist leer. Du kannst jetzt den Musterplan übernehmen.'}
 catch(e){message(e.message);$('templateMessage').textContent=e.message}
 finally{$('clearSchedule').disabled=false;renderTemplatePreview()}
};
$('initializeTemplate').onclick=async()=>{if(!templatePreview||project.tasks.length||!$('templateConfirm').checked)return;if(!await PHBUI.confirm(`${templatePreview.count} vorgeschlagene Arbeitsschritte mit Terminen und Abhängigkeiten in den leeren Bauzeitenplan übernehmen?`))return;templatePreviewBusy=true;$('initializeTemplate').disabled=true;$('templateConfirm').disabled=true;$('templateMessage').textContent='Arbeitsschritte werden eingefügt …';try{const out=await api('/api/tasks/initialize',{method:'POST',body:JSON.stringify({confirm:true})});$('templateConfirm').checked=false;await reload();message(`${out.created} Arbeitsschritte übernommen`)}catch(e){$('templateMessage').textContent=e.message;message(e.message)}finally{templatePreviewBusy=false;renderTemplatePreview()}};
$('saveStart').onclick=async()=>{try{await api('/api/project',{method:'PATCH',body:JSON.stringify({start:$('projectStart').value})});message('Projektstart gespeichert');await reload()}catch(e){message(e.message)}};
$('taskForm').onsubmit=async e=>{e.preventDefault();let f=$('taskForm'),data={};for(let name of ['code','phase','trade','execution_type','name','company','contractor_id','duration','lag_days','earliest_start','status','progress','actual_start','actual_end','notes'])data[name]=f.elements.namedItem(name).value;data.predecessors=Array.from(f.elements.namedItem('predecessors').selectedOptions).map(o=>o.value);try{await api(editing?'/api/tasks/'+editing:'/api/tasks',{method:editing?'PUT':'POST',body:JSON.stringify(data)});closeModal();await reload();message('Arbeitspaket gespeichert')}catch(e){$('error').textContent=e.message}};
$('complete').onclick=async()=>{
  if(!editing)return;
  try{const result=await api('/api/tasks/'+editing+'/complete',{method:'POST'});closeModal();await reload();message('Abgeschlossen · Ist-Ende: '+fmt(result.actual_end));}
  catch(error){$('error').textContent=error.message;}
};
function updateCompanySelectionCounts(){
  const host=$('companyProposalRows');
  const selected=host.querySelectorAll('[data-company-task]:checked');
  const n=selected.length;
  $('companySelectionCount').textContent=n+' Arbeitspaket'+(n===1?'':'e')+' ausgewählt';
  $('companyProposalsApply').disabled=n===0;
  host.querySelectorAll('[data-company-group]').forEach(group=>{
    const count=group.querySelectorAll('[data-company-task]:checked').length;
    group.querySelector('[data-company-selected]').textContent=count
      ?count+' ausgewählt':'Noch keine Auswahl';
  });
}
function filterCompanies(){
  const host=$('companyProposalRows');
  const q=$('companySearch').value.trim().toLocaleLowerCase('de');
  let matched=0;
  host.querySelectorAll('[data-company-group]').forEach(group=>{
    const found=group.dataset.companySearch.includes(q);
    group.hidden=!found;
    if(found)matched++;
  });
  $('companySearchCount').textContent=matched+' von '+host.querySelectorAll('[data-company-group]').length+' Firmen';
  $('companyNoMatches').hidden=matched!==0;
}
function filterCompanyTasks(group){
  const input=group.querySelector('[data-task-search]');
  const q=input.value.trim().toLocaleLowerCase('de');
  let matched=0;
  group.querySelectorAll('[data-company-task]').forEach(check=>{
    const row=check.closest('.company-task-choice');
    const found=row.dataset.taskText.includes(q);
    row.hidden=!found;
    if(found)matched++;
  });
  group.querySelector('[data-task-no-matches]').hidden=matched!==0;
  group.querySelector('[data-task-result-count]').textContent=
    matched+' von '+group.querySelectorAll('[data-company-task]').length+' Arbeitspaketen';
}
$('companySuggestions').onclick=()=>{
  const companies=project.contracted_companies||[];
  const freeTasks=project.tasks.filter(t=>
    t.execution_type!=='Eigenleistung'&&!t.contractor_id&&!(t.company||'').trim());
  const host=$('companyProposalRows');
  $('companySearch').value='';
  if(!companies.length){
    host.innerHTML='<p class="company-empty">Noch keine Firma mit angenommenem Angebot oder beauftragter Leistung vorhanden.</p>';
  }else if(!freeTasks.length){
    host.innerHTML='<p class="company-empty">Keine freien Arbeitspakete vorhanden: alle Aufgaben sind bereits zugeordnet oder Eigenleistungen.</p>';
  }else{
    host.innerHTML=companies.map(company=>{
      const source=(company.sources||[]).map(escapeHtml).join(' · ');
      const choices=freeTasks.map(task=>{
        const match=[task.code,task.name,task.phase,task.trade].join(' ').toLocaleLowerCase('de');
        return `<label class="company-task-choice" data-task-text="${escapeHtml(match)}">
           <input type="checkbox" name="company_task_${company.contractor_id}" data-company-id="${company.contractor_id}" data-company-task="${task.id}">
           <span><strong>${escapeHtml(task.code)} · ${escapeHtml(task.name)}</strong>
           <small>${escapeHtml(task.phase)} · ${escapeHtml(task.trade)}</small></span>
         </label>`;
      }).join('');
      const search=[company.name,company.trade,...(company.sources||[])].join(' ').toLocaleLowerCase('de');
      return `<details class="company-task-group" data-company-group data-company-search="${escapeHtml(search)}">
         <summary class="company-task-summary"><span class="company-fold-icon" aria-hidden="true"></span>
           <span class="company-summary-main"><strong>${escapeHtml(company.name)}</strong>
             <small>${escapeHtml(company.trade||'Gewerk nicht angegeben')} · ${escapeHtml((company.sources||[]).length+' Auftragsgrundlage(n)')}</small></span>
           <span class="company-selected-badge" data-company-selected>Noch keine Auswahl</span>
         </summary>
         <div class="company-task-body">
           <p class="company-help">${source||'Aus bestätigten Aufträgen'}</p>
           <label class="company-task-search-label">Arbeitspakete dieser Firma durchsuchen
             <input type="search" data-task-search autocomplete="off" placeholder="ID, Tätigkeit, Gewerk oder Bauphase …">
           </label>
           <span class="company-result-count" data-task-result-count>${freeTasks.length} von ${freeTasks.length} Arbeitspaketen</span>
           <div class="company-task-choices">${choices}</div>
           <p class="company-empty" data-task-no-matches hidden>Keine passenden Arbeitspakete. Suche anpassen.</p>
         </div>
       </details>`;
    }).join('');
  }
  if(!host.querySelector('#companyNoMatches')){
    const empty=document.createElement('p');
    empty.id='companyNoMatches';empty.className='company-empty';empty.hidden=true;
    empty.textContent='Keine passende Firma gefunden.';
    host.append(empty);
  }
  filterCompanies();
  updateCompanySelectionCounts();
  companyAssignmentFlow.open();
};
$('companySearch').addEventListener('input',filterCompanies);
$('companyProposalRows').addEventListener('input',e=>{
  const group=e.target.closest('[data-company-group]');
  if(group&&e.target.matches('[data-task-search]'))filterCompanyTasks(group);
});
$('companyProposalRows').addEventListener('change',e=>{
  const check=e.target.closest('[data-company-task]');
  if(!check)return;
  if(check.checked){
    $('companyProposalRows').querySelectorAll('[data-company-task="'+check.dataset.companyTask+'"]').forEach(other=>{
      if(other!==check)other.checked=false;
    });
  }
  updateCompanySelectionCounts();
});
$('companyProposalsCancel').onclick=()=>$('companyProposalsDialog').close();
$('companyProposalsApply').onclick=async()=>{
  const assignments=[...document.querySelectorAll('#companyProposalRows [data-company-task]:checked')]
    .map(input=>({task_id:Number(input.dataset.companyTask),contractor_id:Number(input.dataset.companyId)}));
  if(!assignments.length){
    await PHBUI.alert('Bitte mindestens ein Arbeitspaket für eine Firma auswählen.');
    return;
  }
  if(!await PHBUI.confirm(assignments.length+' Arbeitspaket(e) den ausgewählten Firmen verbindlich zuordnen?'))return;
  const button=$('companyProposalsApply');button.disabled=true;
  try{
    const result=await api('/api/tasks/assign-by-company',{method:'POST',body:JSON.stringify({assignments})});
    $('companyProposalsDialog').close();
    await reload();
    message(result.assigned+' Arbeitspaket(e) zugeordnet.');
  }catch(error){await PHBUI.alert(error.message);}
  finally{button.disabled=false;}
};
$('delete').onclick=async()=>{if(!await PHBUI.confirm('Arbeitspaket wirklich löschen?'))return;try{await api('/api/tasks/'+editing,{method:'DELETE'});closeModal();await reload();message('Arbeitspaket gelöscht')}catch(e){$('error').textContent=e.message}};
$('today').onclick=()=>{let container=document.querySelector('.ganttwrap');let origin=firstMonday(project.start);let n=diff(origin,new Date().toISOString().slice(0,10));container.scrollLeft=Math.max(0,n*($('scale').value==='week'?26:7)-320)};
reload().then(()=>{if(!project.tasks.length)loadTemplatePreview();if(new URLSearchParams(location.search).get('firmenvorschlaege')==='1')$('companySuggestions').click();});
document.addEventListener('phb-ai-status',renderTemplatePreview);

/* ChatGPT plan-funded schedule suggestions: preview-only until explicit import. */
(() => {
  let preview=null;
  const button=document.getElementById('aiScheduleSuggest');
  if(!button)return;
  const $=id=>document.getElementById(id);
  const report=msg=>{$('aiScheduleStatus').textContent=msg;};
  button.onclick=async()=>{
    try{
      const perm=window.PHBAI?.selection();
      if(!perm)throw Error('ChatGPT ist nicht verbunden.');
      button.disabled=true;preview=null;$('aiScheduleApply').hidden=true;$('aiScheduleDetails').hidden=true;
      report('Bauzeitenvorschlag wird erstellt …');
      const response=await fetch('/api/ai/schedule/suggest',{method:'POST',headers:{'Content-Type':'application/json','X-PHB-AI':'1'},
        body:JSON.stringify({...perm,requirements:$('aiScheduleNeeds').value})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'KI nicht verfügbar.');
      $('aiScheduleOverview').textContent=data.overview;
      preview=data.can_apply?data.tasks:null;
      $('aiScheduleApply').hidden=!preview;
      $('aiScheduleDetails').hidden=!preview;
      $('aiScheduleList').replaceChildren();
      for(const t of (data.tasks||[])){
        const row=document.createElement('div');row.className='template-step';
        row.textContent=`${t.code} · ${t.name} · ${t.execution_type} · ${t.duration} Tage · Vorgänger: ${(t.predecessors||[]).join(', ')}`;
        $('aiScheduleList').append(row);
      }
      report(data.notice||'Vorschlag erstellt.');
    }catch(e){report(e.message);}finally{button.disabled=false;}
  };
  $('aiScheduleApply').onclick=async()=>{
    if(!preview)return;
    if(!await PHBUI.confirm('Alle geprüften KI-Aufgaben wirklich in den LEEREN Bauzeitenplan übernehmen? Bestehende Aufgaben werden nicht überschrieben.'))return;
    const button=$('aiScheduleApply');button.disabled=true;
    try{
      const res=await fetch('/api/ai/schedule/apply',{method:'POST',
        headers:{'Content-Type':'application/json','X-PHB-AI':'1'},
        body:JSON.stringify({confirm:true,tasks:preview})});
      const data=await res.json();if(!res.ok)throw Error(data.error||'Übernahme fehlgeschlagen.');
      preview=null;button.hidden=true;$('aiScheduleDetails').hidden=true;
      await reload();report(data.created+' KI-Arbeitspakete übernommen.');
    }catch(e){report(e.message);}finally{button.disabled=false;}
  };
})();
