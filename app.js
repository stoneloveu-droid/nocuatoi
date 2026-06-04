// ── app.js ────────────────────────────────────────────────────
// State trung tâm, Firebase sync, auth, business logic,
// tất cả window.* event handlers
// ─────────────────────────────────────────────────────────────

import { auth, db, doc, onSnapshot, setDoc,
         GoogleAuthProvider, signInWithPopup, signInAnonymously,
         onAuthStateChanged, signOut } from "./firebase.js";
import { fmt, fmtNoUnit, getML,
         tcCurrentPayment, tcBalance, tcGetMonthly, tcGetDebt,
         tcTotalInterest, tcPaymentAtTerm, tcScheduleTable,
         migrateRate } from "./calc.js";
import { fmtInput, getInputVal, setInputFmt,
         showToast, confirmAction, setSyncBadge,
         initTheme, setTheme, getCurrentTheme, initAccent,
         setOnPickMonth } from "./ui-utils.js";
import { renderHome, renderPaid, renderCards, renderTxnPage,
         renderSavingList, renderSettings, renderTools,
         renderReport } from "./render.js";

// ── DEFAULTS ─────────────────────────────────────────────────
const DEF_DEBTS = [
  {id:'sample-td', name:'Thẻ mẫu', type:'td', limit:50000000, used:10000000, monthly:200000, note:'1.00%/th', payDay:15, settleFee:0},
  // FIX: rate đổi sang %/năm (1.2%/tháng × 12 = 14.4%/năm)
  {id:'sample-tc', name:'Vay mẫu', type:'tc', principal:30000000, rate:14.4, totalTerm:36, curTerm:6, payDay:10, note:''},
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
let walletHidden=false;
let showAllTxnsFlag=false;
let isSavingToFirestore=false;

function clone(x){return JSON.parse(JSON.stringify(x));}
function initMonth(){
  const n=new Date();
  currentMonth=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
}

// Cho ui-utils biết tháng hiện tại (month picker cần)
function syncMonthForPicker(){
  window.currentMonthForPicker=currentMonth;
}

// ── FIRESTORE ─────────────────────────────────────────────────
function userDoc(){return doc(db,'users',uid);}

function startRealtimeSync(){
  if(unsubSnap) unsubSnap();
  unsubSnap=onSnapshot(userDoc(),(snap)=>{
    if(isSavingToFirestore) return;
    if(!snap.exists()){
      debts=clone(DEF_DEBTS); income=clone(DEF_INCOME); expense=clone(DEF_EXPENSE);
      ticks={}; txns={}; savings=[]; walletBase=0; lastAutoMonth='';
      saveToFirestore();
      return;
    }
    const d=snap.data();
    debts         =d.debts         ||clone(DEF_DEBTS);
    income        =d.income        ||clone(DEF_INCOME);
    expense       =d.expense       ||clone(DEF_EXPENSE);
    ticks         =d.ticks         ||{};
    txns          =d.txns          ||{};
    savings       =d.savings       ||[];
    walletBase    =d.walletBase    ||0;
    lastAutoMonth =d.lastAutoMonth ||'';
    migrateDebts();
    setSyncBadge('synced','Đã đồng bộ');
    renderAll();
  },(e)=>{setSyncBadge('error','Mất kết nối');console.error(e);});
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

// ── MIGRATE ───────────────────────────────────────────────────
function migrateDebts(){
  debts.forEach(d=>{
    // FIX: gọi migrateRate để chuyển rate %/tháng → %/năm
    migrateRate(d);
    if(d.type==='tc'&&d.note&&!d.rate){
      const m=d.note.match(/^Kỳ\s*(\d+)\/(\d+)$/);
      if(m){d.curTerm=parseInt(m[1]);d.totalTerm=parseInt(m[2]);d.note='';}
    }
    if(d.type==='tc'&&!d.principal&&d.debt){d.principal=d.debt;}
    if(d.type==='td'&&!d.used&&d.debt){d.used=d.debt;d.limit=d.limit||d.debt*2;}
    if(d.type==='td'&&!d.monthly&&d.monthly!==0){d.monthly=d.used||0;}
  });
}

// ── AUTO-REDUCE ───────────────────────────────────────────────
function autoReduceDebts(){
  const realMonth=(()=>{const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;})();
  if(lastAutoMonth===realMonth) return;
  debts.forEach(d=>{
    if(d.settled) return;
    if(d.type==='tc'&&d.totalTerm){
      d.curTerm=Math.min((d.curTerm||0)+1,d.totalTerm);
      if(d.curTerm>=d.totalTerm) d.settled=true;
    }
  });
  lastAutoMonth=realMonth;
  saveToFirestore();
}

// ── AUTH ──────────────────────────────────────────────────────
window.signInGoogle=function(){
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  signInWithPopup(auth,provider).catch(e=>{
    console.error('Google sign-in:',e.code,e.message);
    if(e.code==='auth/popup-blocked'){
      showToast('⚠️ Popup bị chặn — cho phép popup từ trang này');
    } else if(e.code==='auth/popup-closed-by-user'||e.code==='auth/cancelled-popup-request'){
      // user tự đóng
    } else {
      showToast('⚠️ '+e.code);
    }
  });
};
window.signInAnon=function(){
  // UX FIX: cảnh báo mất dữ liệu khi dùng ẩn danh
  confirmAction(
    'Dữ liệu ẩn danh sẽ mất nếu xoá app hoặc đổi thiết bị. Tiếp tục không đăng nhập?',
    ()=>signInAnonymously(auth).catch(e=>{
      console.error('Anon sign-in:',e.code,e.message);
      showToast('⚠️ Lỗi kết nối: '+e.code);
    })
  );
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
    ['acc-name','acc-name2'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=name;});
    ['acc-email','acc-email-sub'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=email;});
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
    initMonth();syncMonthForPicker();
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

// ── RENDER ALL ────────────────────────────────────────────────
function getState(){
  return {debts,income,expense,ticks,txns,savings,walletBase,
          walletHidden,currentMonth,currentFilter,
          currentTheme:getCurrentTheme(),showAllTxnsFlag};
}

function renderAll(){
  autoReduceDebts();
  const s=getState();
  renderHome(s);
  renderPaid(s);
  renderTxnPage(s);
  renderSettings(s);
  renderTools(s);
  const rp=document.getElementById('page-report');
  if(rp&&rp.classList.contains('active')) renderReport(s);
}

// ── SWITCH PAGE ───────────────────────────────────────────────
window.switchPage=function(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+name)?.classList.add('active');
  document.getElementById('nav-'+name)?.classList.add('active');
  openDetail=null;showAllTxnsFlag=false;
  const s=getState();
  if(name==='home')     renderHome(s);
  if(name==='paid')     renderPaid(s);
  if(name==='txn')      renderTxnPage(s);
  if(name==='report')   renderReport(s);
  if(name==='settings') renderSettings(s);
  if(name==='debt')     renderSettings(s);
  if(name==='finance')  renderSettings(s);
  if(name==='tools')    renderTools(s);
};

