const selectedTasks=new Set(),collapsedPhases=new Set();
let project={tasks:[],phases:[],start:'',contractors:[],contractor_suggestions:{}};let editing=null,taskBusy=false,ganttBusy=false;
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
window.reloadSchedule=reload;
function renderScheduleStart(){
 const empty=project.tasks.length===0;
 $('aiSchedulePanel').hidden=!empty||!Boolean(window.PHBAI?.connected());
 $('clearSchedule').hidden=empty;
}
function visible(){const phaseId=$('phase').value;return project.tasks.filter(t=>(!phaseId||(phaseId==='unassigned'?!t.phase_id:String(t.phase_id??'')===phaseId))&&(!$('workType').value||t.execution_type===$('workType').value)&&[t.code,t.name,t.phase,t.trade,assignedCompany(t),t.execution_type].some(v=>String(v).toLowerCase().includes($('filter').value.toLowerCase())))}
function render(){let ts=project.tasks;$('projectStart').value=project.start;$('count').textContent=ts.length;$('end').textContent=fmt(ts.reduce((x,t)=>t.end>x?t.end:x,project.start));$('ongoing').textContent=ts.filter(t=>t.status==='In Arbeit').length;$('selfCount').textContent=ts.filter(t=>t.execution_type==='Eigenleistung').length;$('externalCount').textContent=ts.filter(t=>t.execution_type==='Fremdleistung').length;let selected=$('phase').value;$('phase').innerHTML='<option value="">Alle Bauphasen</option>'+(project.phases||[]).map(p=>`<option value="${p.id}">${escapeHtml(p.title)}</option>`).join('')+'<option value="unassigned">Ohne Bauphase</option>';$('phase').value=[...(project.phases||[]).map(p=>String(p.id)),'unassigned'].includes(selected)?selected:'';$('suggestionCount').textContent=(project.contracted_companies||[]).length?'('+(project.contracted_companies||[]).length+' Firmen)':'';renderGantt();renderTable();renderScheduleStart();renderPhaseList()}
const taskListFlow=PHBFlow.manage({
 dialog:'taskListDialog',dismiss:['closeTaskList'],track:false
});
const companyAssignmentFlow=PHBFlow.manage({
 dialog:'companyProposalsDialog',forms:['companyProposalRows'],
 dismiss:['companyProposalsCancel']
});
let phaseBusy=false;
const phaseFlow=PHBFlow.manage({dialog:'phaseDialog',forms:['phaseForm'],dismiss:['closePhaseDialog'],isBusy:()=>phaseBusy});
function renderPhaseList(){const host=$('phaseList');if(!host)return;host.innerHTML=(project.phases||[]).map(p=>{const count=project.tasks.filter(t=>t.phase_id===p.id).length;return `<button type="button" class="phase-list-item" data-edit-phase="${p.id}"><strong>${escapeHtml(p.title)}</strong><span>${fmt(p.start_date)}${p.end_date?' – '+fmt(p.end_date):' · offenes Ende'}</span><small>${count} Arbeitspaket${count===1?'':'e'}${p.description?' · '+escapeHtml(p.description):''}</small></button>`}).join('')||'<p class="phase-empty">Noch keine Bauphase angelegt. Arbeitspakete können trotzdem ohne Bauphase geplant werden.</p>'}
let phaseDetailMode=false;
function openPhase(id=null,detail=false){
 phaseDetailMode=detail;
 const row=(project.phases||[]).find(p=>p.id===id),form=$('phaseForm');form.reset();
 form.elements.id.value=row?.id||'';form.elements.title.value=row?.title||'';form.elements.start_date.value=row?.start_date||project.start;form.elements.end_date.value=row?.end_date||'';form.elements.description.value=row?.description||'';
 $('phaseFormTitle').textContent=row?'Bauphase bearbeiten':'Neue Bauphase';$('phaseDialogTitle').textContent=detail?(row?.title||'Bauphase'):'Bauphasen verwalten';
 $('phaseDialog').classList.toggle('is-phase-detail',detail);$('phaseList').hidden=detail;$('resetPhaseForm').hidden=detail;
 $('deletePhase').hidden=!row;$('phaseFormError').textContent='';renderPhaseList();
 renderPhaseTaskDetails(id);
 if(!phaseFlow.dialog.open)phaseFlow.open();phaseFlow.snapshot();setTimeout(()=>form.elements.title.focus(),0);
}
function renderPhaseTaskDetails(id){
 const row=project.phases.find(p=>p.id===id);
 const tasks=project.tasks.filter(t=>t.phase_id===id),done=tasks.filter(t=>t.status==='Erledigt').length;
 $('phaseTaskDetails').hidden=!row;
 $('phaseTaskSummary').textContent=`Arbeitspakete (${done} / ${tasks.length} abgeschlossen)`;
 $('phaseTaskItems').innerHTML=tasks.map(t=>`<button type="button" data-phase-task="${t.id}"><span>${escapeHtml(t.code)} · ${escapeHtml(t.name)}</span><small>${escapeHtml(t.status)} · ${escapeHtml(t.trade)}</small></button>`).join('')||'<p>Noch keine Arbeitspakete zugeordnet.</p>';
 $('phaseCompletionState').textContent=row?.completed?'Abgeschlossen am '+fmt(row.completed_at):row?.completed_at?'Wieder offen: Zugeordnete Arbeitspakete sind noch nicht abgeschlossen.':'';
 $('completePhase').hidden=!row||row.completed;
}
$('phaseTaskItems').onclick=e=>{const button=e.target.closest('[data-phase-task]');if(button)openTask(Number(button.dataset.phaseTask))};
$('completePhase').onclick=async()=>{
 if(phaseBusy)return;const id=Number($('phaseForm').elements.id.value),row=project.phases.find(p=>p.id===id);if(!row)return;
 if(phaseFlow.dirty()){await PHBUI.alert('Bitte deine Änderungen zuerst speichern, bevor du die Bauphase abschließt.');return;}
 const count=project.tasks.filter(t=>t.phase_id===id&&t.status!=='Erledigt').length;
 if(!await PHBUI.confirm(`Bauphase „${row.title}“ und ${count} offene Arbeitspakete abschließen? Bereits abgeschlossene Pakete behalten ihr Abschlussdatum.`))return;
 phaseBusy=true;$('completePhase').disabled=true;
 try{await api('/api/phases/'+id+'/complete',{method:'POST',body:JSON.stringify({confirm:true})});await reload();openPhase(id,phaseDetailMode);message('Bauphase und Arbeitspakete abgeschlossen.');}
 catch(error){$('phaseFormError').textContent=error.message}
 finally{phaseBusy=false;$('completePhase').disabled=false}
};
$('managePhases').onclick=()=>openPhase();
$('closePhaseDialog').onclick=()=>phaseFlow.finish();
$('resetPhaseForm').onclick=()=>openPhase();
$('phaseList').onclick=e=>{const button=e.target.closest('[data-edit-phase]');if(button)openPhase(Number(button.dataset.editPhase))};
$('phaseForm').onsubmit=async e=>{e.preventDefault();if(phaseBusy)return;phaseBusy=true;const form=e.currentTarget,id=form.elements.id.value,data=Object.fromEntries(new FormData(form));delete data.id;try{await api(id?'/api/phases/'+id:'/api/phases',{method:id?'PUT':'POST',body:JSON.stringify(data)});await reload();openPhase(id?Number(id):project.phases.at(-1)?.id,phaseDetailMode);message('Bauphase gespeichert');}catch(error){$('phaseFormError').textContent=error.message}finally{phaseBusy=false}};
$('deletePhase').onclick=async()=>{const id=$('phaseForm').elements.id.value;if(!id||phaseBusy)return;const row=project.phases.find(p=>p.id===Number(id)),count=project.tasks.filter(t=>t.phase_id===Number(id)).length;if(!await PHBUI.confirm(`Bauphase „${row.title}“ löschen? ${count} zugeordnete Arbeitspaket${count===1?' bleibt':'e bleiben'} erhalten und ${count===1?'ist':'sind'} danach ohne Bauphase.`))return;phaseBusy=true;try{await api('/api/phases/'+id,{method:'DELETE'});await reload();openPhase();message('Bauphase gelöscht; Arbeitspakete bleiben erhalten.')}catch(error){$('phaseFormError').textContent=error.message}finally{phaseBusy=false}};
$('openTaskList').onclick=()=>taskListFlow.open();
$('closeTaskList').onclick=()=>$('taskListDialog').close();
function deadlineText(t){return t.deadline_status==='overdue'?'Überfällig':t.deadline_status==='due-soon'?'Endet bald':''}
function renderTable(){let rows=visible().map(t=>`<tr data-id="${t.id}" class="task-deadline-${t.deadline_status||'none'}"><td><input type="checkbox" class="task-select" data-select-task="${t.id}" aria-label="${escapeHtml(t.code)} markieren" ${selectedTasks.has(t.id)?'checked':''}></td><td>${escapeHtml(t.code)}</td><td>${escapeHtml(t.phase||'Ohne Bauphase')}</td><td>${escapeHtml(t.trade)}</td><td class="tasktitle">${escapeHtml(t.name)}${deadlineText(t)?`<small class="deadline-label">${deadlineText(t)}</small>`:''}</td><td><span class="work-chip ${t.execution_type==='Eigenleistung'?'self':t.execution_type==='Fremdleistung'?'external':'unknown'}">${escapeHtml(t.execution_type||'Noch offen')}</span></td><td>${escapeHtml(assignedCompany(t)||'–')}</td><td>${escapeHtml(t.predecessors.join(', ')||'–')}</td><td>${fmt(t.start)}</td><td>${fmt(t.end)}</td><td>${fmt(t.planned_end)}</td><td><span class="status ${t.status.replace(' ','-')}">${escapeHtml(t.status)}</span></td></tr>`).join('');$('taskRows').innerHTML=rows||'<tr><td colspan="12">Keine passenden Aufgaben</td></tr>';document.querySelectorAll('#taskRows tr[data-id]').forEach(el=>el.onclick=e=>{if(e.target.closest('input'))return;openTask(Number(el.dataset.id))});syncBulkSelection()}
function renderGantt(){
 const list=visible(),selectedPhase=$('phase').value;
 const phases=(project.phases||[]).filter(p=>!selectedPhase||String(p.id)===selectedPhase);
 const overviewMode=$('scale').value==='overview',isMonth=$('scale').value!=='week',size=overviewMode?2:isMonth?7:26;
 const dates=[project.start,...list.map(t=>t.start),...phases.map(p=>p.start_date)].filter(Boolean);
 const ends=[addDays(project.start,365),...list.map(t=>t.planned_end||t.end),...phases.map(p=>p.end_date||p.start_date)].filter(Boolean);
 let origin=firstMonday(dates.sort()[0]||project.start);if(isMonth)origin=origin.slice(0,8)+'01';
 const latest=ends.sort().at(-1)||addDays(project.start,365),days=Math.min(2200,Math.max(120,diff(origin,latest)+35));
 const width=days*size,step=overviewMode?90:isMonth?30:7,axis=[];
 for(let d=0;d<days;d+=step){const current=addDays(origin,d);const label=isMonth?new Date(current+'T12:00:00Z').toLocaleDateString('de-DE',{month:'short',year:'2-digit',timeZone:'UTC'}):fmt(current).slice(0,5);axis.push(`<span class="axis" style="left:${d*size}px">${label}</span>`)}
 const timelineStyle=`width:${width}px;background-size:${step*size}px 100%`;
 let html=`<div class="gantt-header"><div class="gantt-label">Bauphasen und Arbeitspakete</div><div class="gantt-timeline" style="${timelineStyle}">${axis.join('')}</div></div>`;
 const taskRow=(t,phaseId)=>{const left=diff(origin,t.start)*size,w=(diff(t.start,t.end)+1)*size;const state=t.status==='Erledigt'?'done':t.status==='Pausiert'?'paused':t.status==='In Arbeit'?'working':'';const deadline=deadlineText(t);return `<div class="gantt-row gantt-task-row is-phase-child task-deadline-${t.deadline_status||'none'}" data-phase-child="${phaseId||'unassigned'}"><div class="gantt-label" data-id="${t.id}" title="${escapeHtml(t.name)} · ${escapeHtml(t.execution_type)}"><code>${escapeHtml(t.code)}</code><span class="work-dot ${t.execution_type==='Eigenleistung'?'self':t.execution_type==='Fremdleistung'?'external':'unknown'}" title="${escapeHtml(t.execution_type)}">${t.execution_type==='Eigenleistung'?'E':t.execution_type==='Fremdleistung'?'F':'?'}</span><span class="task-name">${escapeHtml(t.name)}<small class="task-firm">${escapeHtml(assignedCompany(t)||'Ohne Firma')}</small></span>${deadline?`<span class="deadline-label">${deadline}</span>`:''}</div><div class="gantt-timeline" style="${timelineStyle}"><div tabindex="0" role="button" aria-label="${escapeHtml(t.name)}: ${fmt(t.start)} bis ${fmt(t.end)}${t.status==='Erledigt'?' – abgeschlossen':' – verschieben mit Alt und Pfeiltasten'}" class="bar ${state} ${t.deadline_status||''} ${t.execution_type==='Eigenleistung'?'self-work':'external-work'}" data-id="${t.id}" title="${escapeHtml(t.name)} · berechnet ${fmt(t.end)}${t.planned_end?' · geplant '+fmt(t.planned_end):''}" style="left:${left}px;width:${w}px"></div>${t.planned_end?`<span class="planned-end-marker ${t.deadline_status||''}" style="left:${diff(origin,t.planned_end)*size}px" title="Geplantes Ende ${fmt(t.planned_end)}"></span>`:''}</div></div>`};
 const filtersActive=Boolean($('filter').value||$('workType').value);
 if(selectedPhase!=='unassigned')for(const p of phases){
  const assigned=list.filter(t=>t.phase_id===p.id);if(filtersActive&&!assigned.length)continue;
  const displayEnd=p.end_date||assigned.reduce((end,t)=>t.end>end?t.end:end,p.start_date),left=diff(origin,p.start_date)*size,w=Math.max(size,(diff(p.start_date,displayEnd)+1)*size);
  html+=`<div class="gantt-row gantt-phase-row" data-phase-group="${p.id}"><div class="gantt-label"><button class="phase-toggle" type="button" data-toggle-phase="${p.id}" aria-expanded="${!collapsedPhases.has(String(p.id))}" aria-label="${escapeHtml(p.title)} ${collapsedPhases.has(String(p.id))?'ausklappen':'einklappen'}">${collapsedPhases.has(String(p.id))?'▸':'▾'}</button><span class="phase-title"><button class="phase-edit" type="button" data-phase-id="${p.id}">${escapeHtml(p.title)}</button><span class="phase-task-count">${assigned.length}</span>${p.completed?'<span class="phase-complete-label">✓</span>':''}</span><small>${fmt(p.start_date)}${p.end_date?' – '+fmt(p.end_date):' · offenes Ende'}</small></div><div class="gantt-timeline" style="${timelineStyle}"><div class="phase-bar" role="button" tabindex="0" data-phase-id="${p.id}" aria-label="Details zu ${escapeHtml(p.title)}" style="left:${left}px;width:${w}px" title="${escapeHtml(p.title)} · ${fmt(p.start_date)}${p.end_date?'–'+fmt(p.end_date):' · offenes Ende'}"></div></div></div>`;
  if(!collapsedPhases.has(String(p.id)))assigned.forEach(t=>{html+=taskRow(t,p.id)});
 }
 const unassigned=list.filter(t=>!t.phase_id);
 if((!selectedPhase||selectedPhase==='unassigned')&&unassigned.length){html+=`<div class="gantt-row gantt-phase-row gantt-unassigned-row" data-phase-group="unassigned"><div class="gantt-label"><span class="phase-title"><button class="phase-toggle" type="button" data-toggle-phase="unassigned" aria-expanded="${!collapsedPhases.has('unassigned')}" aria-label="Ohne Bauphase ein- oder ausklappen">${collapsedPhases.has('unassigned')?'▸':'▾'}</button><strong>Ohne Bauphase</strong><span class="phase-task-count">${unassigned.length}</span></span><small>Noch keiner Bauphase zugeordnet</small></div><div class="gantt-timeline" style="${timelineStyle}"></div></div>`;if(!collapsedPhases.has('unassigned'))unassigned.forEach(t=>{html+=taskRow(t,null)})}
 if(!list.length)html+=`<div class="gantt-empty">Keine passenden Arbeitspakete gefunden.</div>`;
 $('gantt').dataset.daySize=String(size);$('gantt').dataset.origin=origin;$('gantt').innerHTML=html;
 document.querySelectorAll('#gantt [data-id]').forEach(el=>el.onclick=()=>openTask(Number(el.dataset.id)));
 document.querySelectorAll('#gantt [data-toggle-phase]').forEach(el=>el.onclick=()=>{const id=el.dataset.togglePhase;collapsedPhases.has(id)?collapsedPhases.delete(id):collapsedPhases.add(id);renderGantt()});
 document.querySelectorAll('#gantt [data-phase-id]').forEach(el=>{el.onclick=()=>openPhase(Number(el.dataset.phaseId),true);el.onkeydown=e=>{if(e.target===el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openPhase(Number(el.dataset.phaseId),true)}}});
}
function refreshTaskContractors(selected=''){const f=$('taskForm'),trade=f.elements.namedItem('trade').value,type=f.elements.namedItem('execution_type').value,c=f.elements.namedItem('contractor_id');const matches=(project.contractors||[]).filter(x=>(x.trade||'').localeCompare(trade,'de',{sensitivity:'accent'})===0);c.innerHTML='<option value="">Keine Zuordnung</option>'+matches.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');c.disabled=type==='Eigenleistung';if(matches.some(x=>String(x.id)===String(selected)))c.value=String(selected);$('taskCompanyHelp').textContent=type==='Eigenleistung'?'Für Eigenleistungen ist kein Betrieb erforderlich.':matches.length?`${matches.length} passende Firma${matches.length===1?'':'en'} aus den Stammdaten.`:'Keine Firma mit diesem Gewerk in den Stammdaten vorhanden.'}
function openTask(id){if(taskBusy||ganttBusy)return;editing=id;let t=project.tasks.find(x=>x.id===id)||{code:'T'+String(Math.max(0,...project.tasks.map(x=>Number(x.code.replace(/\D/g,''))||0))+1).padStart(2,'0'),phase_id:null,trade:'Sonstiges',execution_type:'Noch offen',name:'',contractor_id:null,duration:1,planned_end:'',status:'Offen',actual_start:'',actual_end:'',notes:'',predecessors:[]};$('modalTitle').textContent=id?`Arbeitspaket ${t.code} bearbeiten`:'Neues Arbeitspaket';$('delete').style.display=id?'block':'none';$('complete').hidden=!id || (t.status==='Erledigt' && !!t.actual_end);$('error').textContent='';let f=$('taskForm');const names=[...new Set(['Sonstiges',...(project.trades||[]),...project.tasks.map(x=>x.trade),t.trade])].filter(Boolean);f.elements.namedItem('trade').innerHTML=names.sort((a,b)=>a.localeCompare(b,'de')).map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');f.elements.namedItem('phase_id').innerHTML='<option value="">Ohne Bauphase</option>'+(project.phases||[]).map(p=>`<option value="${p.id}">${escapeHtml(p.title)} · ab ${fmt(p.start_date)}</option>`).join('');for(let [key,value] of Object.entries(t)){if(key==='predecessors'||key==='successors'||key==='contractor_id')continue;if(f.elements.namedItem(key))f.elements.namedItem(key).value=value??''}refreshTaskContractors(t.contractor_id);let sel=f.elements.namedItem('predecessors');sel.innerHTML=project.tasks.filter(x=>x.id!==id).map(x=>`<option value="${escapeHtml(x.code)}" ${t.predecessors.includes(x.code)?'selected':''}>${escapeHtml(x.code)} — ${escapeHtml(x.name)}</option>`).join('');$('taskSuggestion').hidden=true;$('taskSuggestion').replaceChildren();let successors=f.elements.namedItem('successors');successors.innerHTML=project.tasks.filter(x=>x.id!==id).map(x=>`<option value="${escapeHtml(x.code)}" ${(t.successors||[]).includes(x.code)?'selected':''}>${escapeHtml(x.code)} — ${escapeHtml(x.name)}</option>`).join('');
 const completed=t.status==='Erledigt';$('taskLockNotice').hidden=!completed;
 for(const field of f.querySelectorAll('input,select,textarea'))field.disabled=completed&&!['notes','predecessors','successors'].includes(field.name);
 $('delete').disabled=completed;$('delete').style.display=completed||!id?'none':'block';$('complete').hidden=!id||completed;
 $('reopenTask').hidden=!completed;$('taskForm').querySelector('button[type=submit]').hidden=completed;
 $('cancel').textContent=completed?'Schließen':'Abbrechen';taskFlow.open();document.dispatchEvent(new CustomEvent('phb-task-opened',{detail:{id,completed}}))}
const taskFlow=PHBFlow.manage({dialog:'overlay',forms:['taskForm'],dismiss:['cancel','closeTask'],isBusy:()=>taskBusy,onClose:()=>{window.PHBTaskCompletion?.closed();if(phaseFlow.dialog.open)renderPhaseTaskDetails(Number($('phaseForm').elements.id.value))}});
function closeModal(){taskFlow.finish();}
$('newTask').onclick=()=>openTask(null);$('filter').oninput=()=>{renderGantt();renderTable()};$('phase').onchange=()=>{renderGantt();renderTable()};$('scale').onchange=renderGantt;$('workType').onchange=()=>{renderGantt();renderTable()};$('taskForm').elements.namedItem('trade').onchange=()=>refreshTaskContractors();$('taskForm').elements.namedItem('execution_type').onchange=()=>refreshTaskContractors($('taskForm').elements.namedItem('contractor_id').value);
$('clearSchedule').onclick=async()=>{
 if(!project.tasks.length)return;
 const response=await PHBUI.prompt('Achtung: Alle Bauzeitplan-Aufgaben und deren Abhängigkeiten werden entfernt. Andere Projektdaten bleiben bestehen. Vorher ist ein vollständiges, geprüftes Backup Pflicht. Zur Bestätigung BAUZEITPLAN LEEREN eingeben:');
 if(response!=='BAUZEITPLAN LEEREN')return;
 if(!await PHBUI.confirm('Den Bauzeitplan nach vollständigem Backup wirklich leeren?'))return;
 $('clearSchedule').disabled=true;
 try{await api('/api/tasks/clear',{method:'POST',headers:{'X-PHB-Schedule-Reset':'1'},body:JSON.stringify({confirmation:'BAUZEITPLAN LEEREN'})});$('phase').value='';$('filter').value='';$('workType').value='';await reload();message('Bauzeitenplan geleert; Komplettbackup wurde erstellt. Du kannst jetzt mit ChatGPT neu planen.')}
 catch(e){message(e.message)}
 finally{$('clearSchedule').disabled=false;renderScheduleStart()}
};
let projectStartBusy=false;
$('projectStart').onblur=async()=>{
 const input=$('projectStart'),before=project.start,next=input.value;
 if(projectStartBusy)return;
 if(!next||next===before){input.value=before;return;}
 projectStartBusy=true;input.disabled=true;
 try{
  if(!await PHBUI.confirm(`Projektstart von ${fmt(before)} auf ${fmt(next)} ändern? Alle geplanten Start- und Endtermine der Bauphasen und Arbeitspakete werden um denselben Zeitraum verschoben. Ist-Termine und Abschlussdaten bleiben erhalten.`)){input.value=before;return;}
  await api('/api/project',{method:'PATCH',body:JSON.stringify({start:next,shift_plan:true})});
  await reload();$('projectStartStatus').textContent='Projektstart gespeichert.';
 }catch(error){input.value=before;$('projectStartStatus').textContent=error.message;}
 finally{projectStartBusy=false;input.disabled=false;}
};

async function mutateTask(path,method,data,text){
 if(taskBusy)return;
 taskBusy=true;const controls=[...$('taskForm').querySelectorAll('input,select,textarea,button'),$('complete')];const wasDisabled=controls.map(n=>n.disabled);controls.forEach(n=>n.disabled=true);
 try{await api(path,{method,body:data===undefined?undefined:JSON.stringify(data)});closeModal();await reload();message(text);}
 catch(error){$('error').textContent=error.message;}
 finally{taskBusy=false;controls.forEach((n,i)=>n.disabled=wasDisabled[i]);}
}
$('taskForm').onsubmit=e=>{
 e.preventDefault();if(taskBusy)return;
 const f=$('taskForm'),data=Object.fromEntries(new FormData(f));
 for(const key of ['predecessors','successors'])data[key]=[...f.elements.namedItem(key).selectedOptions].map(o=>o.value);
 mutateTask(editing?'/api/tasks/'+editing:'/api/tasks',editing?'PUT':'POST',data,'Arbeitspaket gespeichert');
};
$('complete').onclick=()=>{if(editing)mutateTask('/api/tasks/'+editing+'/complete','POST',{},'Arbeitspaket abgeschlossen');};
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
    t.status!=='Erledigt'&&t.execution_type!=='Eigenleistung'&&!t.contractor_id&&!(t.company||'').trim());
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
$('delete').onclick=async()=>{
 if(taskBusy||!editing)return;
 if(!await PHBUI.confirm('Arbeitspaket löschen? Nachfolger bleiben erhalten und werden mit seinen bisherigen Vorgängern verbunden. Kostenverknüpfungen verhindern das Löschen.'))return;
 await mutateTask('/api/tasks/'+editing,'DELETE',undefined,'Arbeitspaket gelöscht; Abhängigkeiten verbunden');
};
$('today').onclick=()=>{const container=document.querySelector('.ganttwrap'),host=$('gantt');const n=diff(host.dataset.origin||project.start,new Date().toISOString().slice(0,10));container.scrollLeft=Math.max(0,n*Number(host.dataset.daySize||26)-160)};
reload().then(()=>{if(new URLSearchParams(location.search).get('firmenvorschlaege')==='1')$('companySuggestions').click();});
document.addEventListener('phb-ai-status',renderScheduleStart);

