'use strict';
const el=id=>document.getElementById(id);
const euro=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(value)||0);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const groupLabels={category:'Gewerk / Kategorie',kind:'Ausführungsart',phase:'Bauphase',task:'Arbeitspaket',company:'Firma'};
let state={dashboard:{rows:[],issues:[],totals:{}}};
const detailsFlow=PHBFlow.manage({dialog:'costDetailsDialog',dismiss:['closeCostDetails'],track:false});

async function load(){
  const response=await fetch('/api/cost-dashboard');
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Kosten konnten nicht geladen werden.');
  state=data;render();
}

function render(){
  const summary=state.summary||{},dashboard=state.dashboard||{rows:[],issues:[],totals:{}};
  const gap=(Number(summary.budget)||0)-(Number(summary.planned)||0);
  el('budget').textContent=euro(summary.budget);
  el('forecast').textContent=euro(summary.planned);
  el('paid').textContent=euro(summary.paid);
  el('bufferLabel').textContent=gap>=0?'Puffer':'Finanzierungslücke';
  el('buffer').textContent=euro(Math.abs(gap));
  el('buffer').className=gap<0?'negative':'positive';
  el('bufferHint').textContent=gap>=0?'Finanzierungsrahmen minus Prognose':'Prognose über dem Finanzierungsrahmen';
  renderPipeline(dashboard.totals||{});
  renderIssues(dashboard.issues||[]);
  renderGroups();
}

function renderPipeline(totals){
  const values=[['Prognose',totals.forecast],['Beauftragt',totals.committed],['Abgerechnet',totals.invoiced],['Bezahlt',totals.paid]];
  const max=Math.max(...values.map(item=>Number(item[1])||0),1);
  el('costPipeline').innerHTML=values.map(([label,value],index)=>`<div class="cost-pipeline-step"><div><span>${esc(label)}</span><strong>${euro(value)}</strong></div><div class="cost-pipeline-track" aria-hidden="true"><span style="width:${Math.min(100,(Number(value)||0)/max*100)}%"></span></div>${index<values.length-1?'<svg class="phb-icon cost-pipeline-arrow" aria-hidden="true"><use href="/static/icons/ui-icons.svg#chevron-right"></use></svg>':''}</div>`).join('');
}

function renderIssues(issues){
  el('costIssuesPanel').hidden=!issues.length;
  el('costIssues').innerHTML=issues.map(issue=>`<a class="cost-issue" href="${esc(issue.url)}"><span class="cost-issue-count">${Number(issue.count)||0}</span><span><strong>${esc(issue.title)}</strong><small>${esc(issue.text)}</small></span><svg class="phb-icon" aria-hidden="true"><use href="/static/icons/ui-icons.svg#chevron-right"></use></svg></a>`).join('');
}

function filteredRows(){
  const query=el('costSearch').value.trim().toLocaleLowerCase('de');
  if(!query)return state.dashboard.rows||[];
  return (state.dashboard.rows||[]).filter(row=>[row.title,row.category,row.trade,row.kind,row.phase,row.task,row.company,row.basis].join(' ').toLocaleLowerCase('de').includes(query));
}

function groupedRows(){
  const key=el('costGroup').value,groups=new Map();
  for(const row of filteredRows()){
    let name=(key==='category'?(row.trade||row.category):row[key])||'Nicht zugeordnet';
    if(!groups.has(name))groups.set(name,{name,forecast:0,committed:0,invoiced:0,paid:0,open:0,rows:[]});
    const group=groups.get(name);group.rows.push(row);
    for(const field of ['forecast','committed','invoiced','paid','open'])group[field]+=Number(row[field])||0;
  }
  return [...groups.values()].sort((a,b)=>b.forecast-a.forecast||a.name.localeCompare(b.name,'de'));
}

function renderGroups(){
  const groups=groupedRows(),label=groupLabels[el('costGroup').value];
  el('costGroupHeading').textContent=label;
  el('costResultCount').textContent=groups.length?`${groups.length} ${groups.length===1?'Gruppe':'Gruppen'} aus ${filteredRows().length} Kostenpositionen`:'Keine passenden Kostenpositionen';
  el('costOverviewRows').innerHTML=groups.map((group,index)=>`<tr><td><strong>${esc(group.name)}</strong><small>${group.rows.length} ${group.rows.length===1?'Position':'Positionen'}</small></td><td class="amount">${euro(group.forecast)}</td><td class="amount">${euro(group.committed)}</td><td class="amount">${euro(group.invoiced)}</td><td class="amount">${euro(group.paid)}</td><td class="amount">${euro(group.open)}</td><td><button type="button" class="cost-detail-button" data-group-index="${index}" title="Zusammensetzung anzeigen" aria-label="Zusammensetzung von ${esc(group.name)} anzeigen"><svg class="phb-icon" aria-hidden="true"><use href="/static/icons/ui-icons.svg#chevron-right"></use></svg></button></td></tr>`).join('')||'<tr><td colspan="7" class="cost-empty">Noch keine Kostendaten vorhanden.</td></tr>';
  el('costOverviewRows').querySelectorAll('[data-group-index]').forEach(button=>button.onclick=()=>openDetails(groups[Number(button.dataset.groupIndex)]));
}

function openDetails(group){
  el('costDetailsTitle').textContent=group.name;
  el('costDetailsSummary').textContent=`${group.rows.length} ${group.rows.length===1?'Position':'Positionen'} · Prognose ${euro(group.forecast)}`;
  el('costDetailsRows').innerHTML=group.rows.sort((a,b)=>b.forecast-a.forecast).map(row=>`<tr><td><strong>${esc(row.title)}</strong><small>${esc(row.source)}${row.company?' · '+esc(row.company):''}</small></td><td><span class="cost-basis">${esc(row.basis)}</span></td><td class="amount">${euro(row.forecast)}</td><td class="amount">${euro(row.invoiced)}</td><td class="amount">${euro(row.paid)}</td><td><a class="cost-source-link" href="${esc(row.url)}">Öffnen</a></td></tr>`).join('');
  detailsFlow.open();
}

el('costSearch').addEventListener('input',renderGroups);
el('costGroup').addEventListener('change',renderGroups);
load().catch(error=>PHBUI.alert(error.message));
