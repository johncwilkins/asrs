import {arrow} from './links.js';

const feedbackRoutes={
  database:{from:'.inventory',to:'.backend .interface:has(#db-exchange)',name:'Database'},
  conveyor:{from:'.conveyor',to:'.backend .interface:has(#conveyor-feedback)',name:'Conveyor PLC'},
  carriage:{from:'.carriage',to:'.backend .interface:has(#plc-feedback)',name:'Carriage PLC'},
};

export function systemSteps(){
  const toggle=document.getElementById('step-demo');
  const trace=document.getElementById('trace-demo');
  const traceButton=document.getElementById('step-feedback');
  const message=document.getElementById('trace-message');
  const queues=new Map([...document.querySelectorAll('[data-system-step]')].map(button=>[button,[]]));

  function render(button){
    const next=queues.get(button)[0];
    button.hidden=!next;
    const panel=button.closest('.interface');
    if(panel)panel.classList.toggle('next-interface',!!panel.querySelector('[data-system-step]:not([hidden])'));
    if(button===traceButton){message.hidden=!next;message.textContent=next?.detail??'';}
  }
  function drain(button){
    const queue=queues.get(button);
    for(const {resolve} of queue.splice(0))resolve();
    render(button);
  }
  function resume(){for(const button of queues.keys())drain(button);}
  for(const [button,queue] of queues)button.addEventListener('click',()=>{
    queue.shift()?.resolve();
    render(button);
  });
  function releaseDisabled(){
    if(!trace.checked){drain(traceButton);drain(document.getElementById('step-lookup'));}
    if(!toggle.checked&&!trace.checked)resume();
  }
  toggle.addEventListener('change',releaseDisabled);
  trace.addEventListener('change',releaseDisabled);
  function pause(button,detail,signal){
    return new Promise(resolve=>{queues.get(button).push({resolve,detail});render(button);})
      .then(()=>signal?.throwIfAborted());
  }
  return {
    resume,
    pause(id){
      if(toggle.checked||trace.checked)return pause(document.getElementById(id));
    },
    lookup(signal){
      if(trace.checked)return pause(document.getElementById('step-lookup'),null,signal);
    },
    async observe(source,detail,signal,label=detail){
      signal?.throwIfAborted();
      const route=feedbackRoutes[source];
      const viewing=arrow(route.from,route.to,label,true);
      const confirmation=trace.checked?pause(traceButton,route.name+' → Ignition · '+detail,signal):undefined;
      await Promise.all([viewing,confirmation]);
      signal?.throwIfAborted();
    },
  };
}
