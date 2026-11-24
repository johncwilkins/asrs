import {warehouse,address} from './scene.js';
import {runTransfer} from './carriage.js';
import {arrow,clearArrow,wait} from './links.js';
import {readDatabase,writeDatabase,markInterrupted,seedInventory,demoUsername,storedDetails} from './database.js';
import {systemSteps} from './steps.js';

const $=id=>document.getElementById(id);
const requester=demoUsername();
const steps=systemSteps(), database=readDatabase();
const parked=()=>({x:-6,y:.43,fork:0});
const state={outfeed:true,inventory:database.inventory,carriage:parked(),job:null,offRack:new Set()};
const targets={db:['.backend .interface:first-child','.inventory'],conveyor:['.backend .interface:nth-child(2)','.conveyor'],carriage:['.backend .interface:nth-child(3)','.carriage']};
let controller=new AbortController(),unload,exitClear,requestBusy=false;
const jobs=new Map();
const text=(id,value)=>{$(id).textContent=value;};
function event(value){$('event').lastChild.textContent=' '+value;}
function flash(kind,label,returning=false){
  const [a,b]=targets[kind];arrow(returning?b:a,returning?a:b,label,returning);
}
function store(){writeDatabase(state.inventory,database.history);}
function rows(id,values,empty,columns){
  $(id).replaceChildren(...values.map(values=>{
    const tr=document.createElement('tr');
    for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}
    return tr;
  }));
  if(!values.length){const cell=$(id).insertRow().insertCell();cell.colSpan=columns;cell.textContent=empty;}
}
function records(){
  rows('records',state.inventory.map(item=>[item.id,address(item.slot),jobs.get(item.id)?.event??'Stored',...storedDetails(item)]),'No stored pallets.',5);
  rows('history',database.history.map(item=>[item.id,item.from,item.to,item.requestedBy||'—',item.event+' · '+new Date(item.at).toLocaleTimeString()]),'No moves recorded.',5);
  $('retrieve-options').replaceChildren(...state.inventory.map(item=>new Option($('retrieve-by').value==='id'?item.id:address(item.slot))));
}
function log(entry,label,finished=false){
  Object.assign(entry,{event:label,at:new Date().toISOString(),finished});store();records();
}
function lock(locked){
  for(const id of ['request-retrieve','retrieve-source','retrieve-by'])$(id).disabled=locked;
  $('request-retrieve').classList.toggle('next-highlight',!locked&&$('step-demo').checked);
}
function conveyor(value){
  text('conveyor-state',value);text('conveyor-feedback',value);
}
function cylinders(value){
  $('conveyor-stage').dataset.cylinder=value?'on':'off';
  text('cylinder-note',value?'Transfer cylinders extended':'Transfer cylinders retracted');
}
function waitUnload(){
  $('unload-pallet').disabled=false;
  $('unload-pallet').classList.toggle('next-highlight',$('step-demo').checked);
  return new Promise(resolve=>{unload=resolve;});
}
function releaseUnload(){
  $('unload-pallet').disabled=true;$('unload-pallet').classList.remove('next-highlight');
  const callback=unload;unload=null;callback?.();
}
function receipt(entry){
  const heading=document.createElement('h1');
  heading.textContent='AS/RS retrieval report';
  const summary=document.createElement('p');
  summary.textContent='Pallet '+entry.id+' retrieved from '+entry.from+' and removed at the Line 2 unload point. Requested by '+entry.requestedBy+'. '+new Date(entry.at).toLocaleString();
  $('retrieval-report').replaceChildren(heading,summary);$('print-receipt').hidden=false;
}
async function retrieve(e){
  e.preventDefault();
  if(requestBusy)return;
  const entered=$('retrieve-source').value.trim().toUpperCase(), byId=$('retrieve-by').value==='id';
  const item=state.inventory.find(item=>byId?item.id===entered:address(item.slot)===entered);
  flash('db','Look up stored pallet');
  if(!item||jobs.has(item.id)){
    text('form-message',item?'Pallet '+item.id+' is already being retrieved.':'No stored pallet matches '+entered+'.');
    event('Retrieval held.');return;
  }
  const signal=controller.signal;
  requestBusy=true;
  const entry={id:item.id,from:address(item.slot),to:'Outfeed · exit',requestedBy:requester()};
  jobs.set(item.id,entry);database.history.unshift(entry);
  const job={id:item.id,from:item.slot,to:null,motion:null,offRack:false};
  state.job=job;
  const beltPallet=document.createElement('div');
  beltPallet.className='belt-pallet retrieval-load';beltPallet.textContent=item.id;
  $('conveyor-stage').append(beltPallet);
  text('form-message',item.id+' · '+entry.from+' to outfeed');
  text('db-exchange','Confirmed '+item.id+' at '+entry.from+'.');
  text('operator-status','Pending');text('plc-command','—');text('conveyor-command','—');
  if(!unload)text('unload-message','Waiting for a pallet at the unload point.');
  event('Rack location confirmed. Outfeed stand available.');
  log(entry,'Retrieval requested');lock(true);
  try{
    await steps.pause('step-carriage');signal.throwIfAborted();
    text('plc-command','Retrieve '+item.id+' · '+entry.from+' → outfeed stand');
    flash('carriage','Retrieve command');await wait(700,signal);
    await runTransfer({palletId:item.id,from:item.slot},{
      carriage:state.carriage,signal,
      load:pallet=>{job.motion=pallet;job.offRack=true;state.offRack.add(item.id);},
      report:feedback=>{
        text('plc-feedback',feedback.status);text('carriage-state',feedback.status);event(feedback.detail);
        if(feedback.carrying)text('operator-status','In process on carriage');
        if(feedback.status==='Pallet aboard'){flash('carriage','Pickup confirmed',true);log(entry,'On carriage');}
        if(feedback.deposited){flash('carriage','Deposit confirmed',true);log(entry,'Deposited at outfeed');}
      },
    });
    await wait(630,signal);
    beltPallet.dataset.position='pickup';
    cylinders(true);conveyor('Pallet present at deposit stand');flash('conveyor','Outfeed arrival',true);
    event('Ignition matched the outfeed arrival and carriage-clear feedback.');
    if(unload){
      conveyor('Pallet waiting at stand');
      log(entry,'Waiting for unload point to clear');
      await new Promise(resolve=>{exitClear=resolve;});
      signal.throwIfAborted();
    }
    if(!$('step-demo').checked)await wait(720,signal);
    await steps.pause('step-conveyor');signal.throwIfAborted();
    text('conveyor-command','Release '+item.id+' to unload point');
    flash('conveyor','Outfeed release');text('operator-status','In process on conveyor');
    await wait(700,signal);cylinders(false);
    job.motion=null;
    beltPallet.dataset.position='scale';conveyor('Indexing to staging');log(entry,'On outfeed conveyor');
    await wait(900,signal);
    beltPallet.dataset.position='unload';conveyor('Indexing to unload point');
    await wait(900,signal);
    conveyor('Ready to unload');flash('conveyor','Ready to unload',true);
    event('Pallet reached the unload point.');
    text('unload-message','Remove pallet '+item.id+' to confirm departure.');
    log(entry,'Ready to unload');
    const removal=waitUnload();
    requestBusy=false;lock(false);
    await removal;signal.throwIfAborted();
    beltPallet.remove();
    const ready=exitClear;exitClear=null;ready?.();conveyor('Departure confirmed');flash('conveyor','Departure confirmed',true);
    text('unload-message','Pallet '+item.id+' removed from the unload point.');
    text('db-exchange','Departure confirmed. Inventory update pending.');
    log(entry,'Removed at unload point');
    if(!$('step-demo').checked)await wait(720,signal);
    await steps.pause('step-inventory');signal.throwIfAborted();
    state.inventory=state.inventory.filter(record=>record.id!==item.id);
    state.offRack.delete(item.id);jobs.delete(item.id);
    if(state.job===job)state.job=null;
    if(!jobs.size)text('operator-status','Order completed');
    text('db-exchange','Write committed: '+entry.from+' is free.');
    event('Pallet removed from active inventory and retrieval recorded.');
    flash('db','Save confirmed departure');log(entry,'Completed',true);receipt(entry);
  }catch(error){
    if(!signal.aborted){
      beltPallet.remove();state.offRack.delete(item.id);jobs.delete(item.id);
      if(state.job===job){state.job=null;requestBusy=false;}
      log(entry,'Interrupted',true);event('Retrieval interrupted.');lock(requestBusy);
    }
  }
}

