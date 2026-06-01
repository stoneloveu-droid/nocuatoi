import { auth, db, doc, onSnapshot, setDoc, GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut }
  from "./firebase.js";
import { fmt, fmtNoUnit, getML, tcCalc, tcBalance, tcGetMonthly, tcGetDebt }
  from "./calc.js";


// ── DOM HELPERS (tách khỏi calc.js — không export) ───────────
function fmtInput(el){
  const raw=el.value.replace(/\./g,'').replace(/[^0-9]/g,'');
  const num=parseInt(raw)||0;
  el.value=num?fmtNoUnit(num):'';
  el.dataset.raw=String(num);
}
function getInputVal(id){
  const el=document.getElementById(id);
  if(!el) return 0;
  if(el.dataset.raw!==undefined&&el.dataset.raw!=='') return Number(el.dataset.raw);
  return Number(el.value.replace(/\./g,''))||0;
}
function setInputFmt(id,val){
  const el=document.getElementById(id);if(!el)return;
  const n=Math.round(Number(val)||0);
  el.value=n?fmtNoUnit(n):'';
  el.dataset.raw=String(n);
}
// Expose cho oninput/onchange trong HTML
window.fmtInput = fmtInput;

// ── DEFAULTS ─────────────────────────────────────────────────
const DEF_DEBTS = [
  {id:'tp',      name:'TP Bank',    type:'td', limit:20000000,  used:12000000,  monthly:216000,  note:'1.80%/th', payDay:15, settleFee:0},
  {id:'ocb',     name:'OCB Bank',   type:'td', limit:50000000,  used:36300000,  monthly:834900,  note:'2.30%/th', payDay:20, settleFee:0},
  {id:'vp-td',   name:'VP Bank TD', type:'td', limit:60000000,  used:40500000,  monthly:202500,  note:'0.50%/th', payDay:10, settleFee:0},
  {id:'shin-td', name:'Shinhan TD', type:'td', limit:40000000,  used:24500000,  monthly:318500,  note:'1.30%/th', payDay:25, settleFee:0},
  {id:'vp-tc',   name:'VP Bank TC', type:'tc', principal:30000000, disburseDate:'2023-04-01', rate:1.5, totalTerm:35, curTerm:13, payDay:5,  note:''},
  {id:'shin-tc', name:'Shinhan TC', type:'tc', principal:50000000, disburseDate:'2021-07-01', rate:1.2, totalTerm:60, curTerm:46, payDay:8,  note:''},
  {id:'hsbc',    name:'HSBC Bank',  type:'tc', principal:55000000, disburseDate:'2021-04-01', rate:1.3, totalTerm:60, curTerm:49, payDay:12, note:''},
  {id:'vib1',    name:'VIB Bank 1', type:'tc', principal:60000000, disburseDate:'2021-07-01', rate:1.4, totalTerm:60, curTerm:46, payDay:15, note:''},
  {id:'vib2',    name:'VIB Bank 2', type:'tc', principal:35000000, disburseDate:'2023-06-01', rate:1.6, totalTerm:36, curTerm:11, payDay:20, note:''},
];
const DEF_INCOME  = [{id:'sal',    name:'Lương cơ bản',         amount:12000000, note:'Hàng tháng'}];
const DEF_EXPENSE = [{id:'living', name:'Sinh hoạt / gia đình', amount:8200000,  note:'Cố định'}];
const SUGGEST_IN  = ['Thưởng','Freelance','Bán đồ','Hoàn tiền','Thu nợ','Lãi tiết kiệm','Quà tặng','Khác'];
const SUGGEST_OUT = ['Ăn uống','Di chuyển','Mua sắm','Y tế','Sửa chữa','Giải trí','Học phí','Điện nước','Khác'];

// ── STATE ─────────────────────────────────────────────────────
let debts=[], income=[], expense=[], ticks={};
let txns={}, savings=[], walletBase=0, lastAutoMonth='';
let currentMonth='', currentFilter='all', openDetail=null;
let editDebtId=null, editFinId=null, finMode='income';
let editTxnId=null, txnType='out';
let uid=null, unsubSnap=null;
let currentTheme='dark';
// Flag chặn onSnapshot re-render khi chính mình vừa save
let isSavingToFirestore=false;

function clone(x){return JSON.parse(JSON.stringify(x));}
function initMonth(){
  const n=new Date();
  currentMonth=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
}

// ── FIRESTORE ─────────────────────────────────────────────────
function userDoc(){return doc(db,'users',uid);}

function startRealtimeSync(){
  if(unsubSnap) unsubSnap();
  unsubSnap = onSnapshot(userDoc(), (snap)=>{
    if(isSavingToFirestore) return; // bỏ qua echo từ chính mình
    if(!snap.exists()){
      debts=clone(DEF_DEBTS); income=clone(DEF_INCOME); expense=clone(DEF_EXPENSE);
      ticks={}; txns={}; savings=[]; walletBase=0; lastAutoMonth='';
      saveToFirestore();
      return;
    }
    const d=snap.data();
    debts         = d.debts         || clone(DEF_DEBTS);
    income        = d.income        || clone(DEF_INCOME);
    expense       = d.expense       || clone(DEF_EXPENSE);
    ticks         = d.ticks         || {};
    txns          = d.txns          || {};
    savings       = d.savings       || [];
    walletBase    = d.walletBase    || 0;
    lastAutoMonth = d.lastAutoMonth || '';
    migrateDebts();
    setSyncBadge('synced','Đã đồng bộ');
    renderAll();
  }, (e)=>{setSyncBadge('error','Mất kết nối');console.error(e);});
}

async function saveToFirestore(){
  if(!uid) return;
  isSavingToFirestore=true;
  setSyncBadge('syncing','Đang lưu…');
  try{
    await setDoc(userDoc(),{debts,income,expense,ticks,txns,savings,walletBase,lastAutoMonth},{merge:true});
    setSyncBadge('synced','Đã đồng bộ');
  }catch(e){setSyncBadge('error','Lỗi lưu');console.error(e);}
  finally{
    setTimeout(()=>{isSavingToFirestore=false;},1200);
  }
}

function setSyncBadge(cls,txt){
  const b=document.getElementById('sync-badge');
  if(b) b.className='sync-badge '+cls;
  const t=document.getElementById('sync-text');
  if(t) t.textContent=txt;
}