// ── MONTH PICKER CALLBACK ─────────────────────────────────────
setOnPickMonth((key)=>{
  currentMonth=key;
  syncMonthForPicker();
  openDetail=null;
  renderAll();
});

// ── MONTH NAVIGATION ──────────────────────────────────────────
window.shiftMonth=function(delta){
  const [y,m]=currentMonth.split('-').map(Number);
  const d=new Date(y,m-1+delta,1);
  currentMonth=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  syncMonthForPicker();
  showAllTxnsFlag=false;
  renderAll();
};
window.openMonthPickerApp=function(){
  // delegate sang ui-utils với currentMonth hiện tại
  window.openMonthPicker(currentMonth);
};

// ── CARD INTERACTIONS ─────────────────────────────────────────
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

  if(currentFilter==='unpaid') setTimeout(()=>{openDetail=null;renderCards(getState());},500);
  await saveToFirestore();
};

window.filterTab=function(f,el){
  currentFilter=f; openDetail=null;
  document.querySelectorAll('.seg2-btn').forEach(b=>b.classList.remove('active'));
  if(el&&el.classList) el.classList.add('active');
  renderCards(getState());
};

// ── TXN ───────────────────────────────────────────────────────
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
// Expose cho render.js dùng
window._openTxnEdit=openTxnEdit;

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
  await saveToFirestore();window.closeModal('modal-txn');
  const s=getState();renderTxnPage(s);renderHome(s);
  showToast(txnType==='in'?`✓ +${fmt(amount)} Thu`:`✓ -${fmt(amount)} Chi`);
};
window.deleteTxn=function(){
  if(!editTxnId) return;
  confirmAction('Xoá giao dịch này?',async()=>{
    txns[currentMonth]=(txns[currentMonth]||[]).filter(x=>x.id!==editTxnId);
    await saveToFirestore();window.closeModal('modal-txn');
    const s=getState();renderTxnPage(s);renderHome(s);showToast('🗑 Đã xoá');
  });
};
window.openTxnModalType=function(type){
  window.openTxnModal();
  window.setTxnType(type);
};
window.openTxnSearch=()=>showToast('🔍 Tính năng đang phát triển');
window.openTxnFilter=()=>showToast('🔽 Tính năng đang phát triển');
window.showAllTxns=()=>{showAllTxnsFlag=true;renderTxnPage(getState());};

