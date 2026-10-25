(()=>{
 'use strict';
 const $=id=>document.getElementById(id),form=$('energyFundingForm'),dialog=$('energyFundingDialog');
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const euro=n=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(n||0);
 let data=null,current=null,busy=false,dirty=false;
 async function api(url,method='GET',body){const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'Speichern fehlgeschlagen.');return d;}
 async function load(){data=await api('/api/energy-planning');render();}
 function render(){
  $('energyExpected').textContent=euro(data.summary.funding_expected);$('energyConfirmed').textContent=euro(data.summary.funding_confirmed);$('energyReceived').textContent=euro(data.received);$('energyNet').textContent=euro(data.summary.net_after_confirmed);
  const term=$('energySearch').value.toLocaleLowerCase('de');
  $('energyRows').innerHTML=data.funding.filter(f=>[f.name,f.program,f.provider,f.status].join(' ').toLocaleLowerCase('de').includes(term)).map(f=>{
   const offer=data.offers.find(o=>o.id===f.offer_id),line=data.budget_lines.find(b=>b.id===f.budget_line_id);
   return `<tr><td><strong>${esc(f.name)}</strong><div>${esc([f.provider,f.program].filter(Boolean).join(' · '))}</div></td><td>${esc(f.status)}<div>${esc(f.deadline||'Keine Frist erfasst')}</div></td><td>${offer?`<a href="/angebote?offer_id=${offer.id}">${esc(offer.vendor)}</a>`:''}<div>${esc(line?.title||'')}</div></td><td>${euro(f.expected)}</td><td>${euro(f.confirmed)}</td><td>${euro(f.received)}</td><td><button data-funding-id="${f.id}" type="button">Bearbeiten</button></td></tr>`;
  }).join('')||'<tr><td colspan="7">Noch keine passenden Förderungen erfasst.</td></tr>';
  $('energyRows').querySelectorAll('[data-funding-id]').forEach(b=>b.onclick=()=>open(Number(b.dataset.fundingId)));
 }
 function open(id=null,offerId=null){
  current=id;form.reset();
  $('energyStatus').replaceChildren(...data.statuses.map(s=>new Option(s,s)));
  $('energyOffer').replaceChildren(new Option('Keine Zuordnung',''),...data.offers.map(o=>new Option(o.vendor+' · '+o.category+' · '+o.status,o.id)));
  $('energyBudgetLine').replaceChildren(new Option('Keine Zuordnung',''),...data.budget_lines.map(b=>new Option(b.category+' · '+b.title,b.id)));
  const record=data.funding.find(f=>f.id===id);
  if(record){for(const [key,value] of Object.entries(record)){const field=form.elements.namedItem(key);if(field)field.value=value??'';}}
  else if(offerId){const offer=data.offers.find(o=>o.id===offerId);if(offer){form.elements.namedItem('offer_id').value=offerId;form.elements.namedItem('name').value='Förderprüfung: '+offer.category;}}
  PHBUI.currency.bind(form);$('deleteEnergyFunding').hidden=!id;$('energyFormMessage').textContent='';dirty=false;dialog.showModal();
 }
 async function close(){if(!busy&&(!dirty||await PHBUI.confirm('Ungespeicherte Förderdaten verwerfen?')))dialog.close();}
 form.oninput=()=>{dirty=true;};$('closeEnergyFunding').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
 async function persist(remove=false){
  if(busy)return;
  if(remove&&!await PHBUI.confirm('Diese Förderung endgültig aus der Planung löschen?'))return;
  let payload;
  if(!remove){
   if(!form.reportValidity())return;
   payload=Object.fromEntries(new FormData(form));
   for(const key of ['expected','confirmed','received']){
    const amount=PHBUI.currency.parse(payload[key]);if(!Number.isFinite(amount)||amount<0){$('energyFormMessage').textContent='Bitte gültige Eurobeträge eingeben.';return;}payload[key]=amount;
   }
  }
  busy=true;const controls=[...form.querySelectorAll('input,select,textarea,button')];controls.forEach(n=>n.disabled=true);
  try{await api('/api/funding'+(current?'/'+current:''),remove?'DELETE':current?'PUT':'POST',payload);dirty=false;dialog.close();await load();}
  catch(e){$('energyFormMessage').textContent=e.message;}
  finally{busy=false;controls.forEach(n=>n.disabled=false);}
 }
 form.onsubmit=e=>{e.preventDefault();persist();};$('deleteEnergyFunding').onclick=()=>persist(true);
 $('addEnergyFunding').onclick=()=>open();$('energySearch').oninput=render;
 load().then(()=>{const id=Number(new URLSearchParams(location.search).get('offer_id'));if(id>0)open(null,id);}).catch(e=>{$('energyMessage').textContent=e.message;});
})();