// ── MIGRATE dữ liệu cũ ────────────────────────────────────────
function migrateDebts(){
  debts.forEach(d=>{
    if(d.type==='tc'&&d.note&&!d.rate){
      const m=d.note.match(/^Kỳ\s*(\d+)\/(\d+)$/);
      if(m){d.curTerm=parseInt(m[1]);d.totalTerm=parseInt(m[2]);d.note='';}
    }
    if(d.type==='tc'&&!d.principal&&d.debt){d.principal=d.debt;}
    if(d.type==='td'&&!d.used&&d.debt){d.used=d.debt;d.limit=d.limit||d.debt*2;}
    if(d.type==='td'&&!d.monthly&&d.monthly!==0){d.monthly=d.used||0;}
  });
}

// ── AUTO-REDUCE chỉ chạy 1 lần / tháng ───────────────────────
function autoReduceDebts(){
  if(!currentMonth||lastAutoMonth===currentMonth) return;
  debts.forEach(d=>{
    if(d.settled) return;
    if(d.type==='tc'&&d.totalTerm){
      d.curTerm=Math.min((d.curTerm||0)+1, d.totalTerm);
      if(d.curTerm>=d.totalTerm) d.settled=true;
    }
  });
  lastAutoMonth=currentMonth;
  saveToFirestore();
}

// ── AUTH ──────────────────────────────────────────────────────
// FIX: KHÔNG dùng async/await cho signInWithPopup
// Browser chặn popup nếu gọi từ async context — phải gọi thẳng trong user gesture
window.signInGoogle=function(){
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  signInWithPopup(auth,provider).catch(e=>{
    console.error('Google sign-in:',e.code,e.message);
    if(e.code==='auth/popup-blocked'){
      showToast('⚠️ Popup bị chặn — cho phép popup từ trang này');
    } else if(e.code==='auth/popup-closed-by-user'||e.code==='auth/cancelled-popup-request'){
      // User tự đóng, không cần thông báo
    } else {
      showToast('⚠️ '+e.code);
    }
  });
};
window.signInAnon=function(){
  signInAnonymously(auth).catch(e=>{
    console.error('Anon sign-in:',e.code,e.message);
    showToast('⚠️ Lỗi kết nối: '+e.code);
  });
};
window.doSignOut=function(){
  confirmAction('Đăng xuất khỏi tài khoản?',async()=>{
    if(unsubSnap){unsubSnap();unsubSnap=null;}
    await signOut(auth);
  });
};

onAuthStateChanged(auth,async(user)=>{
  const overlay =document.getElementById('loading-overlay');
  const authPage=document.getElementById('auth-page');
  const bnav    =document.getElementById('bnav');
  if(user){
    uid=user.uid;
    const name =user.displayName||(user.isAnonymous?'Ẩn danh':'Người dùng');
    const email=user.email||(user.isAnonymous?'Không đăng nhập':'—');
    // Sync tất cả các element hiển thị tên/email
    ['acc-name','acc-name2'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=name;});
    ['acc-email','acc-email-sub'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=email;});
    // Avatar: hiển thị 2 chữ cái đầu nếu đăng nhập Google
    const _setAvatar=(id)=>{
      const el=document.getElementById(id);if(!el)return;
      if(!user.isAnonymous&&user.displayName){
        const ini=user.displayName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        el.dataset.initials=ini;el.classList.add('has-initials');el.textContent='';
      } else {
        el.textContent='👤';el.classList.remove('has-initials');delete el.dataset.initials;
      }
    };
    _setAvatar('sett-avatar-emoji');_setAvatar('sett-dd-avatar');
    authPage.classList.remove('active');
    bnav.style.display='flex';
    initMonth();
    setSyncBadge('syncing','Đang đồng bộ…');
    startRealtimeSync();
    overlay.classList.add('hidden');
    setTimeout(()=>overlay.style.display='none',500);
    switchPage('home');
  } else {
    uid=null;
    if(unsubSnap){unsubSnap();unsubSnap=null;}
    overlay.classList.add('hidden');
    setTimeout(()=>overlay.style.display='none',500);
    bnav.style.display='none';
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    authPage.classList.add('active');
  }
});

// ── THEME ─────────────────────────────────────────────────────
window.setTheme=function(t){
  currentTheme=t;
  document.documentElement.setAttribute('data-theme',t);
  localStorage.setItem('vn_theme',t);
  ['dark','light','amoled'].forEach(th=>{
    document.getElementById('tp-'+th)?.classList.toggle('active',th===t);
  });
  const names={dark:'Dark 🌑',light:'Light ☀️',amoled:'AMOLED ⚫'};
  const sub=document.getElementById('theme-sub');
  if(sub) sub.textContent=names[t]||t;
};
function initTheme(){
  const saved=localStorage.getItem('vn_theme')||'dark';
  setTheme(saved);
}

// ── RENDER ALL ────────────────────────────────────────────────
function renderAll(){
  autoReduceDebts();
  renderHome();
  renderPaid();
  renderTxnPage();
  renderSettings();
  renderTools();
}

// ── HOME ──────────────────────────────────────────────────────
function renderHome(){
  const n=new Date();
  const sd=document.getElementById('sub-date');
  if(sd) sd.textContent=n.toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'numeric'});
  const ml=document.getElementById('month-label');
  if(ml) ml.textContent=getML(currentMonth);

  const totalIncome =income.reduce((s,x)=>s+Number(x.amount),0);
  const totalExpense=expense.reduce((s,x)=>s+Number(x.amount),0);
  const totalDebtPay=debts.filter(d=>!d.settled).reduce((s,d)=>{
    return s+(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0));
  },0);

  const monthTxns=txns[currentMonth]||[];
  const txnIn =monthTxns.filter(t=>t.type==='in').reduce((s,t)=>s+Number(t.amount),0);
  const txnOut=monthTxns.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);
  const totalIn =totalIncome+txnIn;
  const totalOut=totalExpense+txnOut;
  const remain  =totalIn-totalOut-totalDebtPay;
  const totalDebtLeft=debts.filter(d=>!d.settled).reduce((s,d)=>{
    return s+(d.type==='tc'?tcGetDebt(d):Number(d.used||0));
  },0);

  const el=id=>document.getElementById(id);
  if(el('kpi-income'))   el('kpi-income').textContent=fmt(totalIn);
  if(el('kpi-expense'))  el('kpi-expense').textContent=fmt(totalOut);
  if(el('kpi-debt-pay')) el('kpi-debt-pay').textContent=fmt(totalDebtPay);
  if(el('kpi-remain')){
    el('kpi-remain').textContent=remain>=0?fmt(remain):'-'+fmt(Math.abs(remain));
    el('kpi-remain').style.color=remain>=0?'var(--purple)':'var(--red)';
  }
  if(el('kpi-debt-total')) el('kpi-debt-total').textContent=fmt(totalDebtLeft);
  const wallet=walletBase+txnIn-txnOut;
  if(el('kpi-wallet')){
    el('kpi-wallet').textContent=fmt(wallet);
    el('kpi-wallet').style.color=wallet>=0?'var(--blue)':'var(--red)';
  }

  if(totalIn>0){
    const ep=Math.min(totalOut/totalIn*100,100);
    const dp=Math.min(totalDebtPay/totalIn*100,Math.max(0,100-ep));
    const rp=Math.max(100-ep-dp,0);
    if(el('rb-expense')) el('rb-expense').style.width=ep+'%';
    if(el('rb-debt'))    el('rb-debt').style.width=dp+'%';
    if(el('rb-remain'))  el('rb-remain').style.width=rp+'%';
  }

  const ms=ticks[currentMonth]||{};
  const paidAmt=debts.filter(d=>!d.settled&&ms[d.id]).reduce((s,d)=>s+(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0)),0);
  const pct=totalDebtPay?Math.round(paidAmt/totalDebtPay*100):0;
  if(el('prog-fill')) el('prog-fill').style.width=pct+'%';
  if(el('prog-pct'))  el('prog-pct').textContent=pct+'%';
}