// ── WALLET / SAVING ───────────────────────────────────────────
window.saveWalletBase=async function(){
  walletBase=getInputVal('wallet-base-input');
  await saveToFirestore();
  const s=getState();renderTxnPage(s);renderHome(s);showToast('✓ Đã lưu số dư');
};
window.toggleWalletVis=function(){
  walletHidden=!walletHidden;
  const el=document.getElementById('kpi-wallet');
  if(!el) return;
  const monthTxns=txns[currentMonth]||[];
  const txnIn=monthTxns.filter(t=>t.type==='in').reduce((s,t)=>s+Number(t.amount),0);
  const txnOut=monthTxns.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);
  const wallet=walletBase+txnIn-txnOut;
  el.textContent=walletHidden?'••••••':fmt(wallet);
  const eye=document.getElementById('wallet-eye');
  if(eye) eye.style.opacity=walletHidden?'0.4':'1';
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
  await saveToFirestore();window.closeModal('modal-saving');renderTxnPage(getState());showToast(`✓ +${fmt(amount)}`);
};
window.deleteSaving=function(id){
  confirmAction('Xoá khoản tiết kiệm này?',async()=>{
    savings=savings.filter(x=>x.id!==id);
    await saveToFirestore();renderTxnPage(getState());showToast('🗑 Đã xoá');
  });
};

// ── DEBT MODAL ────────────────────────────────────────────────
function toggleTcFields(type){
  document.getElementById('md-td-fields').style.display=type==='td'?'block':'none';
  document.getElementById('md-tc-fields').style.display=type==='tc'?'block':'none';
}
window.onDebtTypeChange=val=>toggleTcFields(val);

