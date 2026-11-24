const faces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]];
const shades = [.60,.83,1,.56,.70,.88];
const colorCache = new Map();
function shade(color, amount) {
  const key = color + amount;
  if (colorCache.has(key)) return colorCache.get(key);
  const rgb = color.match(/.{2}/g).map(value => Math.round(parseInt(value,16)*amount));
  const result = 'rgb('+rgb.join(',')+')';
  colorCache.set(key,result);
  return result;
}
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((v,n,i)=>v+n*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>a.map(v=>v/Math.hypot(...a));
export const address = ({bay,level,side}) => 'B'+String(bay).padStart(2,'0')+'-L'+String(level).padStart(2,'0')+'-'+side;
export function slotPosition(slot){
  return [slot.bay*2-8, .43 + (slot.level-1)*1.75, slot.side==='L'?-2.03:2.03];
}

export function warehouse(canvas,state,options={}){
  const ctx=canvas.getContext('2d');
  const conveyor=options.conveyor;
  let yaw=-.55,pitch=.48,overhead=false,drag,magnification=1;
  const controls=options.controls??document.querySelector('#view').parentElement;
  const control=controls.querySelector('button');
  const zoomButtons=[-1,1].map(direction=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='zoom-button';
    button.textContent=direction<0?'−':'+';
    button.setAttribute('aria-label',direction<0?'Zoom out':'Zoom in');
    button.addEventListener('click',()=>adjustZoom(direction));
    controls.append(button);
    return button;
  });
  function adjustZoom(direction){
    magnification=Math.min(2.25,Math.max(.55,magnification*1.16**direction));
    zoomButtons[0].disabled=magnification<=.55;
    zoomButtons[1].disabled=magnification>=2.25;
  }
  canvas.addEventListener('wheel',e=>{
    if(document.activeElement!==canvas||!e.deltaY)return;
    e.preventDefault();
    adjustZoom(e.deltaY<0?1:-1);
  },{passive:false});
  function preset(){
    yaw=overhead?-.15:conveyor?-.32:-.55;
    pitch=overhead?1.25:.48;
    control.textContent=overhead?'Top view':conveyor?'Conveyor view':'Aisle view';
    control.setAttribute('aria-label',overhead?(conveyor?'Switch to conveyor view':'Switch to aisle view'):'Switch to top view');
  }
  control.addEventListener('click',()=>{overhead=!overhead;preset()});
  canvas.addEventListener('pointerdown', e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)});
  canvas.addEventListener('pointermove',e=>{
    if(!drag)return;
    yaw=(yaw+(e.clientX-drag[0])*.011)%(2*Math.PI);
    pitch=Math.max(.29,Math.min(1.4,pitch+(e.clientY-drag[1])*.007));
    drag=[e.clientX,e.clientY];
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{drag=null});
  canvas.addEventListener('keydown',e=>{
    if(['+','=','-'].includes(e.key)){
      e.preventDefault();
      adjustZoom(e.key==='-'?-1:1);
      return;
    }
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();
    yaw=(yaw+(e.key==='ArrowLeft'?.12:e.key==='ArrowRight'?-.12:0))%(2*Math.PI);
    pitch=Math.max(.29,Math.min(1.4,pitch+(e.key==='ArrowUp'?.1:e.key==='ArrowDown'?-.1:0)));
  });
  preset();

  function draw(){
    const w=canvas.clientWidth, h=canvas.clientHeight;
    const ratio=Math.min(devicePixelRatio,2);
    if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){
      canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
    }
    if(!w||!h)return;
    ctx.setTransform(ratio,0,0,ratio,0,0);
    const bg=ctx.createLinearGradient(0,0,0,h);
    bg.addColorStop(0,'#0c1928');bg.addColorStop(1,'#294155');
    ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    const aim=[0,conveyor?1.05:1.28,0],range=22;
    const eye=[Math.sin(yaw)*Math.cos(pitch)*range,aim[1]+Math.sin(pitch)*range,Math.cos(yaw)*Math.cos(pitch)*range];
    const forward=norm(sub(aim,eye)), right=norm(cross(forward,[0,1,0])), up=cross(right,forward);
    const zoom=Math.min(w/(conveyor?15.6:17),h/(conveyor?6.2:7.7))*range*magnification;
    const polygons=[];
    function project(p){
      const v=sub(p,eye), d=dot(v,forward), scale=zoom/d;
      return [w*.5+dot(v,right)*scale,h*.54-dot(v,up)*scale,d];
    }
    function box(x,y,z,dx,dy,dz,color,opacity=1){
      const points=[[x-dx/2,y,z-dz/2],[x+dx/2,y,z-dz/2],[x+dx/2,y,z+dz/2],[x-dx/2,y,z+dz/2],[x-dx/2,y+dy,z-dz/2],[x+dx/2,y+dy,z-dz/2],[x+dx/2,y+dy,z+dz/2],[x-dx/2,y+dy,z+dz/2]].map(project);
      faces.forEach((face,i)=>{
        const p=face.map(n=>points[n]);
        if((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0])>=0)return;
        polygons.push({p,depth:p.reduce((n,v)=>n+v[2],0)/4,color:shade(color,shades[i]),opacity});
      });
    }
    function pallet(x,y,z,active){
      box(x,y,z,1.31,.15,1.06,'b18b5c');
      box(x,y+.15,z,1.19,.69,.91,active?'ffb252':'879bb0');
      for(const k of [0,.32])box(x,y+.23+k,z,1.20,.035,.92,active?'ffe2ad':'bac9d7');
    }
    function floorLine(a,b,color){
      const [x,y]=project(a),[u,v]=project(b);
      ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(u,v);ctx.stroke();
    }
    const floor=[[-8,-.08,-3.8],[8,-.08,-3.8],[8,-.08,3.8],[-8,-.08,3.8]].map(project);
    ctx.fillStyle='#263e50';ctx.beginPath();floor.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();
    for(let x=-8;x<=8;x++)floorLine([x,-.05,-3.8],[x,-.05,3.8],'#395064');
    for(let z=-3;z<=3;z++)floorLine([-8,-.05,z],[8,-.05,z],'#395064');
    if(conveyor){
      conveyor.build(box,pallet);
    }else{
    for(const z of [-.38,.38])box(0,0,z,15,.09,.13,'6e8e9e');
    for(const side of ['L','R']){
      const z=side==='L'?-2.03:2.03;
      const opacity=(side==='R'?eye[2]>0:eye[2]<0)&&pitch<.9?.40:1;
      for(let bay=1;bay<=7;bay++){
        const x=bay*2-8;
        for(const zz of [z-.67,z+.67])box(x-1,0,zz,.09,3.98,.09,'7896b0',opacity);
        if(bay===7)for(const zz of [z-.67,z+.67])box(x+1,0,zz,.09,3.98,.09,'7896b0',opacity);
        for(let level=1;level<=2;level++){
          const y=.43+(level-1)*1.75;
          const slot={bay,level,side};
          const source=state.job?.from&&sameSlot(state.job.from,slot);
          const destination=state.job?.to&&sameSlot(state.job.to,slot);
          const key=source?'55afff':destination?'58e0b5':'5f7f9b';
          for(const zz of [z-.63,z+.63])box(x,y-.12,zz,1.94,.13,.09,key,source||destination?1:opacity);
          if(source||destination)box(x,y-.065,z,1.89,.065,1.24,key,.55);
        }
      }
    }
    for(const item of state.inventory){
      if(state.offRack?.has(item.id)||state.job?.id===item.id&&(state.job.motion||state.job.offRack))continue;
      pallet(...slotPosition(item.slot),item.id===(state.job?.id??'123'));
    }
    if(state.storage||state.outfeed){
      box(-8,.16,1.65,1.35,.20,1.27,'426b85');
      if(state.infeed&&!state.job?.motion)pallet(-8,.43,1.65,true);
    }
    const {x,y,fork}=state.carriage;
    box(x,.08,0,.95,.22,1.15,'d59b45');
    box(x-.43,.29,-.36,.16,4.05,.18,'f2b657');
    box(x-.43,4.1,0,.17,.16,.87,'f2b657');
    box(x,y-.12,0,.95,.13,.82,'e4ad53');
    for(const offset of [-.26,.26]){
      const reach=.75+Math.abs(fork);
      box(x+offset,y-.06,fork*.5,.12,.065,reach,'aebdca');
    }
    if(state.job?.motion)pallet(state.job.motion.x,state.job.motion.y,state.job.motion.z,true);
    }
    polygons.sort((a,b)=>b.depth-a.depth).forEach(({p,color,opacity})=>{
      ctx.globalAlpha=opacity;ctx.fillStyle=color;ctx.beginPath();p.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();
    });
    ctx.globalAlpha=1;
    const occupiedLabels=[];
    function tag(point,label,color,small=false){
      const [x,y]=project(point);
      if(x<0||x>w||y<0||y>h)return;
      ctx.font=(small?'650 10px':'750 11px')+' system-ui';
      const width=ctx.measureText(label).width+(small?8:12);
      const height=small?14:18;
      const left=Math.max(3,Math.min(w-width-3,x-width/2));
      let top=Math.max(47,Math.min(h-height-3,y-height+3));
      const overlaps=()=>occupiedLabels.some(r=>left<r.right+2&&left+width>r.left-2&&top<r.bottom+2&&top+height>r.top-2);
      const initial=top;
      for(const shift of [-18,18,-36,36]){
        if(!overlaps())break;
        top=Math.max(47,Math.min(h-height-3,initial+shift));
      }
      if(small&&overlaps())return;
      occupiedLabels.push({left,right:left+width,top,bottom:top+height});
      ctx.fillStyle='#102333';ctx.fillRect(left,top,width,height);
      if(!small){ctx.strokeStyle=color;ctx.strokeRect(left+.5,top+.5,width-1,height-1);}
      ctx.fillStyle=color;ctx.fillText(label,left+(small?4:6),top+height-4);
    }
    if(conveyor){
      conveyor.label(tag);
      requestAnimationFrame(draw);
      return;
    }
    if(state.job){
      const from=state.job.from, to=state.job.to;
      const f=from?slotPosition(from):[-8,.43,1.65], t=to?slotPosition(to):[-8,.43,1.65];
      tag([f[0],f[1]-.05,f[2]],from?address(from):'PICKUP','#70bbff');
      tag([t[0],t[1]-.05,t[2]],to?address(to):'OUTFEED','#73edc7');
    }
    for(const item of state.inventory){
      const active=state.job?.id===item.id;
      const motion=active?state.job.motion:null;
      if(!motion&&(state.offRack?.has(item.id)||active&&state.job.offRack))continue;
      const [x,y,z]=motion?[motion.x,motion.y,motion.z]:slotPosition(item.slot);
      tag([x,y+.91,z],item.id,active||item.id==='123'&&!state.job?'#ffca79':'#dce8f5');
    }
    if(state.storage&&(state.infeed||state.job?.motion)){
      const load=state.job?.motion??{x:-8,y:.43,z:1.65};
      tag([load.x,load.y+.91,load.z],state.job.id,'#ffca79');
    }
    for(const side of ['L','R']){
      const z=side==='L'?-2.03:2.03;
      for(let level=1;level<=2;level++)tag([-7.45,.43+(level-1)*1.75,z],side+' · L0'+level,'#d1e0ef',true);
    }
    for(let bin=1;bin<=7;bin++)tag([bin*2-8,.01,.85],'B0'+bin,'#caddf1',true);
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
export const sameSlot=(a,b)=>a.bay===b.bay&&a.level===b.level&&a.side===b.side;

