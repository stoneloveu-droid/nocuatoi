// ── ui-utils.js ──────────────────────────────────────────────
// DOM helpers, format inputs, toast, confirmAction, modals,
// theme/accent, month picker, sync badge
// Không import state — nhận dữ liệu qua tham số hoặc từ window.*
// ─────────────────────────────────────────────────────────────

import { fmt, fmtNoUnit, getML } from "./calc.js";

// ── FORMAT INPUT ──────────────────────────────────────────────
export function fmtInput(el){
  const raw=el.value.replace(/\./g,'').replace(/[^0-9]/g,'');
  const num=parseInt(raw)||0;
  el.value=num?fmtNoUnit(num):'';
  el.dataset.raw=String(num);
}
export function getInputVal(id){
  const el=document.getElementById(id);
  if(!el) return 0;
  if(el.dataset.raw!==undefined&&el.dataset.raw!=='') return Number(el.dataset.raw);
  return Number(el.value.replace(/\./g,''))||0;
}
export function setInputFmt(id,val){
  const el=document.getElementById(id);if(!el)return;
  const n=Math.round(Number(val)||0);
  el.value=n?fmtNoUnit(n):'';
  el.dataset.raw=String(n);
}
// Expose cho oninput/onchange trong HTML
window.fmtInput = fmtInput;

// ── TOAST ─────────────────────────────────────────────────────
export function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2200);
}

// ── CONFIRM ACTION ────────────────────────────────────────────
export function confirmAction(msg, onOk){
  const overlay=document.createElement('div');
  overlay.style='position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(14px);z-index:500;display:flex;align-items:flex-end;justify-content:center';
  overlay.innerHTML=`<div style="background:var(--card2);border:1px solid var(--border);border-radius:28px 28px 0 0;width:100%;max-width:430px;padding:24px 20px calc(env(safe-area-inset-bottom,0px)+24px)">
    <div style="font-size:15px;font-weight:800;text-align:center;margin-bottom:18px">${msg}</div>
    <div style="display:flex;gap:10px">
      <button id="ca-cancel" style="flex:1;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--card);color:var(--sub);font-family:'Mulish',sans-serif;font-size:14px;font-weight:800;cursor:pointer">Huỷ</button>
      <button id="ca-ok" style="flex:2;padding:14px;border:none;border-radius:14px;background:var(--red);color:#fff;font-family:'Mulish',sans-serif;font-size:14px;font-weight:800;cursor:pointer">Xác nhận</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#ca-cancel').onclick=()=>overlay.remove();
  overlay.querySelector('#ca-ok').onclick=()=>{overlay.remove();onOk();};
}

// ── MODAL ─────────────────────────────────────────────────────
window.closeModal=id=>document.getElementById(id)?.classList.remove('open');
window.closeMBg=(id,e)=>{if(e.target===document.getElementById(id)) window.closeModal(id);};

// ── SYNC BADGE ────────────────────────────────────────────────
export function setSyncBadge(cls,txt){
  const badge=document.getElementById('sync-badge');
  const dot=document.getElementById('sync-dot');
  if(!dot) return;
  dot.className='sync-dot'+' '+cls;
  if(badge) badge.title=txt;
}

// ── THEME ─────────────────────────────────────────────────────
let currentTheme='dark';

export function initTheme(){
  const saved=localStorage.getItem('vn_theme')||'dark';
  setTheme(saved);
}
export function setTheme(t){
  currentTheme=t;
  const attr=t==='dark'?'':t;
  document.documentElement.setAttribute('data-theme',attr);
  localStorage.setItem('vn_theme',t);
  const tog=document.getElementById('dark-mode-toggle');
  if(tog) tog.checked=(t==='dark'||t==='amoled');
}
export function getCurrentTheme(){ return currentTheme; }
window.setTheme=setTheme;
window.toggleDarkMode=function(on){
  setTheme(on?'dark':'light');
};

// ── ACCENT ────────────────────────────────────────────────────
const ACCENTS={
  lime:   {accent:'#C8FF57',dark:'#0F0F14'},
  blue:   {accent:'#57C8FF',dark:'#0F0F14'},
  green:  {accent:'#4CAF50',dark:'#fff'},
  orange: {accent:'#FF9800',dark:'#0F0F14'},
  purple: {accent:'#C57BFF',dark:'#0F0F14'},
};
window.setAccent=function(name){
  const a=ACCENTS[name];if(!a)return;
  document.documentElement.style.setProperty('--accent',a.accent);
  localStorage.setItem('vn_accent',name);
  const sub=document.getElementById('theme-sub');
  const labels={lime:'Lime',blue:'Xanh',green:'Lá',orange:'Cam',purple:'Tím'};
  if(sub) sub.textContent=labels[name]||name;
  document.querySelectorAll('.tp-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tp-'+name)?.classList.add('active');
  window.closeModal('modal-theme');
};
export function initAccent(){
  const saved=localStorage.getItem('vn_accent')||'lime';
  window.setAccent(saved);
}

// ── MONTH PICKER ──────────────────────────────────────────────
let pickerYear=new Date().getFullYear();
Object.defineProperty(window,'pickerYear',{get(){return pickerYear;},set(v){pickerYear=v;}});

// onPickMonth được set từ app.js để tránh circular dependency
let _onPickMonth=null;
export function setOnPickMonth(fn){ _onPickMonth=fn; }

window.openMonthPicker=function(currentMonth){
  pickerYear=parseInt(currentMonth.split('-')[0]);
  renderMonthPickerInternal(currentMonth);
  document.getElementById('modal-month').classList.add('open');
};
window.renderMonthPicker=function(){
  // currentMonth được truyền từ app qua window.currentMonthForPicker
  renderMonthPickerInternal(window.currentMonthForPicker||'');
};
function renderMonthPickerInternal(currentMonth){
  const yr=pickerYear;
  document.getElementById('mp-title').textContent=`Chọn tháng — ${yr}`;
  const grid=document.getElementById('mp-grid');grid.innerHTML='';
  const nav=document.createElement('div');
  nav.style='grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;margin-bottom:4px';
  nav.innerHTML=`<button onclick="window.pickerYear--;window.renderMonthPicker()" style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:7px 16px;color:var(--text);font-family:'Mulish',sans-serif;font-size:13px;font-weight:800;cursor:pointer">◀ ${yr-1}</button>
    <span style="font-size:13px;font-weight:900">${yr}</span>
    <button onclick="window.pickerYear++;window.renderMonthPicker()" style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:7px 16px;color:var(--text);font-family:'Mulish',sans-serif;font-size:13px;font-weight:800;cursor:pointer">${yr+1} ▶</button>`;
  grid.appendChild(nav);
  for(let m=1;m<=12;m++){
    const key=`${yr}-${String(m).padStart(2,'0')}`;
    const b=document.createElement('div');
    b.className='mpbtn'+(key===currentMonth?' active':'');
    b.textContent=`T${m}`;
    b.onclick=()=>{
      window.closeModal('modal-month');
      if(_onPickMonth) _onPickMonth(key);
    };
    grid.appendChild(b);
  }
}
