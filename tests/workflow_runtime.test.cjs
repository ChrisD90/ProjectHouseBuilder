'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function setup(){
 const elements=new Map();
 const windowEvents={};
 let confirmValue=true,confirmCalls=0;
 class Element {
  constructor(id=''){
   this.id=id;this.dataset={};this.disabled=false;this.connected=true;
   this.listeners={};this.classList={add(){},toggle(){}};
   this.attributes={};this.focused=false;
  }
  addEventListener(name,handler){(this.listeners[name] ||= []).push(handler);}
  dispatch(name,event={}){
   for(const handler of this.listeners[name]||[])handler({
    target:this,preventDefault(){},stopImmediatePropagation(){},...event
   });
  }
  setAttribute(name,value){this.attributes[name]=value;}
  removeAttribute(name){delete this.attributes[name];}
  focus(){this.focused=true;}
  get isConnected(){return this.connected;}
 }
 class Dialog extends Element {
  constructor(id){super(id);this.open=false;}
  showModal(){this.open=true;}
  close(){this.open=false;this.dispatch('close');}
  querySelector(){return null;}
  contains(){return false;}
 }
 class Form extends Element {
  constructor(id,fields){super(id);this.fields=fields;}
  querySelectorAll(){return this.fields;}
 }
 const button=new Element('cancel');
 const action=new Element('save');
 const opener=new Element('launcher');
 const text={name:'name',value:'Vorher',type:'text',tagName:'INPUT',dataset:{}};
 const form=new Form('form',[text]);
 const dialog=new Dialog('dialog');
 [form,dialog,button,action].forEach(el=>elements.set(el.id,el));
 const document={
  activeElement:opener,
  getElementById(id){return elements.get(id)||null;},
  createElement(){return new Element();}
 };
 const window={
  PHBUI:{confirm:async()=>{confirmCalls++;return confirmValue;},alert:async()=>{}},
  addEventListener(name,handler){windowEvents[name]=handler;}
 };
 const context={document,window,HTMLElement:Element,HTMLDialogElement:Dialog,
  console,Number,Set,Map,JSON,Promise,String,Boolean};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/phb-workflow.js'),'utf8'),context);
 const flow=window.PHBFlow.manage({dialog:'dialog',forms:['form'],dismiss:['cancel']});
 return {window,windowEvents,dialog,form,text,button,action,flow,opener,
  setConfirm(value){confirmValue=value;},
  get confirmCalls(){return confirmCalls;}};
}

test('dirty form requires confirmation; cancel returns focus',async()=>{
 const x=setup();x.flow.open();assert.equal(x.flow.dirty(),false);
 x.text.value='Nachher';assert.equal(x.flow.dirty(),true);
 x.setConfirm(false);assert.equal(await x.flow.cancel(),false);
 assert.equal(x.dialog.open,true);
 x.setConfirm(true);assert.equal(await x.flow.cancel(),true);
 assert.equal(x.dialog.open,false);assert.equal(x.opener.focused,true);
 assert.equal(x.confirmCalls,2);
});

test('successful save snapshots form; no discard confirmation',async()=>{
 const x=setup();x.flow.open();x.text.value='Gespeichert';
 x.flow.snapshot();assert.equal(x.flow.dirty(),false);
 assert.equal(await x.flow.cancel(),true);
 assert.equal(x.confirmCalls,0);
});

test('async guard refuses cancel until operation settles',async()=>{
 const x=setup();x.flow.open();x.text.value='Neu';
 let resolveSave;
 const pending=x.flow.run(()=>new Promise(resolve=>resolveSave=resolve),
                         {button:x.action});
 assert.equal(x.flow.isBusy(),true);
 assert.equal(x.action.disabled,true);
 assert.equal(await x.flow.cancel(),false);
 assert.equal(x.dialog.open,true);
 resolveSave('ok');
 const result=await pending;
 assert.equal(result.ok,true);
 assert.equal(x.flow.isBusy(),false);
 assert.equal(x.flow.dirty(),false);
 assert.equal(x.action.disabled,false);
});

test('navigation warns only while a managed dialog contains unsaved data',()=>{
 const x=setup();x.flow.open();
 let prevented=false;
 x.windowEvents.beforeunload({preventDefault(){prevented=true;}});
 assert.equal(prevented,false);
 x.text.value='Anders';
 const e={preventDefault(){prevented=true;},returnValue:null};
 x.windowEvents.beforeunload(e);
 assert.equal(prevented,true);assert.equal(e.returnValue,'');
});

test('duplicate manage returns same controller instead of duplicate listeners',()=>{
 const x=setup();
 const same=x.window.PHBFlow.manage({dialog:'dialog',forms:['form'],dismiss:['cancel']});
 assert.equal(same,x.flow);
 assert.equal(x.dialog.listeners.cancel.length,1);
});
