import {mountConveyor} from './scene.js';
import {setupMoveReport,resetMoveReport} from './move-report.js';
import {warehouse,address} from './scene.js';
import {runTransfer} from './carriage.js';
import {arrow,clearArrow,wait} from './links.js';
import {readDatabase,writeDatabase,markInterrupted,seedInventory,pendingDepartures,demoUsername,storedDetails} from './database.js';
import {systemSteps} from './steps.js';

const $=id=>document.getElementById(id);
const requester=demoUsername();
const steps=systemSteps(), database=readDatabase();
const parked=()=>({x:-6,y:.43,fork:0});
const state={outfeed:true,inventory:database.inventory,carriage:parked(),job:null,offRack:new Set()};
const targets={db:['.backend .interface:first-child','.inventory'],conveyor:['.backend .interface:nth-child(2)','.conveyor'],carriage:['.backend .interface:nth-child(3)','.carriage']};
let controller=new AbortController(),unload,exitClear,requestBusy=false;
const jobs=new Map();
const queued=database.history.filter(entry=>entry.retrievalQueued&&!entry.finished).reverse();
for(const entry of queued)jobs.set(entry.id,entry);
const byId=()=>$('retrieve-by').value==='id';
function syncLookup(){
  $('retrieve-pallet-field').hidden=!byId();
  $('retrieve-pallet').disabled=!byId();
  $('retrieve-location-field').hidden=byId();
  $('retrieve-source').disabled=byId();
  $('retrieve-source').required=!byId();
}
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
  const departures=pendingDepartures(database.history);
  const pendingIds=new Set(departures.map(entry=>entry.id));
  rows('records',state.inventory.map(item=>[item.id,address(item.slot),pendingIds.has(item.id)?'Unloaded · write pending':jobs.get(item.id)?.event??'Stored',...storedDetails(item)]),'No stored pallets.',5);
  const available=state.inventory.filter(item=>!jobs.has(item.id)&&!pendingIds.has(item.id));
  for(const [id,label,value] of [
    ['retrieve-pallet','pallet',item=>item.id],
    ['retrieve-source','rack location',item=>address(item.slot)],
  ]){
    const picker=$(id), selected=picker.value;
    picker.replaceChildren(new Option(available.length?'Choose a stored '+label:'No stored '+label+' available',''),
      ...available.map(item=>new Option(value(item),value(item))));
    picker.firstElementChild.disabled=true;
    picker.value=available.some(item=>value(item)===selected)?selected:'';
  }
  $('retrieve-queue').replaceChildren(...queued.map(entry=>{
    const row=document.createElement('li');
    row.textContent=entry.id+' · '+entry.from;
    return row;
  }));
  $('empty-retrieve-queue').hidden=queued.length>0;
  $('request-retrieve').disabled=!available.length;
  const first=pendingDepartures(database.history).at(-1);
  if(first&& !$('step-inventory').hidden)$('step-inventory').textContent='Write retrieval to database · '+first.id;
  rows('history',database.history.map(item=>[item.id,item.from,item.to,item.requestedBy||'—',item.event+' · '+new Date(item.at).toLocaleTimeString()]),'No moves recorded.',5);
}
function log(entry,label,finished=false){
  Object.assign(entry,{event:label,at:new Date().toISOString(),finished});store();records();
}
function refreshControls(){
  syncLookup();
  $('request-retrieve').classList.toggle('next-highlight',!requestBusy&&!queued.length&&$('step-demo').checked);
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

function queueRetrieval(e){
  e.preventDefault();
  const entered=$(byId()?'retrieve-pallet':'retrieve-source').value;
  const item=state.inventory.find(item=>byId()?item.id===entered:address(item.slot)===entered);
  if(!item||jobs.has(item.id)||pendingDepartures(database.history).some(entry=>entry.id===item.id)){
    text('form-message',item?'Pallet '+item.id+' is already being retrieved.':'Select a stored pallet.');
    return;
  }
  const entry={id:item.id,from:address(item.slot),to:'Outfeed · exit',requestedBy:requester(),retrievalQueued:true};
  jobs.set(item.id,entry);database.history.unshift(entry);queued.push(entry);
  text('form-message','Retrieval queued for pallet '+item.id+'.');
  log(entry,'Queued for retrieval');
  pump();
}
function pump(){
  if(requestBusy||!queued.length)return;
  const entry=queued[0];
  const item=state.inventory.find(pallet=>pallet.id===entry.id);
  if(!item){
    queued.shift();jobs.delete(entry.id);delete entry.retrievalQueued;
    log(entry,'Canceled: pallet no longer stored',true);
    pump();return;
  }
  requestBusy=true;
  refreshControls();
  void runRetrieval(item,entry,controller.signal);
}
async function runRetrieval(item,entry,signal){
  const job={id:item.id,from:item.slot,to:null,motion:null,offRack:false};
  state.job=job;
  const beltPallet=document.createElement('div');
  beltPallet.className='belt-pallet retrieval-load';beltPallet.textContent=item.id;
  $('conveyor-stage').append(beltPallet);
  text('operator-status','Pending');text('plc-command','—');text('conveyor-command','—');
  if(!unload)text('unload-message','Waiting for a pallet at the unload point.');
  event('Retrieval queued. Outfeed stand available.');
  records();
  try{
    await steps.lookup(signal);signal.throwIfAborted();
    flash('db','Look up stored pallet');
    text('db-exchange','Confirmed '+item.id+' at '+entry.from+'.');
    await steps.observe('database',item.id+' confirmed at '+entry.from,signal);
    await steps.pause('step-carriage');signal.throwIfAborted();
    queued.shift();delete entry.retrievalQueued;
    entry.from=address(item.slot);
    log(entry,'Retrieval dispatched');
    text('plc-command','Retrieve '+item.id+' · '+entry.from+' → outfeed stand');
    flash('carriage','Retrieve command');await wait(700,signal);
    await runTransfer({palletId:item.id,from:item.slot},{
      carriage:state.carriage,signal,
      load:pallet=>{job.motion=pallet;job.offRack=true;state.offRack.add(item.id);},
      report:feedback=>{
        text('plc-feedback',feedback.status);text('carriage-state',feedback.status);event(feedback.detail);
        if(feedback.carrying)text('operator-status','In process on carriage');
        if(feedback.status==='Pallet aboard'){log(entry,'On carriage');}
        if(feedback.deposited){log(entry,'Deposited at outfeed');}
        return steps.observe('carriage',feedback.detail,signal,feedback.status);
      },
    });
    await wait(630,signal);
    beltPallet.dataset.position='pickup';
    cylinders(true);conveyor('Pallet present at deposit stand');
    event('Ignition matched the outfeed arrival and carriage-clear feedback.');
    await steps.observe('conveyor','Pallet present at deposit stand',signal);
    if(unload){
      conveyor('Pallet waiting at stand');
      log(entry,'Waiting for unload point to clear');
      const cleared=new Promise(resolve=>{exitClear=resolve;});
      await steps.observe('conveyor','Pallet waiting at stand',signal);
      await cleared;
      signal.throwIfAborted();
    }
    if(!$('step-demo').checked)await wait(720,signal);
    await steps.pause('step-conveyor');signal.throwIfAborted();
    text('conveyor-command','Release '+item.id+' to unload point');
    flash('conveyor','Outfeed release');text('operator-status','In process on conveyor');
    await wait(700,signal);cylinders(false);
    job.motion=null;
    beltPallet.dataset.position='scale';conveyor('Indexing to staging');log(entry,'On outfeed conveyor');
    await steps.observe('conveyor','Indexing to staging',signal);
    await wait(900,signal);
    beltPallet.dataset.position='unload';conveyor('Indexing to unload point');
    await steps.observe('conveyor','Indexing to unload point',signal);
    await wait(900,signal);
    conveyor('Ready to unload');
    event('Pallet reached the unload point.');
    text('unload-message','Remove pallet '+item.id+' to confirm departure.');
    log(entry,'Ready to unload');
    await steps.observe('conveyor','Ready to unload '+item.id,signal);
    const removal=waitUnload();
    requestBusy=false;refreshControls();pump();
    await removal;signal.throwIfAborted();
    beltPallet.remove();
    const ready=exitClear;exitClear=null;ready?.();conveyor('Departure confirmed');
    text('unload-message','Pallet '+item.id+' removed from the unload point.');
    entry.departurePending=true;
    log(entry,'Unloaded · database write pending');
    await steps.observe('conveyor','Departure confirmed for '+item.id,signal);
    await finishDeparture(entry,signal);
    if(state.job===job)state.job=null;
  }catch(error){
    if(!signal.aborted){
      beltPallet.remove();state.offRack.delete(item.id);jobs.delete(item.id);
      if(state.job===job){state.job=null;requestBusy=false;}
      log(entry,'Interrupted',true);event('Retrieval interrupted.');refreshControls();
    }
  }
}

async function finishDeparture(entry,signal){
  const {id}=entry;
  text('db-exchange','Pallet '+id+' unloaded. Rack '+entry.from+' is waiting for the database write.');
  event('Removal confirmed. Write the retrieval to release the rack location.');
  if(!$('step-demo').checked)await wait(720,signal);
  const approval=steps.pause('step-inventory');
  records();
  await approval;signal.throwIfAborted();
  state.inventory=state.inventory.filter(record=>record.id!==id);
  state.offRack.delete(id);jobs.delete(id);
  delete entry.departurePending;
  if(!jobs.size)text('operator-status','Order completed');
  text('db-exchange','Write committed: '+entry.from+' is free.');
  event('Pallet removed from active inventory and retrieval recorded.');
  flash('db','Save confirmed departure');log(entry,'Completed',true);
  await steps.observe('database','Departure write committed for '+id,signal);
}
$('retrieve-request').addEventListener('submit',queueRetrieval);
$('retrieve-by').addEventListener('change',()=>{syncLookup();records();});
$('unload-pallet').addEventListener('click',releaseUnload);
$('step-demo').addEventListener('change',()=>{
  refreshControls();
  $('unload-pallet').classList.toggle('next-highlight',!!unload&&$('step-demo').checked);
});
$('reset-retrieve').addEventListener('click',()=>{
  resetMoveReport();
  controller.abort();controller=new AbortController();steps.resume();releaseUnload();clearArrow();
  exitClear?.();exitClear=null;
  state.inventory=seedInventory();database.history.length=0;writeDatabase(state.inventory,database.history,[]);

  queued.length=0;jobs.clear();state.offRack.clear();requestBusy=false;
  state.job=null;state.carriage=parked();
  document.querySelectorAll('.retrieval-load').forEach(pallet=>pallet.remove());
  $('retrieve-request').reset();
  $('belt-pallet').dataset.position='empty';cylinders(false);conveyor('Outfeed stand available');
  for(const id of ['plc-command','conveyor-command'])text(id,'—');
  text('plc-feedback','Parked');text('carriage-state','Parked');text('operator-status','Ready');
  text('db-exchange','Ready to read rack inventory.');text('unload-message','Waiting for a pallet at the unload point.');
  text('form-message','Select a stored pallet to retrieve.');event('Awaiting operator request.');
  records();refreshControls();
});
if(markInterrupted(database.history))store();
const pendingOnLoad=pendingDepartures(database.history).reverse();
for(const entry of pendingOnLoad)state.offRack.add(entry.id);
records();refreshControls();warehouse($('rack'),state);
for(const entry of pendingOnLoad)finishDeparture(entry,controller.signal).catch(error=>{
  if(error?.name!=='AbortError')event('The pending retrieval write could not be completed.');
});

pump();

mountConveyor($('conveyor-stage'));

setupMoveReport();
