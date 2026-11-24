const key='asrs-transfer-demo-v2';
export function seedInventory(){
  return [['123',2,1,'L'],['456',3,2,'R'],['789',5,1,'L'],['321',7,2,'L']]
    .map(([id,bay,level,side])=>({id,slot:{bay,level,side}}));
}
export function readDatabase(){
  try{
    const data=JSON.parse(localStorage.getItem(key));
    if(Array.isArray(data?.inventory)&&Array.isArray(data.history))
      return {inventory:data.inventory,history:data.history,queue:Array.isArray(data.queue)?data.queue:[]};
  }catch{}
  return {inventory:seedInventory(),history:[],queue:[]};
}
export function writeDatabase(inventory,history,queue=readDatabase().queue){
  try{localStorage.setItem(key,JSON.stringify({inventory,history,queue}));}catch{}
}
export function markInterrupted(history){
  let changed=false;
  for(const entry of history){
    if(entry.finished)continue;
    Object.assign(entry,{event:'Interrupted by reload',at:new Date().toISOString(),finished:true});
    changed=true;
  }
  return changed;
}

const usernameKey='asrs-demo-username';
export function demoUsername(){
  const input=document.getElementById('demo-username');
  const read=()=>input.value.trim()||'demo.operator';
  try{input.value=localStorage.getItem(usernameKey)||input.defaultValue;}catch{}
  input.addEventListener('change',()=>{
    input.value=read();
    try{localStorage.setItem(usernameKey,input.value);}catch{}
  });
  return read;
}
const dateFormat=new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'});
export function storedDetails(item){
  return [item.storedAt?dateFormat.format(new Date(item.storedAt)):'—',item.storedBy||'—'];
}