window.calcTcFields=function(){
  const P    =getInputVal('md-principal');
  const rate =Number(document.getElementById('md-rate')?.value)||0;
  const total=Number(document.getElementById('md-totalterm')?.value)||0;
  const paid =Number(document.getElementById('md-curterm')?.value)||0;
  const preview=document.getElementById('tc-calc-preview');
  if(!P||!rate||!total){if(preview)preview.style.display='none';return;}

  // FIX 1: dùng method từ form, dùng tcCurrentPayment thay vì tcCalc (không tồn tại)
  const method=document.getElementById('md-method')?.value||'reducing_balance';
  const {monthly}=tcCurrentPayment({principal:P,rate,totalTerm:total,curTerm:paid,method});
  // FIX 2: truyền đủ 5 tham số cho tcBalance (thêm method)
  const remain=tcBalance(P,rate,total,method,paid);
  // Lãi tháng tới dùng tcCurrentPayment luôn (chính xác hơn công thức thủ công)
  const nextTerm=tcCurrentPayment({principal:P,rate,totalTerm:total,curTerm:paid,method});
  const interest=nextTerm.interest;
  const prinPart=nextTerm.principal;
  // FIX 6: tổng lãi còn lại — tính bằng cách cộng interest từng kỳ còn lại
  const remainingInterest=Array.from({length:total-paid},(_,i)=>
    tcPaymentAtTerm(P,rate,total,method,paid+1+i).interest
  ).reduce((a,b)=>a+b,0);

  if(preview){
    preview.style.display='block';
    document.getElementById('tc-calc-monthly').textContent=fmt(monthly);
    document.getElementById('tc-calc-remain').textContent =fmt(remain);
    document.getElementById('tc-calc-interest').textContent=fmt(interest);
    document.getElementById('tc-calc-principal').textContent=fmt(prinPart);
    document.getElementById('tc-calc-total-int').textContent=fmt(remainingInterest);
    document.getElementById('tc-calc-total-pay').textContent=fmt(monthly*(total-paid));
  }
};
window.calcTdFields=function(){
  const limit=getInputVal('md-limit');
  const used =getInputVal('md-used');
  if(!limit||!used) return;
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
    // Tooltip giải thích phương pháp tính lãi nếu có element
    const methodEl=document.getElementById('md-method');
    if(methodEl) methodEl.value=d.method||'reducing_balance';
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
    const principal =getInputVal('md-principal');
    const rate      =Number(document.getElementById('md-rate').value)||0;
    const totalTerm =Number(document.getElementById('md-totalterm').value)||0;
    const curTerm   =Number(document.getElementById('md-curterm').value)||0;
    const disburseDate=document.getElementById('md-disburse').value||'';
    const note      =document.getElementById('md-note-tc').value.trim();
    const method    =document.getElementById('md-method')?.value||'reducing_balance';
    if(!principal||!rate||!totalTerm){showToast('⚠️ Nhập đủ vốn gốc, lãi suất, số kỳ');return;}
    const settled=curTerm>=totalTerm&&totalTerm>0;
    obj={...obj,principal,rate,totalTerm,curTerm,disburseDate,note,method,settled};
  }
  if(editDebtId){const d=debts.find(x=>x.id===editDebtId);if(d) Object.assign(d,obj);}
  else debts.push({id:'d'+Date.now(),...obj});
  await saveToFirestore();window.closeModal('modal-debt');renderAll();
  showToast(editDebtId?'✓ Đã cập nhật':'✓ Đã thêm');
};
window.deleteDebt=function(){
  if(!editDebtId) return;
  confirmAction('Xoá khoản nợ này?',async()=>{
    debts=debts.filter(x=>x.id!==editDebtId);
    await saveToFirestore();window.closeModal('modal-debt');renderAll();showToast('🗑 Đã xoá');
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
  await saveToFirestore();window.closeModal('modal-fin');renderAll();showToast(editFinId?'✓ Cập nhật':'✓ Đã thêm');
};
window.deleteFin=function(){
  if(!editFinId) return;
  confirmAction('Xoá khoản này?',async()=>{
    if(finMode==='income') income=income.filter(x=>x.id!==editFinId);
    else expense=expense.filter(x=>x.id!==editFinId);
    await saveToFirestore();window.closeModal('modal-fin');renderAll();showToast('🗑 Đã xoá');
  });
};

// ── TOOLS ─────────────────────────────────────────────────────
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
  const totalDeposit=monthly*months;
  // FIX UX: lãi kép tích lũy = goal - tổng gốc đã gửi (không âm khi r=0)
  const interest=Math.max(0,goal-totalDeposit);
  res.className='tool-result show';
  res.innerHTML=`<div class="tr-row"><span class="tr-label">Cần gửi mỗi tháng</span><span class="tr-val" style="color:var(--green)">${fmt(monthly)}</span></div>
    <div class="tr-row"><span class="tr-label">Tổng tiền gốc</span><span class="tr-val">${fmt(totalDeposit)}</span></div>
    <div class="tr-row"><span class="tr-label">Lãi kép tích lũy</span><span class="tr-val" style="color:var(--accent)">${fmt(interest)}</span></div>
    <div class="tr-row"><span class="tr-label">Mục tiêu</span><span class="tr-val" style="color:var(--green)">${fmt(goal)}</span></div>`;
};

// ── SETTINGS ──────────────────────────────────────────────────
window.toggleAcc=function(id){
  const body=document.getElementById('body-'+id);const arrow=document.getElementById('arr-'+id);if(!body)return;
  const isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);arrow.classList.toggle('open',!isOpen);
};
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
  const menu=document.getElementById('sett-menu');
  const overlay=document.getElementById('sett-dd-overlay');
  const btn=document.getElementById('sett-more-btn');
  if(menu) menu.classList.remove('open');
  if(overlay) overlay.classList.remove('open');
  if(btn) btn.classList.remove('active');
  setTimeout(()=>document.getElementById('modal-theme')?.classList.add('open'),80);
};

// Export JSON
window.exportJSON=function(){
  const data={debts,income,expense,ticks,txns,savings,walletBase,lastAutoMonth};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`vi-cua-toi-${currentMonth}.json`;
  a.click();URL.revokeObjectURL(url);
  showToast('✓ Đã xuất dữ liệu');
};

// Reset — thêm bước xác nhận thứ hai (UX fix)
window.resetAll=function(){
  confirmAction(
    '⚠️ Reset toàn bộ về mặc định? Hành động này KHÔNG THỂ hoàn tác!',
    ()=>confirmAction(
      'Xác nhận lần cuối — xoá hết dữ liệu?',
      async()=>{
        debts=clone(DEF_DEBTS);income=clone(DEF_INCOME);expense=clone(DEF_EXPENSE);
        ticks={};txns={};savings=[];walletBase=0;lastAutoMonth='';
        await saveToFirestore();renderAll();showToast('✓ Đã reset');
      }
    )
  );
};

// ── INIT ──────────────────────────────────────────────────────
initMonth();
syncMonthForPicker();
initTheme();
document.addEventListener('DOMContentLoaded',()=>{
  initAccent();
  const th=localStorage.getItem('vn_theme')||'dark';
  setTheme(th);
});