// ── PAID ──────────────────────────────────────────────────────
function renderPaid(){
  const pml=document.getElementById('paid-month-label');
  if(pml) pml.textContent=getML(currentMonth);
  const ps=document.getElementById('paid-subtitle');
  if(ps) ps.textContent=getML(currentMonth);

  const ms=ticks[currentMonth]||{};
  const activeDebts=debts.filter(d=>!d.settled);
  const totalPay=activeDebts.reduce((s,d)=>s+(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0)),0);
  const paidAmt =activeDebts.filter(d=>ms[d.id]).reduce((s,d)=>s+(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0)),0);

  const el=id=>document.getElementById(id);
  if(el('ps-total-debt')) el('ps-total-debt').textContent=fmt(totalPay);
  if(el('ps-paid'))       el('ps-paid').textContent=fmt(paidAmt);
  if(el('ps-unpaid'))     el('ps-unpaid').textContent=fmt(totalPay-paidAmt);
  renderCards();
}

function renderCards(){
  const list=document.getElementById('card-list');
  if(!list) return;
  list.innerHTML='';
  const ms=ticks[currentMonth]||{};
  let show=debts;
  if(currentFilter==='td')     show=debts.filter(d=>d.type==='td');
  if(currentFilter==='tc')     show=debts.filter(d=>d.type==='tc');
  if(currentFilter==='unpaid') show=debts.filter(d=>!ms[d.id]&&!d.settled);
  const td=show.filter(d=>d.type==='td');
  const tc=show.filter(d=>d.type==='tc');
  if(!show.length){list.innerHTML=`<div class="empty">✅ Tháng này xong rồi!</div>`;return;}
  if(td.length){addSec(list,'💳 Thẻ Tín Dụng');const w=lastWrap(list);td.forEach(d=>addCard(w,d,ms));}
  if(tc.length){addSec(list,'💰 Vay Tín Chấp'); const w=lastWrap(list);tc.forEach(d=>addCard(w,d,ms));}
  list.appendChild(Object.assign(document.createElement('div'),{style:'height:12px'}));
}

function addSec(list,txt){
  const h=document.createElement('div');h.className='slabel';h.textContent=txt;list.appendChild(h);
  const w=document.createElement('div');w.className='cards';list.appendChild(w);
}
function lastWrap(list){const ws=list.querySelectorAll('.cards');return ws[ws.length-1];}

function debtMeta(d){
  if(d.type==='tc'){
    const kStr=d.totalTerm?`Kỳ ${d.curTerm||0}/${d.totalTerm} · `:'';
    return `${kStr}Ngày ${d.payDay||'—'}`;
  }
  return `${d.note||''} · Ngày ${d.payDay||'—'}`;
}

function addCard(wrap,d,ms){
  const paid=!!ms[d.id], settled=!!d.settled;
  const monthly=d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0);
  const debt   =d.type==='tc'?tcGetDebt(d)   :Number(d.used||0);
  const pct    =d.type==='tc'&&d.totalTerm?Math.round((d.curTerm||0)/d.totalTerm*100):null;

  const div=document.createElement('div');
  div.className='dcard'+(paid?' paid':'')+(settled?' settled':'');
  div.id='dc-'+d.id;

  let detailHTML='';
  if(d.type==='td'){
    const limit      =Number(d.limit||0);
    const used       =Number(d.used||0);
    const avail      =Math.max(0,limit-used);
    const usedPct    =limit?Math.round(used/limit*100):0;
    const barColor   =usedPct>80?'var(--red)':usedPct>50?'var(--orange)':'var(--accent)';
    const settleFee  =Number(d.settleFee||0);
    detailHTML=`
      <div class="dd-inner">
        <div class="dd-i"><label>Hạn mức</label><p>${fmt(limit)}</p></div>
        <div class="dd-i"><label>Đã dùng</label><p style="color:var(--orange)">${fmt(used)}</p></div>
        <div class="dd-i"><label>Còn lại</label><p style="color:var(--accent)">${fmt(avail)}</p></div>
        <div class="dd-i"><label>Trả TT sớm</label><p>${settleFee?fmt(settleFee):'—'}</p></div>
        <div class="dd-i"><label>Trạng thái</label><p id="ds-${d.id}" style="color:${paid?'var(--accent)':'var(--orange)'}">${paid?'Đã TT ✓':'Chờ TT'}</p></div>
      </div>
      <div class="credit-bar-wrap">
        <div class="credit-bar-labels"><span>0%</span><span>${usedPct}% đã dùng</span><span>100%</span></div>
        <div class="credit-bar-track"><div class="credit-bar-fill" style="width:${usedPct}%;background:${barColor}"></div></div>
      </div>`;
  } else {
    const balance=tcGetDebt(d);
    const r=Number(d.rate||0)/100;
    const interestThisMonth=Math.round(balance*r);
    const principalThisMonth=Math.max(0,monthly-interestThisMonth);
    detailHTML=`
      <div class="dd-inner">
        <div class="dd-i"><label>Dư nợ còn lại</label><p>${fmt(balance)}</p></div>
        <div class="dd-i"><label>Kỳ</label><p>${pct!==null?`${d.curTerm||0}/${d.totalTerm} (${pct}%)`:'—'}</p></div>
        <div class="dd-i"><label>Lãi tháng này</label><p style="color:var(--orange)">${fmt(interestThisMonth)}</p></div>
        <div class="dd-i"><label>Gốc tháng này</label><p style="color:var(--green)">${fmt(principalThisMonth)}</p></div>
        <div class="dd-i"><label>Nợ gốc</label><p>${fmt(d.principal||0)}</p></div>
        <div class="dd-i"><label>Trạng thái</label><p id="ds-${d.id}" style="color:${settled?'var(--accent)':paid?'var(--accent)':'var(--orange)'}">${settled?'Tất toán ✓':paid?'Đã TT ✓':'Chờ TT'}</p></div>
      </div>`;
  }

  div.innerHTML=`
    <div class="dcard-top" onclick="tapTop('${d.id}')">
      <div class="d-dot ${paid?'ok':d.type}"></div>
      <div class="d-info">
        <div class="d-name">${d.name}${settled?' <span class="settled-label">Tất toán</span>':''}</div>
        <div class="d-meta">${debtMeta(d)}</div>
      </div>
      <div class="d-right">
        <div class="d-amt ${d.type}">${fmt(monthly)}</div>
        <div class="d-unit">/ tháng</div>
      </div>
      <button class="chk${paid?' checked':''}" id="cb-${d.id}"
        onclick="event.stopPropagation();tapCheck('${d.id}')">✓</button>
    </div>
    <div class="dcard-detail" id="dd-${d.id}">${detailHTML}</div>`;
  wrap.appendChild(div);
}

