import {createResume,normalizeResume} from './model.js';
const PROFILE='personalResumeProfilesV1',SETTINGS='personalResumeSettingsV1',LEGACY='personalResumeWorkbenchV1';
async function get(key){return globalThis.chrome?.storage?.local?(await chrome.storage.local.get(key))[key]:JSON.parse(localStorage.getItem(key)||'null');}
async function put(key,value){if(globalThis.chrome?.storage?.local)await chrome.storage.local.set({[key]:value});else localStorage.setItem(key,JSON.stringify(value));}
async function readState(){let profile=await get(PROFILE);let settings=await get(SETTINGS);if(!profile){const old=await get(LEGACY);profile=old?{resumes:old.resumes,activeId:old.activeId}:{resumes:[createResume()]};if(!settings&&old?.settings){settings=old.settings;await put(SETTINGS,settings);}profile.activeId||=profile.resumes[0]?.id;await put(PROFILE,profile);}const resumes=(profile.resumes||[]).map(normalizeResume);if(!resumes.length)resumes.push(createResume());const activeId=resumes.some(r=>r.id===profile.activeId)?profile.activeId:resumes[0].id;return {resumes,activeId,settings:settings||{baseUrl:'',model:'',apiKey:'',temperature:0}};}
export async function saveResumes(resumes,activeId){await put(PROFILE,{resumes:resumes.map(normalizeResume),activeId});}
export async function saveSettings(settings){await put(SETTINGS,{baseUrl:settings.baseUrl,model:settings.model,apiKey:settings.apiKey,temperature:0});}

export async function loadState(){return globalThis.navigator?.locks?.request? navigator.locks.request("personal-resume-init",readState):readState();}
