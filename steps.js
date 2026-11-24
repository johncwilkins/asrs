export function systemSteps(){
  const toggle=document.getElementById('step-demo');
  const queues=new Map([...document.querySelectorAll('[data-system-step]')].map(button=>[button,[]]));
  function render(button){
    button.hidden=!queues.get(button).length;
    button.closest('.interface')?.classList.toggle('next-interface',!button.hidden);
  }
  function resume(){
    for(const [button,queue] of queues){
      for(const resolve of queue.splice(0))resolve();
      render(button);
    }
  }
  for(const [button,queue] of queues)button.addEventListener('click',()=>{
    queue.shift()?.();
    render(button);
  });
  toggle.addEventListener('change',()=>{if(!toggle.checked)resume();});
  return {resume,pause(id){
    if(!toggle.checked)return;
    const button=document.getElementById(id);
    return new Promise(resolve=>{queues.get(button).push(resolve);render(button);});
  }};
}