$('retrieve-request').addEventListener('submit',retrieve);
$('retrieve-by').addEventListener('change',()=>{
  const item=state.inventory[0];
  $('retrieve-label').textContent=$('retrieve-by').value==='id'?'Pallet ID':'Source rack address';
  $('retrieve-source').value=item?$('retrieve-by').value==='id'?item.id:address(item.slot):'';
  records();
});
$('unload-pallet').addEventListener('click',releaseUnload);
$('step-demo').addEventListener('change',()=>{
  lock(requestBusy);
  $('unload-pallet').classList.toggle('next-highlight',!!unload&&$('step-demo').checked);
});
$('print-receipt').addEventListener('click',()=>window.print());
$('reset-retrieve').addEventListener('click',()=>{
  controller.abort();controller=new AbortController();steps.resume();releaseUnload();clearArrow();
  exitClear?.();exitClear=null;
  state.inventory=seedInventory();database.history.length=0;writeDatabase(state.inventory,database.history,[]);
  $('print-receipt').hidden=true;$('retrieval-report').replaceChildren();
  jobs.clear();state.offRack.clear();requestBusy=false;
  state.job=null;state.carriage=parked();
  document.querySelectorAll('.retrieval-load').forEach(pallet=>pallet.remove());
  $('retrieve-request').reset();$('retrieve-label').textContent='Pallet ID';
  $('belt-pallet').dataset.position='empty';cylinders(false);conveyor('Outfeed stand available');
  for(const id of ['plc-command','conveyor-command'])text(id,'—');
  text('plc-feedback','Parked');text('carriage-state','Parked');text('operator-status','Ready');
  text('db-exchange','Ready to read rack inventory.');text('unload-message','Waiting for a pallet at the unload point.');
  text('form-message','Select a stored pallet to retrieve.');event('Awaiting operator request.');
  records();lock(false);
});
if(markInterrupted(database.history))store();
records();lock(false);warehouse($('rack'),state);