window.tapTop=function(id){
  const el=document.getElementById('dd-'+id);if(!el)return;
  if(openDetail&&openDetail!==id){const p=document.getElementById('dd-'+openDetail);if(p)p.classList.remove('open');}
  if(openDetail===id){el.classList.remove('open');openDetail=null;}
  else{el.classList.add('open');openDetail=id;}
};

window.tapCheck=async function(id){
  if(!ticks[currentMonth]) ticks[currentMonth]={};
  ticks[currentMonth][id]=!ticks[currentMonth][id];
  const paid=ticks[currentMonth][id];
  const d=debts.find(x=>x.id===id);
  const monthly=d?(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0)):0;

  const cb=document.getElementById('cb-'+id);
  const dc=document.getElementById('dc-'+id);
  const ds=document.getElementById('ds-'+id);
  const dot=dc?dc.querySelector('.d-dot'):null;
  if(cb) cb.className='chk'+(paid?' checked pop':'');
  if(dc) dc.className='dcard'+(paid?' paid':'')+(d?.settled?' settled':'');
  if(ds){ds.style.color=paid?'var(--accent)':'var(--orange)';ds.textContent=paid?'Đã TT ✓':'Chờ TT';}
  if(dot) dot.className='d-dot '+(paid?'ok':d?.type||'');
  setTimeout(()=>{const b=document.getElementById('cb-'+id);if(b)b.classList.remove('pop');},250);
  showToast(paid?`✓ ${d?.name} đã thanh toán`:`↩ ${d?.name} bỏ tick`);

  const totalPay=debts.filter(x=>!x.settled).reduce((s,x)=>s+(x.type==='tc'?tcGetMonthly(x):Number(x.monthly||0)),0);
  const paidAmt =debts.filter(x=>!x.settled&&ticks[currentMonth]?.[x.id]).reduce((s,x)=>s+(x.type==='tc'?tcGetMonthly(x):Number(x.monthly||0)),0);
  const pct=totalPay?Math.round(paidAmt/totalPay*100):0;
  const pf=document.getElementById('prog-fill');const pp=document.getElementById('prog-pct');
  if(pf) pf.style.width=pct+'%'; if(pp) pp.textContent=pct+'%';
  const ep=document.getElementById('ps-paid');const eu=document.getElementById('ps-unpaid');
  if(ep) ep.textContent=fmt(paidAmt); if(eu) eu.textContent=fmt(totalPay-paidAmt);

  if(currentFilter==='unpaid') setTimeout(()=>{openDetail=null;renderCards();},500);
  await saveToFirestore();
};

window.filterTab=function(f,el){
  currentFilter=f;openDetail=null;
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');renderCards();
};

// ── TXN PAGE ──────────────────────────────────────────────────
function renderTxnPage(){
  const el=id=>document.getElementById(id);
  if(el('txn-subtitle'))    el('txn-subtitle').textContent=getML(currentMonth);
  if(el('txn-month-label')) el('txn-month-label').textContent=getML(currentMonth);
  const monthTxns=txns[currentMonth]||[];
  const txnIn =monthTxns.filter(t=>t.type==='in').reduce((s,t)=>s+Number(t.amount),0);
  const txnOut=monthTxns.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);
  if(el('txn-kpi-in'))  el('txn-kpi-in').textContent=fmt(txnIn);
  if(el('txn-kpi-out')) el('txn-kpi-out').textContent=fmt(txnOut);
  const wi=el('wallet-base-input');
  if(wi){wi.value=walletBase?fmtNoUnit(walletBase):'';wi.dataset.raw=walletBase;}
  const list=el('txn-list');
  if(list){
    list.innerHTML='';
    if(!monthTxns.length){
      list.innerHTML=`<div class="empty" style="padding:24px 0">Chưa có giao dịch nào</div>`;
    } else {
      [...monthTxns].reverse().forEach(t=>{
        const row=document.createElement('div');row.className='txn-row';
        row.onclick=()=>openTxnEdit(t.id);
        row.innerHTML=`<div class="txn-dot ${t.type}"></div><div class="txn-name">${t.name}</div>
          <div class="txn-amt ${t.type}">${t.type==='in'?'+':'-'}${fmt(t.amount)}</div>`;
        list.appendChild(row);
      });
    }
  }
  renderSavingList();
}

