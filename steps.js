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
    observe(detail,signal){
      if(trace.checked)return pause(traceButton,detail,signal);
    },
  };
}
