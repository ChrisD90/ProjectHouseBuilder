'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  let companies=[],trades=[],categories=[],activeCompany=null,companyBusy=false,researchBusy=false,researchGeneration=0,suppressedName="";
  const companyFlow=PHBFlow.manage({
    dialog:'companyDialog',forms:['companyForm'],
    dismiss:['closeCompany'],isBusy:()=>companyBusy||researchBusy,
    onClose:()=>{researchGeneration++;}
  });
  const note=(text,error=false)=>{
    const node=$('masterNotice');
    node.hidden=false;node.textContent=text;node.classList.toggle('error',error);
  };
  async function api(url,method='GET',data){
    const opts={method};
    if(data!==undefined){
      opts.headers={'Content-Type':'application/json'};
      opts.body=JSON.stringify(data);
    }
    const response=await fetch(url,opts);
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Daten konnten nicht gespeichert werden.');
    return result;
  }
  async function reload(){
    const [cost,tr,cat]=await Promise.all([
      api('/api/costs'),api('/api/trades'),api('/api/categories')
    ]);
    companies=cost.contractors||[];
    trades=tr.trades||[];
    categories=cat.categories||[];
    drawCompanies();drawReferenceLists();
  }
  function drawCompanies(){
    const term=$('companySearch').value.trim().toLocaleLowerCase('de');
    const filtered=companies.filter(x=>
      [x.name,x.trade,x.contact,x.contact_secondary,x.phone,x.mobile,
       x.phone_other,x.email,x.address].some(y=>
         String(y||'').toLocaleLowerCase('de').includes(term)));
    $('companyCount').textContent=filtered.length+' von '+companies.length+' Firmen';
    $('companyRows').innerHTML=filtered.map(c=>{
      const imported=String(c.notes||'').includes('Aus PDF-Angebot eingelesen');
      const contact=[c.contact,c.contact_secondary].filter(Boolean).map(esc).join(' · ')||'–';
      const numbers=[c.phone,c.mobile,c.phone_other].filter(Boolean).map(esc).join(' · ');
      return `<tr>
        <td><strong>${esc(c.name)}</strong>
          ${imported?'<small class="master-source">Aus Angebot übernommen</small>':''}</td>
        <td>${esc(c.trade||'–')}</td>
        <td>${contact}</td>
        <td><div class="master-contact-info">
          <span>${numbers||'–'}</span>
          ${c.email?'<span>'+esc(c.email)+'</span>':''}
          ${c.address?'<small>'+esc(c.address)+'</small>':''}
        </div></td>
        <td><button type="button" data-company="${c.id}">Bearbeiten</button></td>
      </tr>`;
    }).join('')||'<tr><td colspan="5">Keine passenden Firmen vorhanden.</td></tr>';
    $('companyRows').querySelectorAll('[data-company]').forEach(button=>
      button.addEventListener('click',()=>openCompany(Number(button.dataset.company))));
  }
  function drawReferenceLists(){
    function render(container,records,kind){
      const term=$(kind+'Search').value.trim().toLocaleLowerCase('de');
      $(container).innerHTML=records.filter(item=>item.name.toLocaleLowerCase('de').includes(term)).map(item=>`<div class="master-tag-row">
        <strong>${esc(item.name)}</strong>
        <span class="master-tag-actions">
          <button type="button" data-${kind}-rename="${item.id}">Umbenennen</button>
          <button type="button" class="danger" data-${kind}-delete="${item.id}"
            ${kind==='category'&&item.name==='Sonstiges'?'disabled':''}>Löschen</button>
        </span>
      </div>`).join('')||'<p class="master-empty">Noch keine Einträge.</p>';
      $(container).querySelectorAll('[data-'+kind+'-rename]').forEach(button=>
        button.onclick=()=>modifyEntry(kind,Number(button.dataset[kind+'Rename']),'rename'));
      $(container).querySelectorAll('[data-'+kind+'-delete]').forEach(button=>
        button.onclick=()=>modifyEntry(kind,Number(button.dataset[kind+'Delete']),'delete'));
    }
    render('tradeRows',trades,'trade');
    render('categoryRows',categories,'category');
  }
  function openCompany(id=null){
    if(companyBusy||researchBusy)return;
    activeCompany=companies.find(c=>c.id===id)||null;
    researchGeneration++;suppressedName='';
    $('companyResearchOffer').hidden=true;$('companyResearchResults').replaceChildren();$('companyResearchStatus').textContent='';$('companyResearchLocation').value='';
    $('companyForm').reset();
    $('companyForm').elements.namedItem('id').value=activeCompany?.id||'';
    const names=new Set(trades.map(t=>t.name));
    if(activeCompany?.trade)names.add(activeCompany.trade);
    $('companyTrade').innerHTML='<option value="">Noch nicht zugeordnet</option>'+
      [...names].sort((a,b)=>a.localeCompare(b,'de'))
        .map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join('');
    if(activeCompany){
      for(const [key,value] of Object.entries(activeCompany)){
        const field=$('companyForm').elements.namedItem(key);
        if(field&&key!=='id')field.value=value??'';
      }
    }
    $('companyTitle').textContent=activeCompany?'Firma bearbeiten & ergänzen':'Neue Firma anlegen';
    $('saveCompany').textContent=activeCompany?'Änderungen speichern':'Firma anlegen';
    $('deleteCompany').hidden=!activeCompany;
    $('companyStatus').textContent='';
    companyFlow.open();
  }
  $('addCompany').onclick=()=>openCompany();
  $('companySearch').addEventListener('input',drawCompanies);
  $('companyForm').onsubmit=async event=>{
    event.preventDefault();
    if(companyBusy||researchBusy)return;
    const button=$('saveCompany'),form=$('companyForm');
    const data=Object.fromEntries(new FormData(form));
    delete data.id;
    companyBusy=true;button.disabled=true;
    try{
      await api('/api/contractors'+(activeCompany?'/'+activeCompany.id:''),
                activeCompany?'PUT':'POST',data);
      await reload();
      $('companyDialog').close();
      note('Firmenstammdaten gespeichert. Bestehende Zuordnungen bleiben erhalten.');
    }catch(error){$('companyStatus').textContent=error.message;}
    finally{companyBusy=false;button.disabled=false;}
  };
  $('deleteCompany').onclick=async()=>{
    if(companyBusy||researchBusy||!activeCompany||!await PHBUI.confirm('Firma endgültig löschen? Verknüpfte Firmen können nicht gelöscht werden.'))return;
    try{
      await api('/api/contractors/'+activeCompany.id,'DELETE');
      $('companyDialog').close();await reload();note('Firma gelöscht.');
    }catch(error){$('companyStatus').textContent=error.message;}
  };
  const endpoints={category:'/api/categories',trade:'/api/trades'};
  const collections=()=>({category:categories,trade:trades});
  async function modifyEntry(kind,id,operation){
    const record=collections()[kind].find(x=>x.id===id);
    if(!record)return;
    let name;
    if(operation==='rename'){
      name=await PHBUI.prompt('Neuer Name für '+record.name+':',record.name);
      if(name===null||!name.trim()||name.trim()===record.name)return;
    }else if(!await PHBUI.confirm('„'+record.name+'“ wirklich löschen? Verwendete Einträge sind geschützt.')){
      return;
    }
    try{
      await api(endpoints[kind]+'/'+id,operation==='rename'?'PATCH':'DELETE',
                operation==='rename'?{name:name.trim()}:undefined);
      await reload();note((kind==='trade'?'Gewerk':'Kategorie')+' aktualisiert.');
    }catch(error){note(error.message,true);}
  }
  for(const kind of ['trade','category']){
    const form=$(kind+'Create'),input=$(kind+'New'),dialog=$(kind+'CreateDialog');
    let saving=false;
    $(kind==='trade'?'addTrade':'addCategory').onclick=()=>{form.reset();$(kind+'CreateStatus').textContent='';dialog.showModal();};
    $(kind+'CreateClose').onclick=()=>{if(!saving)dialog.close();};
    dialog.oncancel=e=>{if(saving)e.preventDefault();};
    $(kind+'Search').addEventListener('input',drawReferenceLists);
    form.onsubmit=async event=>{
      event.preventDefault();if(saving)return;
      saving=true;const button=form.querySelector('button[type=submit]');button.disabled=true;
      try{
        await api(endpoints[kind],'POST',{name:input.value.trim()});
        dialog.close();await reload();
        note((kind==='trade'?'Gewerk':'Kategorie')+' angelegt.');
      }catch(error){$(kind+'CreateStatus').textContent=error.message;}
      finally{saving=false;button.disabled=false;}
    };
  }
  function researchPrompt(){
    const name=$('companyName').value.trim();
    $('companyResearchOffer').hidden=!!activeCompany||!window.PHBAI?.connected()||name.length<3||name===suppressedName;
  }
  let researchTimer;
  $('companyName').addEventListener('input',()=>{
    researchGeneration++;$('companyResearchResults').replaceChildren();
    clearTimeout(researchTimer);researchTimer=setTimeout(researchPrompt,650);
  });
  $('companyName').addEventListener('blur',researchPrompt);
  document.addEventListener('phb-ai-status',researchPrompt);
  $('skipCompanyResearch').onclick=()=>{suppressedName=$('companyName').value.trim();researchPrompt();};
  $('researchCompany').onclick=async()=>{
    if(companyBusy||researchBusy||activeCompany)return;
    const name=$('companyName').value.trim(),generation=++researchGeneration;
    const query=[name,$('companyResearchLocation').value.trim()].filter(Boolean).join(' ');
    const inputs=[...$('companyForm').querySelectorAll('input,select,textarea,button')];
    const disabled=inputs.map(n=>n.disabled);
    try{
      const selection=window.PHBAI?.selection();if(!selection)throw Error('Bitte ChatGPT verbinden.');
      researchBusy=true;inputs.forEach(n=>n.disabled=true);
      $('companyResearchStatus').textContent='ChatGPT recherchiert die besten passenden Firmen …';$('companyResearchResults').replaceChildren();
      const response=await fetch('/api/contractors/research',{method:'POST',headers:{'Content-Type':'application/json','X-PHB-AI':'1'},body:JSON.stringify({query,consent:true,...selection})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Firmenrecherche fehlgeschlagen.');
      if(generation!==researchGeneration||!$('companyDialog').open)return;
      $('companyResearchStatus').textContent=data.results.length?'Passenden Treffer auswählen. Leere Felder werden ergänzt; vorhandene Kontaktdaten bleiben erhalten.':'Keine passenden belegten Treffer gefunden. Namen/Ort präzisieren oder manuell fortfahren.';
      data.results.forEach(result=>{
        const card=document.createElement('article');card.className='master-research-result';
        card.innerHTML=`<strong>${esc(result.name)}</strong><p>${esc(result.snippet)}</p><p>${esc([result.address,result.phone,result.email,result.contact].filter(Boolean).join(' · '))}</p><a href="${esc(result.source_url)}" target="_blank" rel="noopener noreferrer">Quelle prüfen ↗</a> <button type="button">Diesen Treffer übernehmen</button>`;
        card.querySelector('button').onclick=()=>{
          for(const key of ['name','website','phone','email','address','contact']){
            const field=$('companyForm').elements.namedItem(key);
            if(result[key]&&(!field.value.trim()||(key==='name'&&field.value.trim()===name)))field.value=result[key];
          }
          $('companyResearchStatus').textContent='Vorschlag übernommen. Angaben prüfen und Firma anschließend ausdrücklich speichern.';
          $('companyResearchResults').replaceChildren();
        };
        $('companyResearchResults').append(card);
      });
    }catch(error){$('companyResearchStatus').textContent=error.message+' Manuelle Eingabe bleibt möglich.';}
    finally{researchBusy=false;inputs.forEach((n,i)=>n.disabled=disabled[i]);}
  };
  for(const [button,kind,label] of [
    ['restoreTrades','trade','Gewerke'],
    ['restoreCategories','category','Rechnungs- und Kostenkategorien']
  ]){
    $(button).onclick=async()=>{
      if(!await PHBUI.confirm('Standardliste für '+label+' wiederherstellen? Fehlende Standardwerte werden ergänzt. Nicht mehr benötigte eigene Einträge werden entfernt, bereits verwendete Einträge bleiben geschützt.'))return;
      const target=$(button);target.disabled=true;
      try{
        const result=await api(endpoints[kind]+'/restore-defaults','POST',{confirm:true});
        await reload();
        const parts=['Standardliste wiederhergestellt',
          result.added.length+' ergänzt',result.removed.length+' ungenutzte Einträge entfernt'];
        if(result.preserved.length)parts.push(
          result.preserved.length+' verwendete eigene Einträge bleiben erhalten');
        note(parts.join(' · ')+'.');
      }catch(error){note(error.message,true);}
      finally{target.disabled=false;}
    };
  }
  const navigation=new URLSearchParams(location.search);
  const receiptId=Number(navigation.get('receipt_id'));
  if(Number.isSafeInteger(receiptId)&&receiptId>0){
    $('receiptReturn').hidden=false;
    $('receiptReturnLink').href='/belege?receipt_id='+receiptId;
  }
  reload().then(()=>{
    if(receiptId>0&&navigation.get('new_company')==='1')$('addCompany').click();
  }).catch(error=>note('Stammdaten konnten nicht geladen werden: '+error.message,true));
})();