function syncBulkSelection(){
 const ids=new Set(project.tasks.map(t=>t.id));for(const id of selectedTasks)if(!ids.has(id))selectedTasks.delete(id);
 const hidden=[...selectedTasks].filter(id=>!visible().some(t=>t.id===id)).length;
 $('bulkCount').textContent=selectedTasks.size+' ausgewählt'+(hidden?' · '+hidden+' außerhalb des Filters':'');
 for(const control of document.querySelectorAll('.task-bulk-toolbar input,.task-bulk-editor select,#bulkClear'))control.disabled=taskBusy;
 $('bulkComplete').disabled=!selectedTasks.size||taskBusy;$('bulkEdit').disabled=!selectedTasks.size||taskBusy;
 const rows=visible();$('selectAllTasks').checked=rows.length>0&&rows.every(t=>selectedTasks.has(t.id));
 $('selectAllTasks').indeterminate=rows.some(t=>selectedTasks.has(t.id))&&!$('selectAllTasks').checked;
}
$('taskRows').addEventListener('change',e=>{const input=e.target.closest('[data-select-task]');if(!input)return;const id=Number(input.dataset.selectTask);input.checked?selectedTasks.add(id):selectedTasks.delete(id);syncBulkSelection()});
$('selectAllTasks').onchange=e=>{visible().forEach(t=>e.target.checked?selectedTasks.add(t.id):selectedTasks.delete(t.id));renderTable()};
$('bulkClear').onclick=()=>{selectedTasks.clear();renderTable();$('bulkEditor').hidden=true};
function bulkValues(){
 const field=$('bulkField').value;
 let options=field==='phase_id'?[['','Ohne Bauphase'],...(project.phases||[]).map(p=>[p.id,p.title])]:
 field==='trade'?(project.trades||[]).map(t=>[t,t]):
 field==='execution_type'?['Noch offen','Eigenleistung','Fremdleistung'].map(x=>[x,x]):
 field==='status'?['Offen','In Arbeit','Pausiert'].map(x=>[x,x]):
 [['','Firma entfernen'],...(project.contractors||[]).filter(c=>[...selectedTasks].every(id=>{const t=project.tasks.find(t=>t.id===id);return t&&t.execution_type!=='Eigenleistung'&&t.trade.toLocaleLowerCase('de-DE')===(c.trade||'').toLocaleLowerCase('de-DE')})).map(c=>[c.id,c.name])];
 $('bulkValue').innerHTML=options.map(([value,label])=>`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
}
$('bulkEdit').onclick=()=>{if([...selectedTasks].some(id=>project.tasks.find(t=>t.id===id)?.status==='Erledigt')){message('Abgeschlossene Arbeitspakete bitte aus der Auswahl entfernen.');return;}$('bulkEditor').hidden=false;bulkValues()};
$('bulkField').onchange=bulkValues;
async function bulkAction(complete){
 if(taskBusy||!selectedTasks.size)return;
 const ids=[...selectedTasks],changes={[$('bulkField').value]:$('bulkValue').value};
 if(!await PHBUI.confirm(`${ids.length} Arbeitspakete ${complete?'abschließen':'gemeinsam ändern'}?`))return;
 if(taskBusy)return;
 taskBusy=true;syncBulkSelection();$('bulkSave').disabled=true;
 try{const data=await api('/api/tasks/bulk',{method:'POST',body:JSON.stringify(complete?{ids,action:'complete'}:{ids,changes})});selectedTasks.clear();$('bulkEditor').hidden=true;await reload();message(data.changed+' Arbeitspakete aktualisiert.');}
 catch(error){await PHBUI.alert(error.message)}
 finally{taskBusy=false;$('bulkSave').disabled=false;syncBulkSelection()}
}
$('bulkComplete').onclick=()=>bulkAction(true);$('bulkSave').onclick=()=>bulkAction(false);
$('toggleAllPhases').onclick=()=>{const ids=[...(project.phases||[]).map(p=>String(p.id)),'unassigned'];const all=ids.every(id=>collapsedPhases.has(id));ids.forEach(id=>all?collapsedPhases.delete(id):collapsedPhases.add(id));$('toggleAllPhases').textContent=all?'Alle einklappen':'Alle ausklappen';renderGantt()};
