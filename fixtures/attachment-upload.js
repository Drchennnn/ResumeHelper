const input = document.getElementById('resume-file');
const result = document.getElementById('result');
const evidence = {inputEvents: 0, changeEvents: 0, submitClicks: 0, selectedNames: []};
function update() {
  evidence.selectedNames = [...input.files].map(file => file.name);
  result.textContent = JSON.stringify(evidence);
  result.dataset.evidence = JSON.stringify(evidence);
}
input.addEventListener('input', () => { evidence.inputEvents++; update(); });
input.addEventListener('change', () => { evidence.changeEvents++; update(); });
document.getElementById('submit').addEventListener('click', () => { evidence.submitClicks++; update(); });
update();
