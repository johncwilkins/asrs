import {warehouse, sameSlot, address} from './scene.js';
import {runTransfer} from './carriage.js';
import {arrow,clearArrow,wait} from './links.js';
import {readDatabase,writeDatabase,seedInventory,markInterrupted,pendingDepartures,demoUsername,storedDetails} from './database.js';
import {systemSteps} from './steps.js';

const $ = id => document.getElementById(id);
const requester=demoUsername();
const bins = [1,2,3,4,5,6,7], levels = [1,2], sides = ['L','R'];
const allSlots = bins.flatMap(bay=>levels.flatMap(level=>sides.map(side=>({bay,level,side}))));
const initialCarriage=()=>({x:-6,y:.43,fork:0});
const state={inventory:seedInventory(),history:[],carriage:initialCarriage(),job:null,running:false};
const source=$('source'), picker=$('pallet-list'), addressFields=['bin','level','side'].map($);
const fields=['lookup','source','show-pallets','mode'].map($);
const clock=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'});
let highlighted=-1, controller;
const steps=systemSteps();
const active=()=>state.running;
const compact=value=>value.trim().toUpperCase().replace(/[\s-]/g,'');
const parseSlot=value=>allSlots.find(slot=>compact(address(slot))===compact(value));
const occupied=slot=>state.inventory.some(item=>sameSlot(item.slot,slot));
const byId=()=>$('lookup').value==='id';
const automatic=()=>$('mode').value==='auto';

