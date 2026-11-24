import {warehouse,address,sameSlot} from './scene.js';
import {runTransfer} from './carriage.js';
import {arrow,clearArrow,wait} from './links.js';
import {readDatabase,writeDatabase,markInterrupted,seedInventory,demoUsername,storedDetails} from './database.js';
import {systemSteps} from './steps.js';

const $=id=>document.getElementById(id);
const requester=demoUsername();
const slots=Array.from({length:7},(_,i)=>[1,2].flatMap(level=>['L','R'].map(side=>({bay:i+1,level,side})))).flat();
const parked=()=>({x:-6,y:.43,fork:0});
const database=readDatabase();
const state={storage:true,inventory:database.inventory,carriage:parked(),job:null,infeed:false};
const pending=new Map(database.queue);
const history=database.history;
const targets={db:['.backend .interface:first-child','.inventory'],conveyor:['.backend .interface:nth-child(2)','.conveyor'],carriage:['.backend .interface:nth-child(3)','.carriage']};
const steps=systemSteps();
let controller,working=false,loadClear=true,staged;
markInterrupted(history);
function store(){writeDatabase(state.inventory,history,[...pending]);}
function text(id,value){$(id).textContent=value;}
function event(value){$('event').lastChild.textContent=' '+value;}
function flash(kind,label,returning=false){
  const [a,b]=targets[kind];arrow(returning?b:a,returning?a:b,label,returning);
}
function recordRows(id,rows,empty,columns=4){
  $(id).replaceChildren(...rows.map(values=>{
    const tr=document.createElement('tr');
    for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}
    return tr;
  }));
  if(!rows.length){const tr=$(id).insertRow(),td=tr.insertCell();td.colSpan=columns;td.textContent=empty;}
}
function records(){
  recordRows('queue',[...pending].map(([id,request])=>[
    id,request.mode==='specified'?request.address:'Most Efficient',request.requestedBy||'—',
    working&&state.job?.id===id?history[0].event:staged?.id===id?'Loaded at infeed':'Waiting for pallet',
  ]),'No queued storage orders.',4);
  recordRows('records',state.inventory.map(item=>[item.id,address(item.slot),'Stored',...storedDetails(item)]),'No stored pallets.',5);
  recordRows('history',history.map(item=>[item.id,item.from,item.to,item.requestedBy||'—',item.event+' · '+new Date(item.at).toLocaleTimeString()]),'No moves recorded.',5);
}
function log(entry,label,finished=false){
  Object.assign(entry,{event:label,at:new Date().toISOString(),finished});
  store();records();
}
function occupied(slot){return state.inventory.some(item=>sameSlot(item.slot,slot));}
function refresh(){
  const control=$('storage-destination'), mode=$('storage-mode').value;
  const before=control.dataset.selected??control.value;
  control.replaceChildren(...slots.map(slot=>new Option(address(slot)+(occupied(slot)?' — occupied':''),address(slot))));
  [...control.options].forEach((option,index)=>{option.disabled=occupied(slots[index]);});
  control.value=[...control.options].find(o=>o.value===before&&!o.disabled)?.value??[...control.options].find(o=>!o.disabled)?.value??'';
  if(mode!=='specified'){
    control.prepend(new Option('Assigned by Ignition',''));
    control.value='';
  }else control.dataset.selected=control.value;
  control.disabled=mode!=='specified';
  for(const id of ['load-pallet','scan-id'])$(id).disabled=!loadClear||!!staged;
  const guided=$('step-demo').checked;
  $('queue-order').classList.toggle('next-highlight',guided&&!pending.size);
  $('load-pallet').classList.toggle('next-highlight',guided&&loadClear&&!staged&&[...pending.keys()].some(id=>!working||id!==state.job?.id));
}
function palletId(field){
  const id=$(field).value.trim().toUpperCase();
  if(!id)throw new Error('Enter the pallet ID shown on the barcode.');
  if(state.inventory.some(item=>item.id===id))throw new Error('Pallet '+id+' is already stored.');
  return id;
}
function order(){
  return {mode:$('storage-mode').value,address:$('storage-destination').value,requestedBy:requester()};
}
function allocate(request){
  const free=slots.filter(slot=>!occupied(slot)&&(!working||!state.job?.to||!sameSlot(state.job.to,slot)));
  const target=request.mode==='specified'?free.find(slot=>address(slot)===request.address):free[0];
  if(!target)throw new Error('No eligible destination is available.');
  return target;
}
function conveyorFeedback(value){
  text('conveyor-state',value);text('conveyor-feedback',value);
}
function cylinder(extended){
  $('conveyor-stage').dataset.cylinder=extended?'on':'off';
  text('cylinder-note',extended?'Transfer cylinders extended':'Transfer cylinders retracted');
}
async function runConveyor(signal,entry){
  conveyorFeedback('Indexing to check station');
  $('belt-pallet').dataset.position='scale';
  await wait(900,signal);
  loadClear=true;refresh();
  text('scan-message','Loading area clear. You can scan another queued pallet.');
  conveyorFeedback('Weighing and sizing');
  await wait(750,signal);
  log(entry,'Weight and dimensions passed');
  conveyorFeedback('Indexing to pickup stand');
  $('belt-pallet').dataset.position='pickup';
  await wait(900,signal);
  cylinder(true);
  conveyorFeedback('Squaring pallet at pickup');
  await wait(460,signal);
  $('belt-pallet').dataset.position='lifted';
  await wait(520,signal);
  conveyorFeedback('Pickup ready');
}
$('storage-request').addEventListener('submit',e=>{
  e.preventDefault();
  try{
    const id=palletId('pallet-id'),request=order();allocate(request);if(pending.has(id))throw new Error('A storage order for '+id+' is already queued.');
    pending.set(id,request);
    store();records();refresh();
    flash('db','Check pallet and rack');
    text('db-exchange',id+' is eligible for storage.');
    if(!working)text('operator-status','Pending');
    text('form-message','Storage order queued for '+id+'. Pending orders: '+[...pending.keys()].join(', ')+'.');
    event('Waiting for the matching pallet to be loaded.');
  }catch(error){text('form-message',error.message);}
});
function load(e){
  e.preventDefault();
  if(!loadClear||staged)return;
  let id,target,request;
  const scanned=$('scan-id').value.trim().toUpperCase();
  try{
    id=palletId('scan-id');
    if(working&&state.job?.id===id)throw new Error('Pallet '+id+' is already in process.');
    request=pending.get(id);
    if(!request)throw new Error('No pending storage order matches '+id+'.');
    target=allocate(request);
  }catch(error){
    if(!working){
      text('belt-pallet',scanned);$('belt-pallet').dataset.position='load';
      text('conveyor-command','—');text('plc-command','—');
      conveyorFeedback('Pallet held at loading area');
    }
    text('scan-message',error.message+' Conveyor release blocked.');
    $('scan-message').classList.add('error');
    event(error.message);flash('conveyor','Scan rejected',true);
    return;
  }
  $('scan-message').classList.remove('error');
  const next={id,request,target,storedBy:requester()};
  if(working){
    staged=next;
    text('staged-pallet',id);$('staged-pallet').dataset.position='load';
    text('scan-message','Pallet '+id+' is loaded at the infeed, waiting for the current storage cycle.');
    flash('conveyor','Infeed scan '+id,true);refresh();records();
    return;
  }
  void runStorage(next);
}
async function runStorage({id,request,target,storedBy}){
  working=true;loadClear=false;
  text('scan-message','Barcode '+id+' matched a queued order.');
  refresh();
  const local=new AbortController();controller=local;const signal=local.signal;
  const entry={id,from:'Infeed',to:address(target),requestedBy:request.requestedBy};
  history.unshift(entry);
  state.job={id,from:null,to:target,motion:null};
  text('belt-pallet',id);
  $('belt-pallet').dataset.position='load';
  text('plc-command','—');
  text('plc-feedback','Parked');
  text('conveyor-command','—');
  text('form-message',id+' · Infeed to '+entry.to);
  text('db-exchange','Destination reserved: '+entry.to);
  text('operator-status','Loaded');
  conveyorFeedback('Barcode read: '+id);
  event('Ignition matched the infeed scan and reserved '+entry.to+'.');
  flash('conveyor','Barcode '+id,true);
  log(entry,'Pallet scanned');
  try{
    await steps.pause('step-conveyor');signal.throwIfAborted();
    text('conveyor-command','Release '+id+' to pickup stand');
    event('Conveyor release sent.');
    text('operator-status','In process on conveyor');
    flash('conveyor','Conveyor release');
    await wait(720,signal);
    await runConveyor(signal,entry);
    state.infeed=true;
    event('Ignition received pickup-ready from the Conveyor PLC.');
    flash('conveyor','Pickup ready',true);
    log(entry,'Waiting for carriage pickup');
    if(!$('step-demo').checked)await wait(720,signal);
    await steps.pause('step-carriage');signal.throwIfAborted();
    text('plc-command','Store '+id+' · pickup stand → '+entry.to);
    event('Storage command sent. Monitoring Carriage PLC feedback.');
    flash('carriage','Storage command');
    await wait(720,signal);
    let placement;
    await runTransfer({palletId:id,to:target},{
      carriage:state.carriage,signal,
      load:pallet=>{
        state.job.motion=pallet;state.infeed=false;
        $('belt-pallet').dataset.position='empty';
        cylinder(false);conveyorFeedback('Pickup stand clear');
      },
      report:feedback=>{
        text('plc-feedback',feedback.status);text('carriage-state',feedback.status);event(feedback.detail);
        if(feedback.carrying)text('operator-status','In process on carriage');
        if(feedback.status==='Pallet aboard')flash('carriage','Pickup confirmed',true);
        if(feedback.location){placement=feedback.location;flash('carriage','Placement confirmed',true);log(entry,feedback.status);}
      },
    });
    text('db-exchange','Placement confirmed. Inventory update pending.');
    if(!$('step-demo').checked)await wait(720,signal);
    await steps.pause('step-inventory');signal.throwIfAborted();
    state.inventory.push({id,slot:placement,storedAt:new Date().toISOString(),storedBy});state.job.motion=null;
    pending.delete(id);
    flash('db','Store rack location');
    text('db-exchange','Write committed: '+id+' at '+entry.to+'.');
    event('Inventory updated. Storage recorded in move history.');
    text('operator-status','Order completed');
    log(entry,'Completed',true);
  }catch(error){
    if(!signal.aborted){log(entry,'Interrupted',true);event('Storage interrupted. Reset the demo before retrying.');}
  }finally{
    if(controller===local){
      working=false;loadClear=true;
      const next=staged;staged=null;$('staged-pallet').dataset.position='empty';
      refresh();records();
      if(next)void runStorage(next);
    }
  }
}
$('scan-form').addEventListener('submit',load);
$('step-demo').addEventListener('change',refresh);
$('storage-mode').addEventListener('change',refresh);
$('storage-destination').addEventListener('change',e=>{e.target.dataset.selected=e.target.value;});
$('reset-storage').addEventListener('click',()=>{
  controller?.abort();controller=null;steps.resume();clearArrow();
  state.inventory=seedInventory();history.length=0;
  working=false;loadClear=true;staged=null;$('staged-pallet').dataset.position='empty';pending.clear();state.job=null;state.infeed=false;state.carriage=parked();
  $('belt-pallet').dataset.position='empty';cylinder(false);
  conveyorFeedback('Ready');text('conveyor-command','—');text('plc-command','—');text('plc-feedback','Parked');text('carriage-state','Parked');text('db-exchange','Ready to read rack inventory.');
  text('operator-status','Ready');text('form-message','Enter a storage order here. Scan the pallet at the conveyor.');
  $('storage-request').reset();delete $('storage-destination').dataset.selected;
  $('scan-form').reset();$('scan-message').classList.remove('error');text('scan-message','Scan a pallet with a queued storage order.');event('Awaiting operator request.');
  refresh();records();store();
});
store();records();refresh();warehouse($('rack'),state);