window.openTxnModal=function(){
  editTxnId=null;
  document.getElementById('txn-name').value='';
  const ta=document.getElementById('txn-amount');ta.value='';ta.dataset.raw='';
  document.getElementById('txn-del').style.display='none';
  setTxnType('out');
  document.getElementById('modal-txn').classList.add('open');
  setTimeout(()=>document.getElementById('txn-amount').focus(),350);
};
function openTxnEdit(id){
  const t=(txns[currentMonth]||[]).find(x=>x.id===id);if(!t)return;
  editTxnId=id;
  document.getElementById('txn-name').value=t.name;
  setInputFmt('txn-amount',t.amount);
  document.getElementById('txn-del').style.display='block';
  setTxnType(t.type);
  document.getElementById('modal-txn').classList.add('open');
}
window.setTxnType=function(t){
  txnType=t;
  document.getElementById('tt-in') .className='tt-btn'+(t==='in'?' active-in':'');
  document.getElementById('tt-out').className='tt-btn'+(t==='out'?' active-out':'');
  renderChips();
};
function renderChips(){
  const list=txnType==='in'?SUGGEST_IN:SUGGEST_OUT;
  const wrap=document.getElementById('txn-chips');wrap.innerHTML='';
  list.forEach(s=>{
    const c=document.createElement('div');c.className='chip';c.textContent=s;
    c.onclick=()=>{
      document.getElementById('txn-name').value=s==='Khác'?'':s;
      wrap.querySelectorAll('.chip').forEach(x=>x.classList.remove('sel'));c.classList.add('sel');
      if(s!=='Khác') document.getElementById('txn-amount').focus();
      else document.getElementById('txn-name').focus();
    };
    wrap.appendChild(c);
  });
}
window.saveTxn=async function(){
  const name  =document.getElementById('txn-name').value.trim()||'Không tên';
  const amount=getInputVal('txn-amount');
  if(!amount){showToast('⚠️ Nhập số tiền');return;}
  if(!txns[currentMonth]) txns[currentMonth]=[];
  if(editTxnId){const t=txns[currentMonth].find(x=>x.id===editTxnId);if(t){t.name=name;t.amount=amount;t.type=txnType;}}
  else txns[currentMonth].push({id:'t'+Date.now(),name,amount,type:txnType});
  await saveToFirestore();closeModal('modal-txn');renderTxnPage();renderHome();
  showToast(txnType==='in'?`✓ +${fmt(amount)} Thu`:`✓ -${fmt(amount)} Chi`);
};
window.deleteTxn=function(){
  if(!editTxnId) return;
  confirmAction('Xoá giao dịch này?',async()=>{
    txns[currentMonth]=(txns[currentMonth]||[]).filter(x=>x.id!==editTxnId);
    await saveToFirestore();closeModal('modal-txn');renderTxnPage();renderHome();showToast('🗑 Đã xoá');
  });
};

// ── WALLET / SAVING ───────────────────────────────────────────
window.saveWalletBase=async function(){
  walletBase=getInputVal('wallet-base-input');
  await saveToFirestore();renderTxnPage();renderHome();showToast('✓ Đã lưu số dư');
};
window.openSavingModal=function(){
  document.getElementById('sv-name').value='';
  const sa=document.getElementById('sv-amount');sa.value='';sa.dataset.raw='';
  document.getElementById('modal-saving').classList.add('open');
  setTimeout(()=>document.getElementById('sv-amount').focus(),350);
};
window.saveSaving=async function(){
  const name  =document.getElementById('sv-name').value.trim()||'Tiết kiệm';
  const amount=getInputVal('sv-amount');
  if(!amount){showToast('⚠️ Nhập số tiền');return;}
  const date=new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'});
  savings.push({id:'sv'+Date.now(),name,amount,date});
  await saveToFirestore();closeModal('modal-saving');renderTxnPage();showToast(`✓ +${fmt(amount)}`);
};
window.deleteSaving=function(id){
  confirmAction('Xoá khoản tiết kiệm này?',async()=>{
    savings=savings.filter(x=>x.id!==id);
    await saveToFirestore();renderTxnPage();showToast('🗑 Đã xoá');
  });
};
function renderSavingList(){
  const el=document.getElementById('saving-hist');if(!el)return;
  el.innerHTML='';
  if(!savings.length){el.innerHTML=`<div style="padding:14px;text-align:center;color:var(--sub);font-size:12px;font-weight:700">Chưa có</div>`;return;}
  [...savings].reverse().forEach(s=>{
    const row=document.createElement('div');row.className='save-row';
    row.innerHTML=`<div class="save-row-left"><div class="save-row-name">${s.name}</div><div class="save-row-date">${s.date||''}</div></div>
      <div style="display:flex;align-items:center;gap:8px"><div class="save-row-amt">+${fmt(s.amount)}</div>
      <button class="s-del" onclick="deleteSaving('${s.id}')">✕</button></div>`;
    el.appendChild(row);
  });
  const total=savings.reduce((s,x)=>s+Number(x.amount),0);
  const st=document.getElementById('saving-total');if(st) st.textContent=fmt(total);
}

