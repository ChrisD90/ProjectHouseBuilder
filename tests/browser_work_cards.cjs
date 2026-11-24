/* Focused cards -> full details -> save/complete workflow on disposable project data. */
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{
 const page=await browser.newPage({locale:'de-DE'}),base=process.env.PHB_TEST_URL,errors=[];page.on('pageerror',e=>errors.push(e.message));
 const project=await page.request.post(base+'/api/projects',{data:{title:'To-do Kacheln'}}),owner=(await project.json()).project.id,headers={'X-PHB-Project':String(owner)};
 const body=('Langer vollständiger Detailtext.\n').repeat(80).trimEnd();
 async function create(kind,title){const r=await page.request.post(base+'/api/project-work',{headers,data:{kind,title,body}});assert.equal(r.status(),201,await r.text());return (await r.json()).item;}
 const todo=await create('todo','Prüfung vor Ort'),note=await create('note','Planungsnotiz');
 await page.goto(base+'/p/'+owner+'/aufgaben');const todoCard=page.locator('[data-work-id="'+todo.id+'"]');await expect(todoCard).toBeVisible();
 await todoCard.getByRole('checkbox').check();await expect(todoCard).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('checkbox',{name:'Erledigte anzeigen',exact:true}).check();await expect(todoCard.getByRole('checkbox')).toBeChecked();
 await todoCard.evaluate(node=>node.click());let editor=page.getByRole('dialog',{name:'To-do bearbeiten',exact:true});await expect(editor.getByRole('textbox',{name:'Details',exact:true})).toHaveValue(body);await editor.getByRole('button',{name:'Schließen',exact:true}).click();
 await page.getByRole('tab',{name:'Notizen',exact:true}).click();const noteCard=page.locator('[data-work-id="'+note.id+'"]');await expect(noteCard).toBeVisible();await noteCard.getByRole('button',{name:'Details zu Planungsnotiz öffnen',exact:true}).click();editor=page.getByRole('dialog',{name:'Notiz bearbeiten',exact:true});await expect(editor.getByRole('textbox',{name:'Details',exact:true})).toHaveValue(body);await editor.getByRole('textbox',{name:'Details',exact:true}).fill(body+'Zusatz am Ende');await editor.getByRole('button',{name:'Speichern',exact:true}).click();await expect(editor).not.toBeVisible();
 const response=await page.request.get(base+'/api/project-work',{headers});const saved=(await response.json()).items.find(item=>item.id===note.id);assert.equal(saved.body,body+'Zusatz am Ende');assert.deepEqual(errors,[]);console.log('PASS compact cards, completion without opening details, whole-card opening, full long text and lossless note save.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
