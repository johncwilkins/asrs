import qrcode from './vendor/qrcode.mjs';
import {readDatabase} from './database.js';

const reportKey='asrs-completed-moves-reported-v1';
const columns=['Action','Pallet','From','To','Requested by','Completed (UTC)'];
const ascii=value=>String(value??'').normalize('NFKD').replace(/\p{Mark}/gu,'').replace(/[^\x20-\x7e]/gu,'?');

export function resetMoveReport(){
  try{localStorage.removeItem(reportKey);}catch{}
}

function acknowledgments(){
  try{return new Set(JSON.parse(localStorage.getItem(reportKey))??[]);}
  catch{return new Set();}
}

export function reportRows(history,reported){
  return history.filter(entry=>entry.event==='Completed'&&entry.finished).reverse().map(entry=>{
    const action=entry.from==='Infeed'?'STORE':entry.to.startsWith('Outfeed')?'RETRIEVE':'TRANSFER';
    const values=[action,entry.id,entry.from,action==='RETRIEVE'?'Outfeed exit':entry.to,entry.requestedBy,entry.at].map(ascii);
    const key=JSON.stringify([action,entry.id,entry.from,entry.to,entry.requestedBy,entry.at]);
    const payload=values.map(value=>'"'+value.replaceAll('"','""')+'"').join(',');
    return {key,values,payload};
  }).filter(row=>!reported.has(row.key));
}

function qrImage(payload){
  const code=qrcode(0,'M');
  code.addData(payload,'Byte');
  code.make();
  const image=document.createElement('img');
  image.alt='QR code for this move';
  image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(code.createSvgTag(4));
  return image;
}

export function setupMoveReport(){
  const open=document.getElementById('move-report-open');
  const dialog=document.createElement('dialog');
  dialog.className='move-report';
  dialog.setAttribute('aria-labelledby','move-report-title');
  dialog.innerHTML='<div class="report-toolbar"><button type="button" data-print>Print report</button><button type="button" data-confirm disabled>Confirm printed</button><button type="button" data-close>Close</button></div><h2 id="move-report-title">AS/RS completed moves</h2><p data-summary></p><p class="report-format">QR codes contain one ASCII CSV record per move in the column order shown.</p><table><thead></thead><tbody></tbody></table><p role="status" data-status></p>';
  document.body.append(dialog);
  const print=dialog.querySelector('[data-print]');
  const confirm=dialog.querySelector('[data-confirm]');
  const status=dialog.querySelector('[data-status]');
  const head=dialog.querySelector('thead').insertRow();
  for(const title of [...columns,'QR code']){
    const th=document.createElement('th');
    th.scope='col';
    th.textContent=title;
    head.append(th);
  }
  let batch=[];
  function render(){
    batch=reportRows(readDatabase().history,acknowledgments());
    dialog.querySelector('[data-summary]').textContent=batch.length?batch.length+' completed move'+(batch.length===1?'':'s')+' since the last confirmed report.':'No completed moves are waiting to be reported.';
    const body=dialog.querySelector('tbody');
    body.replaceChildren();
    for(const item of batch){
      const row=body.insertRow();
      for(const value of item.values)row.insertCell().textContent=value;
      row.insertCell().append(qrImage(item.payload));
    }
    print.disabled=!batch.length;
    confirm.disabled=true;
    status.textContent='';
  }
  open.addEventListener('click',()=>{
    render();
    dialog.showModal();
  });
  print.addEventListener('click',async ()=>{
    if(!batch.length)return;
    const printingBatch=batch;
    try{await Promise.all([...dialog.querySelectorAll('img')].map(image=>image.decode()));}
    catch{status.textContent='A QR code could not be prepared. Reopen the report and try again.';return;}
    if(!dialog.open||batch!==printingBatch)return;
    window.print();
    confirm.disabled=false;
    status.textContent='Confirm after the report prints successfully.';
  });
  confirm.addEventListener('click',()=>{
    const reported=acknowledgments();
    const currentKeys=new Set(reportRows(readDatabase().history,new Set()).map(row=>row.key));
    for(const row of batch)if(currentKeys.has(row.key))reported.add(row.key);
    try{localStorage.setItem(reportKey,JSON.stringify([...reported]));}
    catch{status.textContent='The printed batch could not be saved in this browser.';return;}
    render();
    status.textContent='Printed batch recorded.';
  });
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
}