// ── TOOLS ─────────────────────────────────────────────────────
function renderTools(){renderSchedule();renderAnalyze();}
window.toggleTool=function(id){
  const body=document.getElementById('body-'+id);const arrow=document.getElementById('arr-'+id);if(!body)return;
  const isOpen=body.classList.contains('open');
  document.querySelectorAll('.tool-body').forEach(b=>b.classList.remove('open'));
  document.querySelectorAll('.tool-arrow').forEach(a=>a.classList.remove('open'));
  if(!isOpen){body.classList.add('open');arrow.classList.add('open');}
};
window.calcInterest=function(){
  const P=getInputVal('ti-principal');const r=Number(document.getElementById('ti-rate').value)/100||0;
  const n=Number(document.getElementById('ti-terms').value)||0;
  const res=document.getElementById('ti-result');
  if(!P||!r||!n){showToast('⚠️ Nhập đủ thông tin');return;}
  const monthly=P*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1);
  const total=monthly*n;const interest=total-P;
  res.className='tool-result show';
  res.innerHTML=`<div class="tr-row"><span class="tr-label">Trả mỗi tháng</span><span class="tr-val" style="color:var(--accent)">${fmt(monthly)}</span></div>
    <div class="tr-row"><span class="tr-label">Tổng trả ${n} kỳ</span><span class="tr-val">${fmt(total)}</span></div>
    <div class="tr-row"><span class="tr-label">Tổng tiền lãi</span><span class="tr-val" style="color:var(--red)">${fmt(interest)}</span></div>
    <div class="tr-row"><span class="tr-label">Vốn gốc</span><span class="tr-val">${fmt(P)}</span></div>`;
};
window.calcSaving=function(){
  const goal=getInputVal('sc-goal');const rYear=Number(document.getElementById('sc-rate').value)/100||0;
  const months=Number(document.getElementById('sc-months').value)||0;
  const res=document.getElementById('sc-result');
  if(!goal||!months){showToast('⚠️ Nhập đủ thông tin');return;}
  const r=rYear/12;
  const monthly=r>0?goal*r/(Math.pow(1+r,months)-1):goal/months;
  const totalDeposit=monthly*months;const interest=goal-totalDeposit;
  res.className='tool-result show';
  res.innerHTML=`<div class="tr-row"><span class="tr-label">Cần gửi mỗi tháng</span><span class="tr-val" style="color:var(--green)">${fmt(monthly)}</span></div>
    <div class="tr-row"><span class="tr-label">Tổng tiền gốc</span><span class="tr-val">${fmt(totalDeposit)}</span></div>
    <div class="tr-row"><span class="tr-label">Lãi kép tích lũy</span><span class="tr-val" style="color:var(--accent)">${fmt(interest)}</span></div>
    <div class="tr-row"><span class="tr-label">Mục tiêu</span><span class="tr-val" style="color:var(--green)">${fmt(goal)}</span></div>`;
};
function renderSchedule(){
  const el=document.getElementById('schedule-list');if(!el)return;el.innerHTML='';
  const today=new Date().getDate();
  const active=debts.filter(d=>!d.settled&&d.payDay);
  if(!active.length){el.innerHTML=`<div style="color:var(--sub);font-size:12px;font-weight:700;text-align:center;padding:16px 0">Chưa có ngày thanh toán</div>`;return;}
  [...active].sort((a,b)=>(a.payDay||0)-(b.payDay||0)).forEach(d=>{
    const row=document.createElement('div');row.className='sched-row';
    const isToday=d.payDay===today,isOverdue=d.payDay<today;
    const monthly=d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0);
    row.innerHTML=`<div class="sched-day${isToday?' today':isOverdue?' overdue':''}">${d.payDay}</div>
      <div><div class="sched-name">${d.name}</div>
      <div style="font-size:10px;font-weight:600;color:var(--sub)">${isToday?'🔴 Hôm nay':isOverdue?'Đã qua':'Sắp tới'}</div></div>
      <div class="sched-amt">${fmt(monthly)}</div>`;
    el.appendChild(row);
  });
}
function renderAnalyze(){
  const el=document.getElementById('analyze-content');if(!el)return;
  const totalIncome  =income.reduce((s,x)=>s+Number(x.amount),0);
  const totalDebtPay =debts.filter(d=>!d.settled).reduce((s,d)=>s+(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0)),0);
  const totalExpense =expense.reduce((s,x)=>s+Number(x.amount),0);
  const totalDebtLeft=debts.filter(d=>!d.settled).reduce((s,d)=>s+(d.type==='tc'?tcGetDebt(d):Number(d.used||0)),0);
  const debtRatio   =totalIncome>0?Math.round(totalDebtPay/totalIncome*100):0;
  const expenseRatio=totalIncome>0?Math.round(totalExpense/totalIncome*100):0;
  const remainRatio =Math.max(0,100-debtRatio-expenseRatio);
  let score=100;
  if(debtRatio>50)score-=30;else if(debtRatio>35)score-=15;else if(debtRatio>20)score-=5;
  if(expenseRatio>60)score-=20;else if(expenseRatio>45)score-=10;
  const scoreColor=score>=80?'var(--accent)':score>=60?'var(--orange)':'var(--red)';
  const scoreLabel=score>=80?'Tốt 🟢':score>=60?'Cần cải thiện 🟡':'Rủi ro cao 🔴';
  let payoffItems='';
  debts.filter(d=>!d.settled&&d.type==='tc'&&d.totalTerm).sort((a,b)=>(a.totalTerm-(a.curTerm||0))-(b.totalTerm-(b.curTerm||0))).slice(0,3).forEach(d=>{
    const rem=d.totalTerm-(d.curTerm||0);const nd=new Date();nd.setMonth(nd.getMonth()+rem);
    payoffItems+=`<div class="analyze-item"><span class="analyze-key">${d.name}</span><span class="analyze-val" style="font-size:12px">${nd.toLocaleDateString('vi-VN',{month:'numeric',year:'numeric'})} (còn ${rem} kỳ)</span></div>`;
  });
  el.innerHTML=`<div class="analyze-score"><div class="analyze-score-num" style="color:${scoreColor}">${score}</div>
    <div class="analyze-score-label">Điểm sức khoẻ tài chính · ${scoreLabel}</div></div>
    <div class="analyze-item"><span class="analyze-key">Tỉ lệ nợ / thu nhập</span><span class="analyze-val" style="color:${debtRatio>40?'var(--red)':'var(--accent)'}">${debtRatio}%</span></div>
    <div class="analyze-item"><span class="analyze-key">Tỉ lệ chi phí / thu nhập</span><span class="analyze-val">${expenseRatio}%</span></div>
    <div class="analyze-item"><span class="analyze-key">Tỉ lệ tự do</span><span class="analyze-val" style="color:var(--purple)">${remainRatio}%</span></div>
    <div class="analyze-item"><span class="analyze-key">Tổng dư nợ còn lại</span><span class="analyze-val">${fmt(totalDebtLeft)}</span></div>
    ${payoffItems}
    <div class="analyze-tip">${debtRatio>50?'⚠️ Tỉ lệ nợ trên 50% — rủi ro cao. Ưu tiên trả nợ lãi suất cao nhất trước.':debtRatio>35?'💡 Tỉ lệ nợ khá cao. Hạn chế chi tiêu và tập trung trả nợ.':'✅ Tỉ lệ nợ ổn. Duy trì kỷ luật và tăng quỹ tiết kiệm.'}</div>`;
}

// ── SETTINGS ──────────────────────────────────────────────────
function renderSettings(){
  renderFinList('income');renderFinList('expense');
  renderDebtList('td');renderDebtList('tc');
  const activeCount=debts.filter(d=>!d.settled).length;
  const sub=document.getElementById('acc-debt-sub');
  if(sub) sub.textContent=`${activeCount} khoản đang hoạt động`;
  const wi=document.getElementById('wallet-base-input');
  if(wi){wi.value=walletBase?fmtNoUnit(walletBase):'';wi.dataset.raw=walletBase;}
  const wsub=document.getElementById('acc-wallet-sub');
  if(wsub){
    const mt=txns[currentMonth]||[];
    const i=mt.filter(t=>t.type==='in').reduce((s,t)=>s+Number(t.amount),0);
    const o=mt.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);
    wsub.textContent=`Hiện tại: ${fmt(walletBase+i-o)}`;
  }
  renderSavingList();
  setTheme(currentTheme);
}

window.toggleAcc=function(id){
  const body=document.getElementById('body-'+id);const arrow=document.getElementById('arr-'+id);if(!body)return;
  const isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);arrow.classList.toggle('open',!isOpen);
};

function renderFinList(mode){
  const items=mode==='income'?income:expense;
  const el=document.getElementById('list-'+mode);if(!el)return;
  if(!items.length){el.innerHTML=`<div style="padding:14px;text-align:center;color:var(--sub);font-size:12px;font-weight:700">Chưa có</div>`;return;}
  el.innerHTML='';
  items.forEach((it,i)=>{
    const row=document.createElement('div');row.className='srow';
    if(i<items.length-1) row.style.borderBottom='1px solid var(--border)';
    const ico=mode==='income'?'💵':'🧾';const bg=mode==='income'?'rgba(200,255,87,.1)':'rgba(255,87,87,.1)';
    row.innerHTML=`<div class="s-ico" style="background:${bg}">${ico}</div>
      <div class="s-info" onclick="openFinEdit('${mode}','${it.id}')">
        <div class="s-name">${it.name}</div>
        <div class="s-val fin-val">${fmt(it.amount)} <span style="font-weight:600;color:var(--sub)">${it.note||''}</span></div>
      </div><button class="s-del" onclick="confirmDelFin('${mode}','${it.id}')">✕</button>`;
    el.appendChild(row);
  });
}

