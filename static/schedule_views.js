/* Calendar and week views share the existing task/phase editors and move command. */
(()=>{
 'use strict';
 const M=window.PHBScheduleCalendar,host=$('scheduleCalendar'),today=()=>new Date().toLocaleDateString('sv-SE');
 const storage='phb-schedule-view:'+(window.PHBProject?.id||new URLSearchParams(location.search).get('project_id')||1);
 let view='week',anchor=today(),quick='',initialized=false,gesture=null,suppressClick=0,dayContext=null;
 try{const saved=localStorage.getItem(storage);if(['week','month','gantt'].includes(saved))view=saved;}catch{}
 const dayFlow=PHBFlow.manage({dialog:'calendarDayDialog',dismiss:['closeCalendarDay'],track:false,isBusy:()=>ganttBusy});
 const palette=['#6d9851','#548b88','#899746','#6c80a2','#9b805b','#8b7097'];
 const color=task=>task.phase_id?palette[Math.abs(Number(task.phase_id))%palette.length]:'#84958c';
 const periodLabel=(start,end)=>new Intl.DateTimeFormat('de-DE',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).formatRange(new Date(start+'T12:00:00Z'),new Date(end+'T12:00:00Z'));
 function matches(task,ignoreQuick=false){
  return (!$('calendarTrade').value||task.trade===$('calendarTrade').value)
   &&(!$('calendarCompany').value||($('calendarCompany').value==='unassigned'?!task.contractor_id&&!assignedCompany(task):String(task.contractor_id)===$('calendarCompany').value))
   &&(!$('calendarStatus').value||task.status===$('calendarStatus').value)
   &&(ignoreQuick||M.quickMatch(task,quick,today()));
 }
 function hasFilters(){return !!(quick||$('calendarTrade').value||$('calendarCompany').value||$('calendarStatus').value);}
 function options(id,rows,empty){const node=$(id),previous=node.value;node.innerHTML=`<option value="">${empty}</option>`+rows.map(([value,label])=>`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');if(rows.some(([value])=>String(value)===previous))node.value=previous;}
 function refreshOptions(){
  const before=$('calendarTrade').value+'|'+$('calendarCompany').value;
  options('calendarTrade',[...new Set([...(project.trades||[]),...project.tasks.map(task=>task.trade)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de')).map(name=>[name,name]),'Alle Gewerke');
  options('calendarCompany',[['unassigned','Ohne Betrieb'],...(project.contractors||[]).map(company=>[company.id,company.name])],'Alle Betriebe');
  return before!==$('calendarTrade').value+'|'+$('calendarCompany').value;
 }
 function applyView(){
  const gantt=view==='gantt';
  $('scheduleGanttView').hidden=!gantt;$('scheduleCalendarView').hidden=gantt;$('scheduleGanttHelp').hidden=!gantt;
  $('toggleAllPhases').hidden=!gantt;$('ganttScaleControl').hidden=!gantt;
  for(const id of ['calendarPrevious','calendarNext','calendarPeriod'])$(id).hidden=gantt;
  $('scheduleViewTitle').textContent=gantt?'Ablaufplan':view==='month'?'Monatskalender':'Wochenplan';
  document.querySelectorAll('[data-schedule-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scheduleView===view)));
  $('scheduleCalendarView').dataset.view=view;
 }
 function taskButton(task,segment){
  const before=segment.continuesBefore?'‹ ':'',after=segment.continuesAfter?' ›':'',done=task.status==='Erledigt';
  const due=M.overdue(task,today())?' overdue':task.deadline_status==='due-soon'?' due-soon':'';
  const relation=(task.predecessors||[]).length+(task.successors||[]).length;
  const title=[task.code+' · '+task.name,task.phase||'Ohne Bauphase',assignedCompany(task)||task.trade,task.status,'Berechnet: '+fmt(task.start)+' – '+fmt(task.end),task.planned_end?'Fester Endtermin: '+fmt(task.planned_end):'Kein fester Endtermin',relation?relation+' Abhängigkeiten':''].filter(Boolean).join(' · ');
  return `<button type="button" class="schedule-calendar-event${due}${done?' is-complete':''}${task.status==='Pausiert'?' is-paused':''}" data-calendar-task="${task.id}" data-calendar-start="${task.start}" style="grid-column:${segment.column+1}/span ${segment.span};grid-row:${segment.lane+1};--phase-accent:${color(task)}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"><strong>${before}${escapeHtml(task.name)}${after}</strong>${view==='week'?`<small><span class="schedule-task-state">${escapeHtml(task.status)}</span> · ${escapeHtml(assignedCompany(task)||task.trade||'Ohne Betrieb')}${relation?' · ↔':''}</small>`:''}</button>`;
 }
 function phaseSegments(start,end,tasks){
  const selected=$('phase').value;
  if(selected==='unassigned')return [];
  return M.segments((project.phases||[]).filter(phase=>!selected||String(phase.id)===selected).map(phase=>{
   const children=project.tasks.filter(task=>task.phase_id===phase.id);
   const last=children.map(task=>task.end).filter(M.valid).sort().at(-1)||phase.start_date;
   return {...phase,start:phase.start_date,end:phase.end_date||last,children};
  }).filter(phase=>tasks.some(task=>task.phase_id===phase.id&&M.intersects(task,start,end))||!phase.children.length&&!hasFilters()&&!$('filter').value&&!$('workType').value),start,end);
 }
 function week(start,tasks){
  const end=M.add(start,6),dates=Array.from({length:7},(_,index)=>M.add(start,index));
  const segments=M.segments(tasks.map(task=>({...task,...(M.taskRange(task)||{start:'',end:''})})),start,end);
  const max=view==='month'?3:Infinity,shown=segments.filter(segment=>segment.lane<max);
  const phases=phaseSegments(start,end,tasks),maxPhases=view==='month'?2:Infinity;
  const phaseBars=phases.filter(segment=>segment.lane<maxPhases).map(segment=>`<button type="button" class="schedule-calendar-phase${segment.item.completed?' is-complete':''}" data-calendar-phase="${segment.item.id}" style="grid-column:${segment.column+1}/span ${segment.span};grid-row:${segment.lane+1};--phase-accent:${color({phase_id:segment.item.id})}" title="${escapeHtml(segment.item.title)} · ${fmt(segment.item.start_date)}${segment.item.end_date?' – '+fmt(segment.item.end_date):' · Ende offen'}">${segment.item.completed?'✓ ':''}${escapeHtml(segment.item.title)}</button>`).join('');
  const headers=dates.map((date,index)=>`<button type="button" class="schedule-day-heading${index>=5?' is-weekend':''}${date===today()?' is-today':''}${view==='month'&&date.slice(0,7)!==anchor.slice(0,7)?' is-other-month':''}" data-view-date="${date}" title="Woche ab ${fmt(M.monday(date))} anzeigen">${['Mo','Di','Mi','Do','Fr','Sa','So'][index]} <span>${view==='month'?Number(date.slice(8)):fmt(date).slice(0,5)}</span></button>`).join('');
  const background=dates.map((date,index)=>`<div class="schedule-week-column${index>=5?' is-weekend':''}${date===today()?' is-today':''}" data-calendar-date="${date}"></div>`).join('');
  const more=dates.map(date=>{const hidden=segments.filter(segment=>segment.lane>=max&&segment.start<=date&&segment.end>=date).length;return hidden?`<button type="button" class="schedule-day-more" data-calendar-more="${date}">+ ${hidden} weitere</button>`:'<span></span>';}).join('');
  const remaining=phases.filter(segment=>segment.lane>=maxPhases).map(segment=>segment.item.id);
  return `<section class="schedule-calendar-week" data-calendar-week="${start}" aria-label="${escapeHtml(periodLabel(start,end))}"><div class="schedule-calendar-days">${headers}</div><div class="schedule-calendar-body"><div class="schedule-week-background">${background}</div>${phaseBars?`<div class="schedule-phase-grid">${phaseBars}</div>`:''}${remaining.length?`<button type="button" class="schedule-more-phases" data-calendar-phases="${remaining.join(',')}">Weitere Bauphasen (${remaining.length})</button>`:''}<div class="schedule-event-grid" style="grid-template-rows:repeat(${Math.max(1,...shown.map(segment=>segment.lane+1))},${view==='month'?27:53}px)">${shown.map(segment=>taskButton(segment.item,segment)).join('')}</div>${segments.some(segment=>segment.lane>=max)?`<div class="schedule-day-overflow">${more}</div>`:''}${!segments.length?'<p class="schedule-week-empty">Keine Arbeitspakete in diesem Zeitraum.</p>':''}</div></section>`;
 }
 function row(task){return `<button type="button" class="schedule-context-task${M.overdue(task,today())?' is-overdue':''}" data-calendar-task="${task.id}"><span><strong>${escapeHtml(task.code)} · ${escapeHtml(task.name)}</strong><small>${escapeHtml(assignedCompany(task)||task.trade||'Ohne Betrieb')} · ${escapeHtml(task.status)}</small></span><small>${task.start?fmt(task.start):'Ohne Termin'}${task.planned_end?' · Ziel '+fmt(task.planned_end):' · Endtermin offen'}</small></button>`;}
 function renderDay(){
  if(!dayContext)return;
  if(dayContext.phases){$('calendarDayTitle').textContent='Bauphasen';$('calendarDayTasks').innerHTML=project.phases.filter(phase=>dayContext.phases.includes(phase.id)).map(phase=>`<button type="button" class="schedule-context-task" data-calendar-phase="${phase.id}">${escapeHtml(phase.title)}</button>`).join('');return;}
  $('calendarDayTitle').textContent='Arbeitspakete am '+fmt(dayContext.date);
  $('calendarDayTasks').innerHTML=visible().filter(task=>M.intersects(task,dayContext.date,dayContext.date)).map(row).join('')||'<p>Keine Arbeitspakete.</p>';
 }
 function render(){
  if(!initialized&&project.start&&project.tasks.length){initialized=true;const first=project.tasks.map(task=>task.start).filter(M.valid).sort()[0];if(first&&first>today())anchor=first;}
  applyView();
  const tasks=visible(),base=visible(true),period=M.period(view==='month'?'month':'week',anchor);
  $('scheduleQuickFilters').innerHTML=[['overdue','Überfällig'],['week','Diese Woche'],['running','Laufend'],['open-end','Endtermin offen']].map(([key,label])=>`<button type="button" data-calendar-quick="${key}" class="schedule-quick-filter${key==='overdue'?' is-overdue':''}" aria-pressed="${quick===key}">${label}<span>${base.filter(task=>M.quickMatch(task,key,today())).length}</span></button>`).join('');
  $('calendarPeriod').textContent=view==='month'?new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(anchor+'T12:00:00Z')):periodLabel(period.start,period.end);
  if(view!=='gantt'){
   let markup='';for(let date=period.start;date<=period.end;date=M.add(date,7))markup+=week(date,tasks);host.innerHTML=markup;
   const outside=tasks.filter(task=>!M.intersects(task,period.start,period.end)&&(quick||!M.valid(task.start)||M.running(task)||task.status!=='Erledigt'&&!task.planned_end&&task.start<=today()));
   $('scheduleCalendarContext').innerHTML=outside.length?`<details class="schedule-context" open><summary>${quick?'Weitere Arbeitspakete zum Filter':'Laufende und offene Arbeitspakete außerhalb dieses Zeitraums'} (${outside.length})</summary><div>${outside.slice(0,8).map(row).join('')}</div>${outside.length>8?'<button type="button" data-calendar-list>Alle passenden Arbeitspakete anzeigen</button>':''}</details>`:'';
  }
  if(dayFlow.dialog.open)renderDay();
 }
 function refresh(){renderGantt();renderTable();render();}
 function setView(next){view=next;try{localStorage.setItem(storage,view);}catch{}applyView();refresh();}
 window.PHBScheduleViews={matches,hasFilters,render,view:()=>view};
 document.addEventListener('phb-schedule-updated',()=>{if(refreshOptions()){renderGantt();renderTable();}render();});
 document.querySelectorAll('[data-schedule-view]').forEach(button=>button.onclick=()=>setView(button.dataset.scheduleView));
 $('calendarPrevious').onclick=()=>{anchor=view==='month'?M.month(anchor,-1):M.add(anchor,-7);render();};
 $('calendarNext').onclick=()=>{anchor=view==='month'?M.month(anchor,1):M.add(anchor,7);render();};
 const originalToday=$('today').onclick;
 $('today').onclick=()=>{if(view==='gantt')originalToday();else{anchor=today();render();}};
 for(const id of ['filter','phase','workType'])$(id).addEventListener(id==='filter'?'input':'change',render);
 for(const id of ['calendarTrade','calendarCompany','calendarStatus']){$(id).onchange=refresh;window.PHBUI?.decorateSelect($(id),'filter');}
 $('resetScheduleFilters').onclick=()=>{for(const id of ['filter','phase','workType','calendarTrade','calendarCompany','calendarStatus'])$(id).value='';quick='';refresh();};
 $('scheduleQuickFilters').onclick=event=>{const button=event.target.closest('[data-calendar-quick]');if(button){quick=quick===button.dataset.calendarQuick?'':button.dataset.calendarQuick;refresh();}};
 document.addEventListener('click',event=>{
  const task=event.target.closest('[data-calendar-task]');if(task){if(ganttBusy||Date.now()<suppressClick&&task.classList.contains('schedule-calendar-event'))return;openTask(Number(task.dataset.calendarTask));return;}
  const phase=event.target.closest('[data-calendar-phase]');if(phase){openPhase(Number(phase.dataset.calendarPhase),true);return;}
  const day=event.target.closest('[data-calendar-more]');if(day){dayContext={date:day.dataset.calendarMore};renderDay();dayFlow.open();return;}
  const phases=event.target.closest('[data-calendar-phases]');if(phases){dayContext={phases:phases.dataset.calendarPhases.split(',').map(Number)};renderDay();dayFlow.open();return;}
  const date=event.target.closest('[data-view-date]');if(date){anchor=date.dataset.viewDate;setView('week');return;}
  if(event.target.closest('[data-calendar-list]'))taskListFlow.open();
 });
 async function move(task,start){
  if(ganttBusy||taskBusy||task.status==='Erledigt'||!M.valid(start)||start===task.start)return;
  ganttBusy=true;host.setAttribute('aria-busy','true');
  try{
   const end=M.add(start,M.distance(task.start,task.end));
   const confirm=await PHBUI.confirm(`${task.code} „${task.name}“ auf ${fmt(start)} bis ${fmt(end)} verschieben? Die Dauer bleibt gleich. Vorgänger und Bauphase werden geprüft; nachfolgende Termine werden neu berechnet.${task.planned_end?' Der feste Endtermin '+fmt(task.planned_end)+' bleibt bestehen.':''}`);
   if(!confirm){$('ganttStatus').textContent='Verschieben abgebrochen.';return;}
   const result=await api('/api/tasks/'+task.id+'/move',{method:'POST',body:JSON.stringify({start,plan_digest:project.plan_digest})});
   await reload();$('ganttStatus').textContent=task.code+': '+fmt(result.start)+' – '+fmt(result.end)+'. Abhängige Termine wurden geprüft.';
  }catch(error){await reload();$('ganttStatus').textContent=error.message;await PHBUI.alert(error.message);}
  finally{ganttBusy=false;host.removeAttribute('aria-busy');}
 }
 function targetDate(x,y){
  for(const section of host.querySelectorAll('[data-calendar-week]')){const rect=section.getBoundingClientRect();if(x>=rect.left&&x<rect.right&&y>=rect.top&&y<rect.bottom)return M.add(section.dataset.calendarWeek,Math.min(6,Math.floor((x-rect.left)/(rect.width/7))));}
  return null;
 }
 function stop(){if(!gesture)return null;const ended=gesture;gesture=null;ended.button.classList.remove('is-dragging');if(ended.button.hasPointerCapture?.(ended.pointer))ended.button.releasePointerCapture(ended.pointer);host.querySelectorAll('.is-drop-target').forEach(node=>node.classList.remove('is-drop-target'));return ended;}
 host.addEventListener('pointerdown',event=>{const button=event.target.closest('.schedule-calendar-event');if(!button||event.button!==0||ganttBusy||taskBusy)return;const task=project.tasks.find(task=>task.id===Number(button.dataset.calendarTask));if(!task||task.status==='Erledigt')return;gesture={button,task,x:event.clientX,y:event.clientY,pointer:event.pointerId,moved:false,source:targetDate(event.clientX,event.clientY),target:null};button.setPointerCapture(event.pointerId);});
 host.addEventListener('pointermove',event=>{if(!gesture||gesture.pointer!==event.pointerId)return;if(!gesture.moved&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<7)return;gesture.moved=true;event.preventDefault();gesture.button.classList.add('is-dragging');gesture.target=targetDate(event.clientX,event.clientY);host.querySelectorAll('[data-calendar-date]').forEach(node=>node.classList.toggle('is-drop-target',node.dataset.calendarDate===gesture.target));if(gesture.target&&gesture.source)$('ganttStatus').textContent=gesture.task.code+' → '+fmt(M.add(gesture.task.start,M.distance(gesture.source,gesture.target)))+' · Loslassen zur Bestätigung, Escape zum Abbrechen.';});
 host.addEventListener('pointerup',event=>{if(!gesture||gesture.pointer!==event.pointerId)return;const ended=stop();if(!ended.moved)return;event.preventDefault();suppressClick=Date.now()+500;if(ended.target&&ended.source)void move(ended.task,M.add(ended.task.start,M.distance(ended.source,ended.target)));else $('ganttStatus').textContent='Verschieben abgebrochen.';});
 host.addEventListener('pointercancel',()=>{if(stop())$('ganttStatus').textContent='Verschieben abgebrochen.';});
 host.addEventListener('keydown',event=>{if(event.key==='Escape'&&gesture){stop();suppressClick=Date.now()+500;event.preventDefault();$('ganttStatus').textContent='Verschieben abgebrochen.';return;}const button=event.target.closest('.schedule-calendar-event');if(!button||!event.altKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const task=project.tasks.find(task=>task.id===Number(button.dataset.calendarTask));if(task)void move(task,M.add(task.start,(event.key==='ArrowRight'?1:-1)*(event.shiftKey?7:1)));});
 refreshOptions();render();
})();
