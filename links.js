const layer=document.createElement('div');
layer.className='signal-layer';
layer.setAttribute('aria-hidden','true');
layer.innerHTML='<svg><defs><marker id="signal-tip" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z"></path></marker></defs><path class="signal-path" marker-end="url(#signal-tip)"></path></svg><span></span>';
document.body.append(layer);
let current, timer;
const svg=layer.querySelector('svg'), path=layer.querySelector('.signal-path'), label=layer.querySelector('span');
function draw(){
  if(!current)return;
  const {from,to}=current;
  const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();
  const down=b.top>a.top, x=a.left+a.width/2, y=down?a.bottom:a.top;
  const u=b.left+b.width/2, v=down?b.top+4:b.bottom-4;
  const horizontal=Math.abs(b.top-a.top)<30;
  const start=horizontal?[a.right-7,a.top+a.height*.6]:[x,y];
  const end=horizontal?[b.left+8,b.top+b.height*.65]:[u,v];
  const middle=(start[1]+end[1])/2;
  svg.setAttribute('viewBox','0 0 '+innerWidth+' '+innerHeight);
  path.setAttribute('d',horizontal?'M '+start.join(' ')+' L '+end.join(' '):'M '+start.join(' ')+' C '+start[0]+' '+middle+' '+end[0]+' '+middle+' '+end.join(' '));
  label.style.left=Math.max(95,Math.min(innerWidth-95,(start[0]+end[0])/2))+'px';
  label.style.top=Math.max(22,Math.min(innerHeight-22,middle))+'px';
}
export function arrow(from,to,message,returning=false){
  from=document.querySelector(from);to=document.querySelector(to);
  if(!from||!to)return;
  clearTimeout(timer);
  current={from,to};
  label.textContent=message;
  layer.dataset.direction=returning?'return':'send';
  layer.classList.add('visible');
  draw();
  timer=setTimeout(clearArrow,1550);
}
export function clearArrow(){
  clearTimeout(timer);
  current=null;
  layer.classList.remove('visible');
}
addEventListener('resize',draw);
addEventListener('scroll',draw,{passive:true});
export function wait(ms,signal){
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(signal.reason);return;}
    const stop=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);
    signal.addEventListener('abort',stop,{once:true});
  });
}