function renderDebtList(type){
  const list=debts.filter(d=>d.type===type);
  const el=document.getElementById('list-'+type);if(!el)return;
  if(!list.length){el.innerHTML=`<div style="padding:14px;text-align:center;color:var(--sub);font-size:12px;font-weight:700">Chưa có</div>`;return;}
  el.innerHTML='';
  list.forEach((d,i)=>{
    const row=document.createElement('div');row.className='srow';
    if(i<list.length-1) row.style.borderBottom='1px solid var(--border)';
    const ico=type==='td'?'💳':'💰';const bg=type==='td'?'rgba(255,179,71,.1)':'rgba(87,200,255,.1)';
    const monthly=type==='tc'?tcGetMonthly(d):Number(d.monthly||0);
    const subText=type==='td'
      ?`${fmt(monthly)}/th · Đã dùng ${fmt(d.used||0)}/${fmt(d.limit||0)}`
      :`${fmt(monthly)}/th · Kỳ ${d.curTerm||0}/${d.totalTerm||0} · Dư: ${fmt(tcGetDebt(d))}`;
    row.innerHTML=`<div class="s-ico" style="background:${bg}">${ico}</div>
      <div class="s-info" onclick="openDebtEdit('${d.id}')">
        <div class="s-name">${d.name}${d.settled?' 🎉':''}</div>
        <div class="s-val">${subText}</div>
      </div><button class="s-del" onclick="confirmDelDebt('${d.id}')">✕</button>`;
    el.appendChild(row);
  });
}

// ── DEBT MODAL ────────────────────────────────────────────────
function toggleTcFields(type){
  document.getElementById('md-td-fields').style.display=type==='td'?'block':'none';
  document.getElementById('md-tc-fields').style.display=type==='tc'?'block':'none';
}
window.onDebtTypeChange=val=>toggleTcFields(val);

window.calcTcFields=function calcTcFields(){
  const P      =getInputVal('md-principal');
  const rate   =Number(document.getElementById('md-rate')?.value)||0;
  const total  =Number(document.getElementById('md-totalterm')?.value)||0;
  const paid   =Number(document.getElementById('md-curterm')?.value)||0;
  const preview=document.getElementById('tc-calc-preview');
  if(!P||!rate||!total){if(preview)preview.style.display='none';return;}
  const {monthly}=tcCalc(P,rate,total);
  const remain  =tcBalance(P,rate,total,paid);
  const r       =rate/100;
  const interest=Math.round(remain*r);
  const prinPart=Math.max(0,monthly-interest);
  if(preview){
    preview.style.display='block';
    document.getElementById('tc-calc-monthly').textContent=fmt(monthly);
    document.getElementById('tc-calc-remain').textContent =fmt(remain);
    document.getElementById('tc-calc-interest').textContent=fmt(interest);
    document.getElementById('tc-calc-principal').textContent=fmt(prinPart);
  }
};
window.calcTdFields=function calcTdFields(){
  const limit=getInputVal('md-limit');
  const used =getInputVal('md-used');
  if(!limit||!used) return;
  // Tự ước tính trả tối thiểu nếu chưa nhập (2% dư nợ, tối thiểu 50k)
  const monthly=document.getElementById('md-monthly-td');
  if(monthly&&(!monthly.dataset.raw||monthly.dataset.raw==='0')){
    const est=Math.max(50000,Math.round(used*0.02));
    setInputFmt('md-monthly-td',est);
  }
};

window.openDebtModal=function(type){
  editDebtId=null;
  document.getElementById('md-title').textContent=type==='td'?'Thêm thẻ tín dụng':'Thêm khoản vay';
  ['md-name','md-payday','md-limit','md-used','md-monthly-td','md-settle-fee','md-note-td',
   'md-principal','md-rate','md-totalterm','md-curterm','md-note-tc'].forEach(id=>{
    const e=document.getElementById(id);if(e){e.value='';delete e.dataset.raw;}
  });
  const dd=document.getElementById('md-disburse');if(dd) dd.value='';
  document.getElementById('md-type').value=type;
  document.getElementById('md-del').style.display='none';
  const prev=document.getElementById('tc-calc-preview');if(prev) prev.style.display='none';
  toggleTcFields(type);
  document.getElementById('modal-debt').classList.add('open');
  setTimeout(()=>document.getElementById('md-name').focus(),350);
};

window.openDebtEdit=function(id){
  const d=debts.find(x=>x.id===id);if(!d)return;
  editDebtId=id;
  document.getElementById('md-title').textContent='Chỉnh sửa';
  document.getElementById('md-name').value=d.name;
  document.getElementById('md-type').value=d.type;
  document.getElementById('md-payday').value=d.payDay||'';
  document.getElementById('md-del').style.display='block';
  if(d.type==='td'){
    setInputFmt('md-limit',d.limit||0);
    setInputFmt('md-used',d.used||0);
    setInputFmt('md-monthly-td',d.monthly||0);
    setInputFmt('md-settle-fee',d.settleFee||0);
    document.getElementById('md-note-td').value=d.note||'';
  } else {
    setInputFmt('md-principal',d.principal||0);
    document.getElementById('md-disburse').value=d.disburseDate||'';
    document.getElementById('md-rate').value=d.rate||'';
    document.getElementById('md-totalterm').value=d.totalTerm||'';
    document.getElementById('md-curterm').value=d.curTerm||'';
    document.getElementById('md-note-tc').value=d.note||'';
    setTimeout(window.calcTcFields,100);
  }
  toggleTcFields(d.type);
  document.getElementById('modal-debt').classList.add('open');
};
window.confirmDelDebt=id=>window.openDebtEdit(id);

