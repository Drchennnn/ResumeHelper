const nameInput=document.querySelector('#trusted-name');
const gender=document.querySelector('#visual-gender');
const menu=document.querySelector('#gender-menu');
const evidence={untrustedRejected:0,trustedTextInputs:0,trustedPickerOpens:0,trustedChoices:0,submitted:false};
function render(){document.querySelector('#result').textContent=JSON.stringify({...evidence,nameFilled:Boolean(nameInput.value),genderValue:gender.getAttribute('aria-valuetext')||''},null,2);}
nameInput.addEventListener('input',event=>{if(!event.isTrusted){nameInput.value='';evidence.untrustedRejected++;}else evidence.trustedTextInputs++;render();});
gender.addEventListener('click',event=>{if(!event.isTrusted){evidence.untrustedRejected++;render();return;}evidence.trustedPickerOpens++;menu.hidden=false;render();});
for(const [index,option] of [...menu.querySelectorAll('[role=option]')].entries())option.addEventListener('click',event=>{if(!event.isTrusted){evidence.untrustedRejected++;render();return;}const value=index===0?'男':'女';gender.setAttribute('aria-valuetext',value);gender.textContent=value;menu.hidden=true;evidence.trustedChoices++;render();});
document.querySelector('#danger').onclick=event=>{event.preventDefault();evidence.submitted=true;render();};
render();