function badge(id,label,complete=false){
  $(id).textContent=label;
  $(id).classList.toggle('done',complete);
}
function ignitionEvent(message){
  $('event').lastChild.textContent=' '+message;
}
function showFeedback(status,complete=false){
  $('plc-feedback').textContent=status;
  badge('carriage-state',status,complete);
}
function cells(values){
  const row=document.createElement('tr');
  for(const value of values){const td=document.createElement('td');td.textContent=value;row.append(td);}
  return row;
}
function records(){
  state.offRack=new Set(pendingDepartures(state.history).map(entry=>entry.id));
  $('pending-db-link').hidden=!state.offRack.size;
  $('records').replaceChildren(...state.inventory.map(item=>{
    const selected=state.job?.id===item.id;
    const status=state.offRack.has(item.id)?'Unloaded · write pending':selected&&state.job.motion?'In transit':selected&&active()?'Allocated':'Stored';
    const row=cells([item.id,address(item.slot),status,...storedDetails(item)]);
    if(selected)row.className='focus';
    return row;
  }));
  const rows=state.history.map(entry=>{
    const row=cells([entry.id,entry.from,entry.to,entry.requestedBy||'—',entry.event]);
    const time=document.createElement('time');
    time.dateTime=entry.at;
    time.textContent=clock.format(new Date(entry.at));
    row.lastChild.append(time);
    return row;
  });
  if(!rows.length){
    const row=cells(['No transfer recorded.']);
    row.firstChild.colSpan=5;row.firstChild.className='empty';rows.push(row);
  }
  $('history').replaceChildren(...rows);
}
function save(){writeDatabase(state.inventory,state.history);}
function restore(){
  const data=readDatabase();
  state.inventory=data.inventory;state.history=data.history;
  if(markInterrupted(state.history))save();
}
function log(event,finished=false){
  Object.assign(state.job.entry,{event,finished,at:new Date().toISOString()});
  records();save();
}
function closePicker(){
  picker.hidden=true;highlighted=-1;
  source.setAttribute('aria-expanded','false');source.removeAttribute('aria-activedescendant');
}
function highlight(index){
  const rows=[...picker.querySelectorAll('[role=option]')];
  if(!rows.length)return;
  highlighted=(index+rows.length)%rows.length;
  rows.forEach((row,i)=>row.setAttribute('aria-selected',String(i===highlighted)));
  source.setAttribute('aria-activedescendant',rows[highlighted].id);
  rows[highlighted].scrollIntoView({block:'nearest'});
}
function selectPallet(id){
  source.value=id;closePicker();source.focus();
}
function showPicker(filter=''){
  if(!byId()||active())return;
  const found=state.inventory.filter(item=>!state.offRack.has(item.id)&&item.id.startsWith(filter.trim().toUpperCase())).sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
  picker.replaceChildren(...found.map((item,i)=>{
    const option=document.createElement('li'), location=document.createElement('span');
    option.id='pallet-option-'+i;option.dataset.id=item.id;option.setAttribute('role','option');option.setAttribute('aria-selected','false');
    location.textContent=address(item.slot);
    option.append(item.id,location);
    option.addEventListener('pointerdown',event=>event.preventDefault());
    option.addEventListener('click',()=>selectPallet(item.id));
    return option;
  }));
  if(!found.length){const row=document.createElement('li');row.textContent='No matching pallets';row.setAttribute('role','presentation');picker.append(row);}
  picker.hidden=false;highlighted=-1;source.setAttribute('aria-expanded','true');source.removeAttribute('aria-activedescendant');
}
function choices(el,values,label,taken,preferred){
  const previous=preferred??el.value;
  el.replaceChildren(...values.map(value=>{
    const option=document.createElement('option');option.value=value;option.disabled=taken(value);
    option.textContent=label(value)+(option.disabled?' — occupied':'');
    return option;
  }));
  const usable=[...el.options].filter(option=>!option.disabled);
  el.value=usable.find(option=>option.value===String(previous))?.value??usable[0]?.value??'';
}
function destinationOptions(preferred){
  const free=(bay,level,side)=>allSlots.some(slot=>(bay===undefined||slot.bay===bay)&&(level===undefined||slot.level===level)&&(side===undefined||slot.side===side)&&!occupied(slot));
  choices($('bin'),bins,n=>String(n).padStart(2,'0'),n=>!free(n),preferred?.bay);
  const bay=Number($('bin').value);
  choices($('level'),levels,n=>String(n).padStart(2,'0'),n=>!free(bay,n),preferred?.level);
  const level=Number($('level').value);
  choices($('side'),sides,side=>side==='L'?'Left':'Right',side=>!free(bay,level,side),preferred?.side);
}
function configure(){
  for(const field of fields)field.disabled=active();
  addressFields.forEach(el=>{el.disabled=active()||automatic()});
  $('source-label').textContent=byId()?'Pallet ID':'Source rack address';
  source.placeholder=byId()?'Type the start of an ID':'e.g. B02-L01-L';
  $('show-pallets').hidden=!byId();
  if(byId()){
    source.removeAttribute('list');source.setAttribute('role','combobox');
    source.setAttribute('aria-controls','pallet-list');source.setAttribute('aria-autocomplete','list');
    source.setAttribute('aria-expanded',String(!picker.hidden));
  }else{
    closePicker();source.setAttribute('list','rack-ids');
    for(const attr of ['role','aria-controls','aria-autocomplete','aria-expanded'])source.removeAttribute(attr);
  }
  $('run').disabled=active();
  $('run').textContent=active()?'Transfer in progress':'Start transfer';
}
function message(value,error=false){
  $('form-message').textContent=value;$('form-message').classList.toggle('error',error);
}
function reset(){
  controller?.abort();
  clearArrow();
  steps.resume();
  state.inventory=seedInventory();state.history=[];state.carriage=initialCarriage();
  state.job=null;state.running=false;
  $('request').reset();closePicker();destinationOptions({bay:6,level:2,side:'R'});
  ignitionEvent('Awaiting operator request.');showFeedback('Parked');badge('operator-status','Ready');
  $('plc-command').textContent='—';$('db-exchange').textContent='Ready to read rack inventory.';
  message('Choose a pallet and an available destination.');
  records();configure();writeDatabase(state.inventory,state.history,[]);
}
function choose(item){
  if(!automatic()){
    const slot=allSlots.find(slot=>slot.bay===Number($('bin').value)&&slot.level===Number($('level').value)&&slot.side===$('side').value);
    if(!slot||occupied(slot))throw new Error('Choose an available destination.');
    return slot;
  }
  const score=slot=>Math.abs(slot.bay-item.slot.bay)*2+Math.abs(slot.level-item.slot.level)*1.75+(slot.side===item.slot.side?0:.65);
  return allSlots.filter(slot=>!occupied(slot)).sort((a,b)=>score(a)-score(b))[0];
}
function completeTransfer(job,location){
  job.item.slot=location;
  job.motion=null;
  showFeedback('Placement confirmed · '+address(location),true);
  $('db-exchange').textContent='Write committed: '+job.id+' is stored at '+address(location)+'. Source released.';
  ignitionEvent('Received placement confirmation and updated inventory.');
  badge('operator-status','Order completed',true);
  log('Completed',true);
  destinationOptions();
  configure();
}
async function start(){
  const raw=source.value.trim();
  const slot=byId()?null:parseSlot(raw);
  const item=state.inventory.find(item=>byId()?item.id===raw.toUpperCase():slot&&sameSlot(item.slot,slot));
  let target;
  try{
    if(!item)throw new Error('No stored pallet matches that source.');
    if(state.offRack.has(item.id))throw new Error('Pallet '+item.id+' was unloaded. Finish the pending retrieval write first.');
    target=choose(item);
    if(!target)throw new Error('There are no eligible empty rack slots.');
  }catch(error){
    message(error.message,true);
    ignitionEvent('Request held. '+error.message);
    $('db-exchange').textContent='Inventory check: '+error.message;
    return;
  }
  const entry={id:item.id,from:address(item.slot),to:address(target),requestedBy:requester()};
  const job={id:item.id,item,from:item.slot,to:target,motion:null,entry};
  state.history.unshift(entry);
  state.job=job;
  state.running=true;
  controller=new AbortController();
  const signal=controller.signal;
  $('db-exchange').textContent='Read inventory: '+entry.from+' verified. '+entry.to+' available and reserved for this transfer.';
  $('plc-command').textContent='—';
  ignitionEvent('Inventory checked. Destination reserved.');
  badge('operator-status','Pending');
  message(item.id+' · '+entry.from+' to '+entry.to);
  log('Destination reserved');
  configure();

  try{
    await steps.lookup(signal);signal.throwIfAborted();
    arrow('.backend .interface:first-child','.inventory','Check rack inventory');
    await steps.observe('database','Source confirmed and destination reserved',signal);
    await steps.pause('step-carriage');
    signal.throwIfAborted();
    $('plc-command').textContent='Transfer '+item.id+' · '+entry.from+' → '+entry.to;
    ignitionEvent('Transfer command sent. Monitoring Carriage PLC feedback.');
    badge('operator-status','Dispatched');
    log('Command sent');
    arrow('.backend .interface:nth-child(2)','.carriage','Transfer command');
    await wait(760,signal);
    let placement;
    await runTransfer({palletId:item.id,from:job.from,to:job.to},{
      carriage:state.carriage,signal,
      load:pallet=>{job.motion=pallet;},
      report:feedback=>{
        if(feedback.location)placement=feedback.location;
        showFeedback(feedback.status);
        ignitionEvent(feedback.detail);
        if(feedback.carrying)badge('operator-status','In process');
        log(feedback.status);
        return steps.observe('carriage',feedback.detail,signal,feedback.status);
      },
    });
    $('db-exchange').textContent='Placement confirmed. Inventory update is pending.';
    if(!$('step-demo').checked)await wait(720,signal);
    await steps.pause('step-inventory');
    signal.throwIfAborted();
    arrow('.backend .interface:first-child','.inventory','Save rack location');
    completeTransfer(job,placement);
    await steps.observe('database','Inventory write committed for '+job.id,signal);
    signal.throwIfAborted();
    state.running=false;configure();
  }catch(error){
    if(signal.aborted)return;
    state.running=false;
    showFeedback('Transfer interrupted');
    badge('operator-status','Interrupted');
    ignitionEvent('Carriage feedback stopped. Check the simulation before retrying.');
    log('Interrupted',true);
    configure();
    console.error(error);
  }
}
source.addEventListener('click',()=>{if(picker.hidden)showPicker()});
source.addEventListener('input',()=>showPicker(source.value));
source.addEventListener('blur',closePicker);
source.addEventListener('keydown',event=>{
  if(!byId())return;
  if(event.key==='Escape'){closePicker();return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault();
    if(picker.hidden)showPicker();
    highlight(highlighted<0?(event.key==='ArrowDown'?0:-1):highlighted+(event.key==='ArrowDown'?1:-1));
  }
  if(event.key==='Enter'&&!picker.hidden){
    event.preventDefault();
    const rows=picker.querySelectorAll('[role=option]');
    if(rows[highlighted]||rows.length===1)selectPallet((rows[highlighted]??rows[0]).dataset.id);
  }
});
$('show-pallets').addEventListener('pointerdown',event=>event.preventDefault());
$('show-pallets').addEventListener('click',()=>{
  if(!picker.hidden){closePicker();return;}
  source.focus();showPicker();
});
$('lookup').addEventListener('change',()=>{
  const item=state.inventory[0];
  source.value=item?(byId()?item.id:address(item.slot)):'';configure();
});
$('mode').addEventListener('change',configure);
for(const field of addressFields.slice(0,2))field.addEventListener('change',()=>destinationOptions());
$('request').addEventListener('submit',event=>{
  event.preventDefault();
  if(active())return;
  closePicker();
  void start();
});
$('reset').addEventListener('click',reset);
$('rack-ids').replaceChildren(...allSlots.map(slot=>new Option(address(slot))));
restore();
destinationOptions({bay:6,level:2,side:'R'});
records();configure();
warehouse($('rack'),state);