export function mountConveyor(stage){
  const canvas=document.createElement('canvas');
  canvas.className='scene-conveyor-canvas';
  canvas.tabIndex=0;
  canvas.setAttribute('aria-label',stage.getAttribute('aria-label')+'. Drag or use arrow keys to rotate. Use plus and minus to zoom.');
  stage.removeAttribute('role');
  stage.removeAttribute('aria-label');
  const controls=document.createElement('div');
  controls.className='view-controls';
  const view=document.createElement('button');
  view.type='button';
  controls.append(view);
  stage.prepend(canvas,controls);

  const zones=[...stage.querySelectorAll('.belt-zones span')].map(el=>[el.querySelector('b').textContent,el.lastChild.textContent]);
  const positions={load:-4.5,unload:-4.5,scale:0,pickup:4.5,lifted:4.5};
  const moving=new WeakMap();
  let activeLoads=[];
  warehouse(canvas,null,{controls,conveyor:{
    build(box,pallet){
      for(const center of [-4.5,0,4.5]){
        for(const leg of [-1.9,1.9]){
          for(const z of [-1.04,1.04])box(center+leg,0,z,.16,.8,.16,'647b91');
          box(center+leg,.24,0,.11,.12,2.17,'50647a');
        }
        box(center,.76,0,4.36,.20,2.2,'40576a');
        for(let offset=-1.94;offset<=2;offset+=.32){
          box(center+offset,.945,0,.24,.09,1.95,'a4bbc7');
          box(center+offset-.055,1.031,0,.045,.012,1.93,'c5d5df');
        }
        for(const z of [-1.12,1.12])box(center,.87,z,4.37,.25,.14,'5f84a1');
      }
      for(const side of [-1,1]){
        const extended=stage.dataset.cylinder==='on';
        box(4.5,.68,side*1.53,.38,.34,.61,'85a6bf');
        const reach=extended?.70:.19;
        box(4.5,.86,side*(1.26-reach/2),.17,.12,reach,'8cddf7');
      }
      activeLoads=[];
      const now=performance.now();
      for(const node of stage.querySelectorAll('.belt-pallet')){
        const position=node.dataset.position;
        if(!Object.hasOwn(positions,position)){moving.delete(node);continue;}
        const targetX=positions[position],targetY=position==='lifted'?1.55:1.06;
        let state=moving.get(node);
        if(!state){
          state={x:targetX,y:targetY,fromX:targetX,fromY:targetY,targetX,targetY,started:now};
          moving.set(node,state);
        }
        if(state.targetX!==targetX||state.targetY!==targetY){
          Object.assign(state,{fromX:state.x,fromY:state.y,targetX,targetY,started:now});
        }
        const time=Math.min(1,(now-state.started)/(targetX===state.fromX?430:850));
        const progress=time*time*(3-2*time);
        state.x=state.fromX+(targetX-state.fromX)*progress;
        state.y=state.fromY+(targetY-state.fromY)*progress;
        pallet(state.x,state.y,0,true);
        activeLoads.push({x:state.x,y:state.y,id:node.textContent,rejected:node.classList.contains('rejected')});
      }
    },
    label(tag){
      for(const load of activeLoads)if(load.id)tag([load.x,load.y+.9,0],load.id,load.rejected?'#ff928d':'#ffca79');
      zones.forEach(([number,name],i)=>tag([(i-1)*4.5,.25,1.48],number+' · '+name,'#caddf1',true));
    }
  }});
}