window.saveDebt=async function(){
  const name   =document.getElementById('md-name').value.trim();
  const type   =document.getElementById('md-type').value;
  const payDay =Number(document.getElementById('md-payday').value)||0;
  if(!name){showToast('⚠️ Nhập tên');return;}
  let obj={name,type,payDay};
  if(type==='td'){
    const limit    =getInputVal('md-limit');
    const used     =getInputVal('md-used');
    const monthly  =getInputVal('md-monthly-td');
    const settleFee=getInputVal('md-settle-fee');
    const note     =document.getElementById('md-note-td').value.trim();
    if(!monthly){showToast('⚠️ Nhập trả tối thiểu/tháng');return;}
    obj={...obj,limit,used,monthly,settleFee,note};
  } else {
    const principal=getInputVal('md-principal');
    const rate     =Number(document.getElementById('md-rate').value)||0;
    const totalTerm=Number(document.getElementById('md-totalterm').value)||0;
    const curTerm  =Number(document.getElementById('md-curterm').value)||0;
    const disburseDate=document.getElementById('md-disburse').value||'';
    const note     =document.getElementById('md-note-tc').value.trim();
    if(!principal||!rate||!totalTerm){showToast('⚠️ Nhập đủ vốn gốc, lãi suất, số kỳ');return;}
    const settled=curTerm>=totalTerm&&totalTerm>0;
    obj={...obj,principal,rate,totalTerm,curTerm,disburseDate,note,settled};
  }
  if(editDebtId){const d=debts.find(x=>x.id===editDebtId);if(d) Object.assign(d,obj);}
  else debts.push({id:'d'+Date.now(),...obj});
  await saveToFirestore();closeModal('modal-debt');renderAll();
  showToast(editDebtId?'✓ Đã cập nhật':'✓ Đã thêm');
};
window.deleteDebt=function(){
  if(!editDebtId) return;
  confirmAction('Xoá khoản nợ này?',async()=>{
    debts=debts.filter(x=>x.id!==editDebtId);
    await saveToFirestore();closeModal('modal-debt');renderAll();showToast('🗑 Đã xoá');
  });
};

// ── FINANCE MODAL ─────────────────────────────────────────────
window.openFinModal=function(mode){
  finMode=mode;editFinId=null;
  document.getElementById('mf-title').textContent=mode==='income'?'Thêm thu nhập':'Thêm chi phí';
  document.getElementById('mf-name').value='';
  const ma=document.getElementById('mf-amount');ma.value='';delete ma.dataset.raw;
  document.getElementById('mf-note').value='';
  document.getElementById('mf-del').style.display='none';
  document.getElementById('modal-fin').classList.add('open');
  setTimeout(()=>document.getElementById('mf-name').focus(),350);
};
window.openFinEdit=function(mode,id){
  finMode=mode;
  const list=mode==='income'?income:expense;
  const it=list.find(x=>x.id===id);if(!it)return;
  editFinId=id;
  document.getElementById('mf-title').textContent=mode==='income'?'Chỉnh sửa thu nhập':'Chỉnh sửa chi phí';
  document.getElementById('mf-name').value=it.name;
  setInputFmt('mf-amount',it.amount);
  document.getElementById('mf-note').value=it.note||'';
  document.getElementById('mf-del').style.display='block';
  document.getElementById('modal-fin').classList.add('open');
};
window.confirmDelFin=(mode,id)=>window.openFinEdit(mode,id);
window.saveFin=async function(){
  const name  =document.getElementById('mf-name').value.trim();
  const amount=getInputVal('mf-amount');
  const note  =document.getElementById('mf-note').value.trim();
  if(!name){showToast('⚠️ Nhập tên');return;}
  if(!amount){showToast('⚠️ Nhập số tiền');return;}
  const list=finMode==='income'?income:expense;
  if(editFinId){const it=list.find(x=>x.id===editFinId);if(it){it.name=name;it.amount=amount;it.note=note;}}
  else list.push({id:'f'+Date.now(),name,amount,note});
  await saveToFirestore();closeModal('modal-fin');renderAll();showToast(editFinId?'✓ Cập nhật':'✓ Đã thêm');
};
window.deleteFin=function(){
  if(!editFinId) return;
  confirmAction('Xoá khoản này?',async()=>{
    if(finMode==='income') income=income.filter(x=>x.id!==editFinId);
    else expense=expense.filter(x=>x.id!==editFinId);
    await saveToFirestore();closeModal('modal-fin');renderAll();showToast('🗑 Đã xoá');
  });
};

// ── MONTH PICKER ──────────────────────────────────────────────
window.pickerYear = new Date().getFullYear();
window.openMonthPicker=function(){
  window.pickerYear=parseInt(currentMonth.split('-')[0]);
  renderMonthPicker();
  document.getElementById('modal-month').classList.add('open');
};
window.renderMonthPicker=renderMonthPicker;
function renderMonthPicker(){
  const yr=window.pickerYear;
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
    b.onclick=()=>{currentMonth=key;closeModal('modal-month');openDetail=null;renderAll();};
    grid.appendChild(b);
  }
}

// ── UTILS ─────────────────────────────────────────────────────
window.closeModal=id=>document.getElementById(id)?.classList.remove('open');
window.closeMBg=(id,e)=>{if(e.target===document.getElementById(id)) window.closeModal(id);};
window.switchPage=function(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+name)?.classList.add('active');
  document.getElementById('nav-'+name)?.classList.add('active');
  openDetail=null;
  if(name==='home')     renderHome();
  if(name==='paid')     renderPaid();
  if(name==='txn')      renderTxnPage();
  if(name==='tools')    renderTools();
  if(name==='settings') renderSettings();
};
window.resetAll=function(){
  confirmAction('Reset toàn bộ về mặc định? Không thể hoàn tác!',async()=>{
    debts=clone(DEF_DEBTS);income=clone(DEF_INCOME);expense=clone(DEF_EXPENSE);
    ticks={};txns={};savings=[];walletBase=0;lastAutoMonth='';
    await saveToFirestore();renderAll();showToast('✓ Đã reset');
  });
};
function showToast(msg){
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2200);
}
function confirmAction(msg, onOk){
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


// ── SETTINGS DROPDOWN ─────────────────────────────────────────
window.toggleSettMenu=function(){
  const menu=document.getElementById('sett-menu');
  const overlay=document.getElementById('sett-dd-overlay');
  const btn=document.getElementById('sett-more-btn');
  if(!menu) return;
  const isOpen=menu.classList.contains('open');
  menu.classList.toggle('open',!isOpen);
  if(overlay) overlay.classList.toggle('open',!isOpen);
  if(btn) btn.classList.toggle('active',!isOpen);
};
window.openThemeSheet=function(){
  // Close dropdown first, then open theme sheet
  const menu=document.getElementById('sett-menu');
  const overlay=document.getElementById('sett-dd-overlay');
  const btn=document.getElementById('sett-more-btn');
  if(menu) menu.classList.remove('open');
  if(overlay) overlay.classList.remove('open');
  if(btn) btn.classList.remove('active');
  setTimeout(()=>document.getElementById('modal-theme')?.classList.add('open'),80);
};
// ── INIT ──────────────────────────────────────────────────────
initMonth();
initTheme();
