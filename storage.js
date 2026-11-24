import {mountConveyor} from './scene.js';
import {setupMoveReport,resetMoveReport} from './move-report.js';
import {warehouse,address,sameSlot} from './scene.js';
import {runTransfer} from './carriage.js';
import {arrow,clearArrow,wait} from './links.js';
import {readDatabase,writeDatabase,markInterrupted,seedInventory,pendingDepartures,demoUsername,storedDetails} from './database.js';
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
const freeload=()=>$('freeload-mode').checked;
let controller,working=false,loadClear=true,staged,clearRejected,orderValidation;
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
  state.offRack=new Set(pendingDepartures(history).map(entry=>entry.id));
  $('pending-db-link').hidden=!state.offRack.size;
  const queue=[...pending].map(([id,request])=>[
    id,request.mode==='specified'?request.address:'Most Efficient',request.requestedBy||'—',
    working&&state.job?.id===id?state.job.entry.event:staged?.id===id?'Loaded at infeed':'Pending · waiting for pallet',
  ]);
  recordRows('queue',queue,'No queued storage orders.',4);
  const operatorRows=new Map(queue.map(([id,destination,,status])=>[id,[id,destination,status]]));
  if(staged?.automatic)operatorRows.set(staged.id,[staged.id,address(staged.target),'Freeload · Loaded at infeed']);
  for(const entry of history){
    if(entry.from!=='Infeed'||operatorRows.has(entry.id))continue;
    if(entry.event==='Completed')operatorRows.set(entry.id,[entry.id,entry.to,'Order completed']);
    else if(entry.freeload)operatorRows.set(entry.id,[entry.id,entry.to,'Freeload · '+entry.event]);
  }
  recordRows('operator-queue',[...operatorRows.values()],'No storage orders.',3);
  recordRows('records',state.inventory.map(item=>[item.id,address(item.slot),state.offRack.has(item.id)?'Unloaded · write pending':'Stored',...storedDetails(item)]),'No stored pallets.',5);
  recordRows('history',history.map(item=>[item.id,item.from,item.to,item.requestedBy||'—',item.event+' · '+new Date(item.at).toLocaleTimeString()]),'No moves recorded.',5);
}
function log(entry,label,finished=false){
  Object.assign(entry,{event:label,at:new Date().toISOString(),finished});
  store();records();
}
function occupied(slot){return state.inventory.some(item=>sameSlot(item.slot,slot));}
function refresh(){
  const control=$('storage-destination'), mode=$('storage-mode').value;
  for(const id of ['pallet-id','storage-mode'])$(id).disabled=freeload();
  $('queue-order').disabled=freeload()||!!orderValidation;
  $('freeload-mode').disabled=!!orderValidation;
  const before=control.dataset.selected??control.value;
  control.replaceChildren(...slots.map(slot=>new Option(address(slot)+(occupied(slot)?' — occupied':''),address(slot))));
  [...control.options].forEach((option,index)=>{option.disabled=occupied(slots[index]);});
  control.value=[...control.options].find(o=>o.value===before&&!o.disabled)?.value??[...control.options].find(o=>!o.disabled)?.value??'';
  if(freeload()||mode!=='specified'){
    control.prepend(new Option('Assigned by Ignition',''));
    control.value='';
  }else control.dataset.selected=control.value;
  control.disabled=freeload()||mode!=='specified';
  for(const id of ['load-pallet','scan-id','load-profile'])$(id).disabled=!loadClear||!!staged;
  const guided=$('step-demo').checked||$('trace-demo').checked;
  $('queue-order').classList.toggle('next-highlight',guided&&!freeload()&&!pending.size);
  $('load-pallet').classList.toggle('next-highlight',guided&&loadClear&&!staged&&(freeload()||[...pending.keys()].some(id=>!working||id!==state.job?.id)));
}
function palletId(id){
  if(!id)throw new Error('Enter the pallet ID shown on the barcode.');
  if(state.offRack.has(id))throw new Error('Pallet '+id+' was unloaded. Finish the pending retrieval write first.');
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
const conveyorReport=(value,signal)=>steps.observe('conveyor',value,signal);
function clearAlarm(){
  $('storage-alarm').hidden=true;
  $('remove-rejected').hidden=true;
  $('belt-pallet').classList.remove('rejected');
  const release=clearRejected;clearRejected=null;release?.();
}
function scanPrompt(){
  return freeload()?'Scan a pallet. Ignition will honor an existing order or choose a rack location.':'Scan a pallet with a queued storage order.';
}

async function runConveyor(signal,entry,profile){
  conveyorFeedback('Indexing to check station');
  $('belt-pallet').dataset.position='scale';
  await conveyorReport('Indexing to weight and dimension check',signal);
  await wait(900,signal);
  loadClear=true;refresh();
  text('scan-message','Loading area clear. '+scanPrompt());
  conveyorFeedback('Weighing and sizing');
  log(entry,'Weighing and sizing');
  await conveyorReport('Pallet at weight and dimension check',signal);
  await wait(750,signal);
  const failedCheck={
    overweight:'Overweight pallet · 1,260 lb measured, 1,000 lb demo limit',
    oversize:'Oversize pallet · 58 in measured, 48 in demo limit',
  }[profile];
  if(failedCheck){
    const alarm=entry.id+' · '+failedCheck;
    text('storage-alarm',alarm+'. Pallet held at the check station.');
    $('storage-alarm').hidden=false;
    $('belt-pallet').classList.add('rejected');
    text('operator-status','Alarm');
    text('scan-message','Remove the rejected pallet from the check station before retrying it.');
    conveyorFeedback('Held at check station · '+failedCheck);
    event('Ignition received a failed conveyor check.');
    log(entry,'Rejected · '+failedCheck,true);
    await conveyorReport(alarm,signal);
    $('remove-rejected').hidden=false;
    await new Promise(resolve=>{clearRejected=resolve;});
    signal.throwIfAborted();
    $('belt-pallet').dataset.position='empty';
    conveyorFeedback('Rejected pallet removed');
    await conveyorReport('Rejected pallet removed',signal);
    text('operator-status',entry.freeload?'Ready':'Pending');
    text('scan-message',entry.freeload?'Scan the corrected load with Freeload Mode on to retry.':'Storage order stays queued. Scan the corrected load to retry.');
    event('Check station cleared after rejected pallet removal.');
    return false;
  }
  log(entry,'Weight and dimensions passed');
  conveyorFeedback('Weight and dimensions passed');
  await conveyorReport('Weight and dimensions passed',signal);
  conveyorFeedback('Indexing to pickup stand');
  $('belt-pallet').dataset.position='pickup';
  await conveyorReport('Indexing to pickup stand',signal);
  await wait(900,signal);
  cylinder(true);
  conveyorFeedback('Squaring pallet at pickup');
  await conveyorReport('Transfer cylinders extended to square pallet',signal);
  await wait(460,signal);
  $('belt-pallet').dataset.position='lifted';
  await wait(520,signal);
  conveyorFeedback('Pickup ready');
  return true;
}
$('storage-request').addEventListener('submit',async e=>{
  e.preventDefault();
  if(orderValidation||freeload())return;
  const local=new AbortController(),signal=local.signal;
  orderValidation=local;refresh();
  const entered=$('pallet-id').value.trim().toUpperCase(),request=order();
  try{
    await steps.lookup(signal);signal.throwIfAborted();
    flash('db','Check pallet and rack');
    const id=palletId(entered);
    if((working&&state.job?.id===id)||staged?.id===id)throw new Error('Pallet '+id+' is already in process.');
    allocate(request);
    if(pending.has(id))throw new Error('A storage order for '+id+' is already queued.');
    text('db-exchange',id+' is eligible for storage.');
    await steps.observe('database',id+' eligible for storage',signal);
    pending.set(id,request);
    store();records();refresh();
    if(!working)text('operator-status','Pending');
    text('form-message','Storage order queued for '+id+'. Pending orders: '+[...pending.keys()].join(', ')+'.');
    event('Waiting for the matching pallet to be loaded.');
  }catch(error){
    if(!signal.aborted){
      text('db-exchange',error.message);
      text('form-message',error.message);
      await steps.observe('database','Inventory validation rejected · '+error.message);
    }
  }finally{
    if(orderValidation===local){orderValidation=null;refresh();}
  }
});
function load(e){
  e.preventDefault();
  if(!loadClear||staged)return;
  let id,target,request,automatic;
  const scanned=$('scan-id').value.trim().toUpperCase();
  try{
    id=palletId(scanned);
    if(working&&state.job?.id===id)throw new Error('Pallet '+id+' is already in process.');
    request=pending.get(id);
    automatic=!request&&freeload();
    if(automatic)request={mode:'auto',requestedBy:requester()};
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
    event(error.message);
    void conveyorReport('Barcode rejected · '+error.message);
    return;
  }
  $('scan-message').classList.remove('error');
  const next={id,request,target,automatic,storedBy:requester(),profile:$('load-profile').value};
  if(working){
    staged=next;
    text('staged-pallet',id);$('staged-pallet').dataset.position='load';
    text('scan-message','Pallet '+id+' is loaded at the infeed, waiting for the current storage cycle.');
    flash('conveyor','Infeed scan '+id,true);refresh();records();
    return;
  }
  void runStorage(next);
}
async function runStorage({id,request,target,automatic,storedBy,profile}){
  working=true;loadClear=false;
  text('scan-message','Barcode '+id+(automatic?' accepted in Freeload Mode.':' matched a queued order.'));
  refresh();
  const local=new AbortController();controller=local;const signal=local.signal;
  const entry={id,from:'Infeed',to:address(target),requestedBy:request.requestedBy,freeload:automatic};
  history.unshift(entry);
  state.job={id,from:null,to:target,motion:null,entry};
  text('belt-pallet',id);
  $('belt-pallet').dataset.position='load';
  text('plc-command','—');
  text('plc-feedback','Parked');
  text('conveyor-command','—');
  text('form-message',automatic?'Freeload · '+id+' scanned at infeed':id+' · Infeed to '+entry.to);
  text('db-exchange',automatic?'Waiting to check rack availability.':'Destination reserved: '+entry.to);
  text('operator-status','Loaded');
  conveyorFeedback('Barcode read: '+id);
  event(automatic?'Ignition received a Freeload scan.':'Ignition matched the infeed scan and reserved '+entry.to+'.');
  log(entry,'Pallet scanned');
  try{
    await conveyorReport('Barcode read: '+id,signal);
    if(automatic){
      await steps.lookup(signal);signal.throwIfAborted();
      flash('db','Check pallet and rack availability');
      text('form-message','Freeload · '+id+' · Infeed to '+entry.to);
      text('db-exchange','Freeload destination reserved: '+entry.to);
      event('Ignition selected '+entry.to+' for Freeload pallet '+id+'.');
      await steps.observe('database','Pallet eligible; rack '+entry.to+' available',signal);
    }
    await steps.pause('step-conveyor');signal.throwIfAborted();
    text('conveyor-command','Release '+id+' to pickup stand');
    event('Conveyor release sent.');
    text('operator-status','In process on conveyor');
    log(entry,'In process on conveyor');
    flash('conveyor','Conveyor release');
    await wait(720,signal);
    if(!await runConveyor(signal,entry,profile))return;
    state.infeed=true;
    event('Ignition received pickup-ready from the Conveyor PLC.');
    log(entry,'Waiting for carriage pickup');
    await conveyorReport('Pickup ready · '+id,signal);
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
      report:async feedback=>{
        text('plc-feedback',feedback.status);text('carriage-state',feedback.status);event(feedback.detail);
        if(feedback.carrying)text('operator-status','In process on carriage');
        if(feedback.status==='Pallet aboard'){
          log(entry,'In process on carriage');
          await conveyorReport('Pickup stand clear',signal);
        }
        if(feedback.location){placement=feedback.location;log(entry,feedback.status);}
        await steps.observe('carriage',feedback.detail,signal,feedback.status);
      },
    });
    text('db-exchange','Placement confirmed. Inventory update pending.');
    if(!$('step-demo').checked)await wait(720,signal);
    await steps.pause('step-inventory');signal.throwIfAborted();
    state.inventory.push({id,slot:placement,storedAt:new Date().toISOString(),storedBy});state.job.motion=null;
    if(!automatic)pending.delete(id);
    flash('db','Store rack location');
    text('db-exchange','Write committed: '+id+' at '+entry.to+'.');
    event('Inventory updated. Storage recorded in move history.');
    text('operator-status','Order completed');
    log(entry,'Completed',true);
    await steps.observe('database','Inventory write committed for '+id,signal);
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
$('freeload-mode').addEventListener('change',()=>{
  if(!working)text('form-message',freeload()?'Freeload Mode is on. Load and scan at the conveyor.':'Enter a storage order here. Scan the pallet at the conveyor.');
  if(loadClear&&!staged&&!clearRejected)text('scan-message',scanPrompt());
  refresh();
});
$('step-demo').addEventListener('change',refresh);
$('trace-demo').addEventListener('change',refresh);
$('remove-rejected').addEventListener('click',clearAlarm);
$('storage-mode').addEventListener('change',refresh);
$('storage-destination').addEventListener('change',e=>{e.target.dataset.selected=e.target.value;});
$('reset-storage').addEventListener('click',()=>{
  resetMoveReport();
  controller?.abort();controller=null;orderValidation?.abort();orderValidation=null;$('queue-order').disabled=false;steps.resume();clearAlarm();clearArrow();
  state.inventory=seedInventory();history.length=0;
  working=false;loadClear=true;staged=null;$('staged-pallet').dataset.position='empty';pending.clear();state.job=null;state.infeed=false;state.carriage=parked();
  $('belt-pallet').dataset.position='empty';cylinder(false);
  conveyorFeedback('Ready');text('conveyor-command','—');text('plc-command','—');text('plc-feedback','Parked');text('carriage-state','Parked');text('db-exchange','Ready to read rack inventory.');
  text('operator-status','Ready');text('form-message','Enter a storage order here. Scan the pallet at the conveyor.');
  $('freeload-mode').checked=false;
  $('storage-request').reset();delete $('storage-destination').dataset.selected;
  $('scan-form').reset();$('scan-message').classList.remove('error');text('scan-message','Scan a pallet with a queued storage order.');event('Awaiting operator request.');
  refresh();records();store();
});
store();records();refresh();warehouse($('rack'),state);

mountConveyor($('conveyor-stage'));

setupMoveReport();
