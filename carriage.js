import {slotPosition} from './scene.js';

function move(signal,model,to,ms){
  return new Promise((resolve,reject)=>{
    const from=Object.fromEntries(Object.keys(to).map(key=>[key,model[key]]));
    const start=performance.now();
    function next(now){
      if(signal.aborted){reject(signal.reason);return;}
      const t=Math.min(1,(now-start)/ms), eased=t*t*(3-2*t);
      for(const key of Object.keys(to))model[key]=from[key]+(to[key]-from[key])*eased;
      if(t<1)requestAnimationFrame(next);else resolve();
    }
    requestAnimationFrame(next);
  });
}

export const pickupStation=[-8,.43,1.65];

export async function runTransfer({palletId,from,to},{carriage,load,report,signal}){
  const [fx,fy,fz]=from?slotPosition(from):pickupStation, [tx,ty,tz]=to?slotPosition(to):pickupStation;
  const destination=to?'destination rack':'outfeed stand';
  const source=from?'source rack':'conveyor pickup station';
  const emit=(status,detail,carrying=false)=>report({palletId,status,detail,carrying});
  signal.throwIfAborted();
  await emit('Moving to source','Command accepted. Traveling to the '+source+'.');
  await move(signal,carriage,{x:fx,y:fy},1100);
  await emit('At source','Carriage aligned with the '+source+'.');
  await emit('Picking pallet','Forks extending at the '+source+'.');
  await move(signal,carriage,{fork:fz},590);
  const pallet={x:fx,y:fy,z:fz};
  load(pallet);
  await Promise.all([move(signal,carriage,{fork:0},720),move(signal,pallet,{z:0},720)]);
  await emit('Pallet aboard','Pickup confirmed by the Carriage PLC.',true);
  await emit('Traveling with pallet','Moving to the '+destination+'.',true);
  await Promise.all([move(signal,carriage,{x:tx,y:ty},1450),move(signal,pallet,{x:tx,y:ty},1450)]);
  await emit('At destination','Carriage aligned with the '+destination+'.',true);
  await emit('Placing pallet','Forks extending at the '+destination+'.',true);
  await Promise.all([move(signal,carriage,{fork:tz},650),move(signal,pallet,{z:tz},650)]);
  await move(signal,carriage,{fork:0},540);
  await report(to?{palletId,status:'Placement confirmed',detail:'Placement confirmed by the Carriage PLC.',location:to}:{palletId,status:'Outfeed deposit confirmed',detail:'Pallet deposited at the outfeed stand and forks clear.',deposited:true});
}
