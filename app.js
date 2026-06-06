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
const DEF_DEBTS = [];
const DEF_INCOME  = [];
const DEF_EXPENSE = [];
const SUGGEST_IN  = ['Thưởng','Freelance','Bán đồ','Hoàn tiền','Thu nợ','Lãi tiết kiệm','Quà tặng','Khác'];
const SUGGEST_OUT = ['Ăn uống','Di chuyển','Mua sắm','Y tế','Sửa chữa','Giải trí','Học phí','Điện nước','Khác'];

// ── STATE ─────────────────────────────────────────────────────
let debts=[], income=[], expense=[], ticks={};
let txns={}, savings=[], loanBook=[], walletBase=0, lastAutoMonth='';
let currentMonth='', currentFilter='all', openDetail=null;
let editDebtId=null, editFinId=null, finMode='income';
let editTxnId=null, txnType='out';
let editLoanId=null;
let uid=null, unsubSnap=null;
let walletHidden=false;
let showAllTxnsFlag=false;
let isSavingToFirestore=false;
let onboardingStep=1;

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
      ticks={}; txns={}; savings=[]; loanBook=[]; walletBase=0; lastAutoMonth='';
      renderAll();
      openOnboarding();
      return;
    }
    const d=snap.data();
    debts         =d.debts         ||clone(DEF_DEBTS);
    income        =d.income        ||clone(DEF_INCOME);
    expense       =d.expense       ||clone(DEF_EXPENSE);
    ticks         =d.ticks         ||{};
    txns          =d.txns          ||{};
    savings       =d.savings       ||[];
    loanBook      =d.loanBook      ||[];
    walletBase    =d.walletBase    ||0;
    lastAutoMonth =d.lastAutoMonth ||'';
    migrateDebts();
    autoReduceDebts();
    setSyncBadge('synced','Đã đồng bộ');
    renderAll();
  },(e)=>{setSyncBadge('error','Mất kết nối');console.error(e);});
}

async function saveToFirestore(){
  if(!uid) return;
  isSavingToFirestore=true;
  setSyncBadge('syncing','Đang lưu…');
  try{
    await setDoc(userDoc(),{debts,income,expense,ticks,txns,savings,loanBook,walletBase,lastAutoMonth},{merge:true});
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
    const name =user.displayName||(user.isAnonymous?'Ẩn danh (chưa đăng nhập)':'Người dùng');
    const email=user.email||(user.isAnonymous?'Dữ liệu chỉ lưu trên thiết bị này':'—');
    ['acc-name','acc-name2'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=name;});
    ['acc-email','acc-email-sub'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=email;});
    // Hiện/ẩn nút đăng nhập cho user ẩn danh
    const anonBtn=document.getElementById('anon-login-btn');
    if(anonBtn) anonBtn.style.display=user.isAnonymous?'block':'none';
    const _setAvatar=(id)=>{
      const el=document.getElementById(id);if(!el)return;
      if(!user.isAnonymous&&user.displayName){
        const ini=user.displayName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        el.dataset.initials=ini;el.classList.add('has-initials');el.textContent='';
      } else {
        el.textContent=user.isAnonymous?'🔓':'👤';el.classList.remove('has-initials');delete el.dataset.initials;
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
  return {debts,income,expense,ticks,txns,savings,loanBook,walletBase,
          walletHidden,currentMonth,currentFilter,
          currentTheme:getCurrentTheme(),showAllTxnsFlag};
}

// ── ONBOARDING ────────────────────────────────────────────────
function showOnboardingStep(step){
  onboardingStep=step;
  const overlay=document.getElementById('onboarding-overlay');
  if(!overlay) return;
  overlay.classList.add('open');
  overlay.querySelectorAll('.ob-step').forEach(el=>el.classList.toggle('active',Number(el.dataset.step)===step));
  overlay.querySelectorAll('.ob-dot').forEach(el=>el.classList.toggle('active',Number(el.dataset.step)===step));
}
function openOnboarding(){
  showOnboardingStep(1);
  setTimeout(()=>document.getElementById('ob-income-amount')?.focus(),250);
}
function readOnboardingAmount(id){
  const el=document.getElementById(id);
  if(!el) return 0;
  if(el.dataset.raw!==undefined&&el.dataset.raw!=='') return Number(el.dataset.raw)||0;
  return Number(String(el.value||'').replace(/\./g,''))||0;
}
window.nextOnboarding=function(){
  if(onboardingStep===1){
    const amount=readOnboardingAmount('ob-income-amount');
    if(!amount){showToast('Nhập thu nhập hàng tháng');return;}
    const name=document.getElementById('ob-income-name')?.value.trim()||'Thu nhập hàng tháng';
    income=[{id:'ob-inc',name,amount,note:'Hàng tháng'}];
    showOnboardingStep(2);
    return;
  }
  if(onboardingStep===2){
    const amount=readOnboardingAmount('ob-expense-amount');
    const name=document.getElementById('ob-expense-name')?.value.trim()||'Chi phí cố định';
    expense=amount?[{id:'ob-exp',name,amount,note:'Cố định'}]:[];
    showOnboardingStep(3);
  }
};
window.skipOnboardingStep=function(){
  if(onboardingStep===2){
    expense=[];
    showOnboardingStep(3);
    return;
  }
  if(onboardingStep===3) window.finishOnboarding();
};
window.loginFromOnboarding=function(){
  // Ẩn overlay onboarding trước
  const ov=document.getElementById('onboarding-overlay');
  if(ov) ov.classList.remove('open');
  // Gọi đăng nhập Google — onAuthStateChanged sẽ xử lý phần còn lại
  window.signInGoogle();
};
  walletBase=readOnboardingAmount('ob-wallet-amount');
  await saveToFirestore();
  document.getElementById('onboarding-overlay')?.classList.remove('open');
  renderAll();
  showToast('✓ Đã thiết lập ví');
};

function renderAll(){
  const s=getState();
  renderHome(s);
  renderPaid(s);
  renderTxnPage(s);
  renderSettings(s);
  renderTools(s);
  renderReport(s);
}

// ── SWITCH PAGE ───────────────────────────────────────────────
window.switchPage=function(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+name)?.classList.add('active');
  // nav highlight: tool sub-pages → highlight report tab
  const navName=['tool-loanbook','tool-interest','tool-saving-calc','tool-schedule','tool-analyze'].includes(name)?'report':name;
  document.getElementById('nav-'+navName)?.classList.add('active');
  openDetail=null;showAllTxnsFlag=false;
  const s=getState();
  if(name==='home')               renderHome(s);
  if(name==='paid')               renderPaid(s);
  if(name==='txn')                renderTxnPage(s);
  if(name==='report')             renderTools(s);
  if(name==='settings')           renderSettings(s);
  if(name==='debt')               renderSettings(s);
  if(name==='finance')            renderSettings(s);
  if(name==='tool-loanbook')      renderLoanBook(s);
  if(name==='tool-interest')      {} // static form
  if(name==='tool-saving-calc')   {} // static form
  if(name==='tool-schedule')      renderSchedulePage(s);
  if(name==='tool-analyze')       renderAnalyzePage(s);
};

// ── CARD INTERACTIONS — mở modal chi tiết ────────────────────
let _detailDebtId=null;
window.tapTop=function(id){
  const d=debts.find(x=>x.id===id);if(!d)return;
  _detailDebtId=id;
  const ms=ticks[currentMonth]||{};
  const paid=!!ms[id];
  const content=document.getElementById('ddetail-content');
  if(!content)return;

  if(d.type==='td'){
    const limit=Number(d.limit||0),used=Number(d.used||0),avail=Math.max(0,limit-used);
    const usedPct=limit?Math.min(100,Math.round(used/limit*100)):0;
    const barColor=usedPct>80?'var(--red)':usedPct>60?'var(--orange)':'var(--accent)';
    content.innerHTML=`
      <div style="font-size:17px;font-weight:900;margin-bottom:4px">💳 ${d.name}</div>
      <div style="font-size:12px;color:var(--sub);font-weight:600;margin-bottom:16px">Ngày TT: ${d.payDay||'—'} · ${paid?'✅ Đã thanh toán':'⏳ Chưa thanh toán'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div><div style="font-size:10px;color:var(--sub)">Hạn mức</div><div style="font-size:15px;font-weight:800">${fmt(limit)}</div></div>
        <div><div style="font-size:10px;color:var(--sub)">Đã dùng</div><div style="font-size:15px;font-weight:800;color:var(--orange)">${fmt(used)}</div></div>
        <div><div style="font-size:10px;color:var(--sub)">Còn lại</div><div style="font-size:15px;font-weight:800;color:var(--accent)">${fmt(avail)}</div></div>
        <div><div style="font-size:10px;color:var(--sub)">Trả tháng này</div><div style="font-size:15px;font-weight:800;color:var(--red)">${fmt(d.monthly||0)}</div></div>
      </div>
      <div style="background:var(--bg);border-radius:8px;overflow:hidden;height:8px;margin-bottom:6px">
        <div style="width:${usedPct}%;height:100%;background:${barColor};border-radius:8px;transition:width .4s"></div>
      </div>
      <div style="font-size:11px;color:var(--sub);font-weight:600;text-align:center">${usedPct}% đã sử dụng</div>
      ${d.note?`<div style="margin-top:12px;font-size:12px;color:var(--sub);font-weight:600">📝 ${d.note}</div>`:''}`;
  } else {
    const cp=tcCurrentPayment(d);
    const bal=tcGetDebt(d);
    const pct=d.totalTerm?Math.round((d.curTerm||0)/d.totalTerm*100):0;
    content.innerHTML=`
      <div style="font-size:17px;font-weight:900;margin-bottom:4px">💰 ${d.name}</div>
      <div style="font-size:12px;color:var(--sub);font-weight:600;margin-bottom:16px">Ngày TT: ${d.payDay||'—'} · ${paid?'✅ Đã thanh toán':'⏳ Chưa thanh toán'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div><div style="font-size:10px;color:var(--sub)">Trả tháng này</div><div style="font-size:15px;font-weight:800;color:var(--accent)">${fmt(cp.monthly)}</div></div>
        <div><div style="font-size:10px;color:var(--sub)">Dư nợ còn lại</div><div style="font-size:15px;font-weight:800;color:var(--blue)">${fmt(bal)}</div></div>
        <div><div style="font-size:10px;color:var(--sub)">Lãi tháng này</div><div style="font-size:15px;font-weight:800;color:var(--orange)">${fmt(cp.interest)}</div></div>
        <div><div style="font-size:10px;color:var(--sub)">Trả gốc</div><div style="font-size:15px;font-weight:800;color:var(--green)">${fmt(cp.principal)}</div></div>
        <div><div style="font-size:10px;color:var(--sub)">Tiến độ</div><div style="font-size:15px;font-weight:800">${d.curTerm||0}/${d.totalTerm||0} kỳ</div></div>
        <div><div style="font-size:10px;color:var(--sub)">Hoàn thành</div><div style="font-size:15px;font-weight:800;color:var(--purple)">${pct}%</div></div>
      </div>
      ${d.note?`<div style="margin-top:4px;font-size:12px;color:var(--sub);font-weight:600">📝 ${d.note}</div>`:''}`;
  }
  document.getElementById('modal-debt-detail').classList.add('open');
};

window.editFromDetail=function(){
  window.closeModal('modal-debt-detail');
  if(_detailDebtId) window.openDebtEdit(_detailDebtId);
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
  window.openMonthPicker(currentMonth);
};

// ── TOOL PAGE RENDERS ─────────────────────────────────────────
function renderLoanBook(s){
  if(typeof renderLoanBookList==='function') renderLoanBookList(s.loanBook||[]);
}
function renderSchedulePage(s){
  const el=document.getElementById('schedule-list');if(!el)return;
  el.innerHTML='';
  const today=new Date().getDate();
  const active=(s.debts||[]).filter(d=>!d.settled&&d.payDay);
  if(!active.length){el.innerHTML='<div class="empty" style="padding:24px 0">Chưa có ngày thanh toán nào</div>';return;}
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
function renderAnalyzePage(s){
  if(typeof renderAnalyze==='function') renderAnalyze(s);
  else {
    // fallback inline
    const el=document.getElementById('analyze-content');if(!el)return;
    const totalIncome=(s.income||[]).reduce((a,x)=>a+Number(x.amount),0);
    if(!totalIncome){el.innerHTML='<div style="padding:20px;text-align:center;color:var(--sub);font-size:13px;font-weight:700">⚠️ Chưa có dữ liệu thu nhập.<br>Vào <b>Cài đặt → Thu nhập</b> để nhập lương.</div>';return;}
    const totalDebtPay=(s.debts||[]).filter(d=>!d.settled).reduce((a,d)=>a+(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0)),0);
    const debtRatio=Math.round(totalDebtPay/totalIncome*100);
    const score=debtRatio>50?40:debtRatio>35?65:debtRatio>20?80:95;
    const scoreColor=score>=80?'var(--accent)':score>=60?'var(--orange)':'var(--red)';
    el.innerHTML=`<div class="analyze-score" style="padding:20px 0;text-align:center">
      <div style="font-size:48px;font-weight:900;color:${scoreColor}">${score}</div>
      <div style="font-size:13px;color:var(--sub);font-weight:700">Điểm sức khoẻ tài chính</div>
    </div>
    <div class="analyze-item"><span class="analyze-key">Tỉ lệ nợ / thu nhập</span><span class="analyze-val" style="color:${debtRatio>40?'var(--red)':'var(--accent)'}">${debtRatio}%</span></div>
    <div style="padding:12px;font-size:12px;color:var(--sub);font-weight:600;background:var(--card);border-radius:12px;margin-top:12px">${debtRatio>50?'⚠️ Tỉ lệ nợ trên 50% — rủi ro cao. Ưu tiên trả nợ lãi cao nhất.':debtRatio>35?'💡 Tỉ lệ nợ khá cao. Hạn chế chi tiêu.':'✅ Tỉ lệ nợ ổn. Duy trì kỷ luật.'}</div>`;
  }
}

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
  // Set date mặc định = hôm nay, giới hạn min/max theo tháng đang xem
  const dateEl=document.getElementById('txn-date');
  if(dateEl){
    const today=new Date().toISOString().slice(0,10);
    const [y,m]=currentMonth.split('-');
    const lastDay=new Date(+y,+m,0).getDate();
    dateEl.min=`${currentMonth}-01`;
    dateEl.max=`${currentMonth}-${String(lastDay).padStart(2,'0')}`;
    // Nếu tháng hiện tại = tháng đang xem thì default hôm nay, không thì ngày 1
    dateEl.value=today.startsWith(currentMonth)?today:`${currentMonth}-01`;
  }
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
  const dateEl=document.getElementById('txn-date');
  if(dateEl){
    const [y,m]=currentMonth.split('-');
    const lastDay=new Date(+y,+m,0).getDate();
    dateEl.min=`${currentMonth}-01`;
    dateEl.max=`${currentMonth}-${String(lastDay).padStart(2,'0')}`;
    dateEl.value=t.date||`${currentMonth}-01`;
  }
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
  const txnDate=document.getElementById('txn-date')?.value||new Date().toISOString().slice(0,10);
  if(editTxnId){const t=txns[currentMonth].find(x=>x.id===editTxnId);if(t){t.name=name;t.amount=amount;t.type=txnType;t.date=txnDate;}}
  else txns[currentMonth].push({id:'t'+Date.now(),name,amount,type:txnType,date:txnDate});
  await saveToFirestore();window.closeModal('modal-txn');
  renderAll();
  showToast(txnType==='in'?`✓ +${fmt(amount)} Thu`:`✓ -${fmt(amount)} Chi`);
};
window.deleteTxn=function(){
  if(!editTxnId) return;
  confirmAction('Xoá giao dịch này?',async()=>{
    txns[currentMonth]=(txns[currentMonth]||[]).filter(x=>x.id!==editTxnId);
    await saveToFirestore();window.closeModal('modal-txn');
    renderAll();showToast('🗑 Đã xoá');
  });
};
window.openTxnModalType=function(type){
  window.openTxnModal();
  window.setTxnType(type);
};
window.showAllTxns=()=>{showAllTxnsFlag=true;renderTxnPage(getState());};

// ── WALLET / SAVING ───────────────────────────────────────────
window.saveWalletBase=async function(){
  walletBase=getInputVal('wallet-base-input');
  await saveToFirestore();
  renderAll();showToast('✓ Đã lưu số dư');
};
window.saveWalletBaseFromHome=async function(){
  const el=document.getElementById('home-wallet-base-input');
  walletBase=Number(el?.dataset.raw||String(el?.value||'').replace(/\./g,''))||0;
  await saveToFirestore();
  renderAll();
  showToast('✓ Đã lưu số dư');
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
  await saveToFirestore();window.closeModal('modal-saving');renderAll();showToast(`✓ +${fmt(amount)}`);
};
window.deleteSaving=function(id){
  confirmAction('Xoá khoản tiết kiệm này?',async()=>{
    savings=savings.filter(x=>x.id!==id);
    await saveToFirestore();renderAll();showToast('🗑 Đã xoá');
  });
};

// ── LOAN BOOK ────────────────────────────────────────────────
window.openLoanBookModal=function(id){
  editLoanId=id||null;
  const item=editLoanId?loanBook.find(x=>x.id===editLoanId):null;
  document.getElementById('lb-name').value=item?.name||'';
  setInputFmt('lb-amount',item?.amount||0);
  document.getElementById('lb-note').value=item?.note||'';
  document.getElementById('lb-del').style.display=item?'block':'none';
  document.getElementById('modal-loanbook').classList.add('open');
  setTimeout(()=>document.getElementById('lb-name').focus(),250);
};
window.saveLoanBook=async function(){
  const name=document.getElementById('lb-name').value.trim();
  const amount=getInputVal('lb-amount');
  const note=document.getElementById('lb-note').value.trim();
  if(!name){showToast('⚠️ Nhập tên người nợ');return;}
  if(!amount){showToast('⚠️ Nhập số tiền');return;}
  if(editLoanId){
    const item=loanBook.find(x=>x.id===editLoanId);
    if(item) Object.assign(item,{name,amount,note});
  } else {
    loanBook.push({id:'lb'+Date.now(),name,amount,note,date:new Date().toLocaleDateString('vi-VN')});
  }
  await saveToFirestore();window.closeModal('modal-loanbook');renderAll();showToast('✓ Đã lưu ghi nợ');
};
window.deleteLoanBook=function(){
  if(!editLoanId) return;
  confirmAction('Xoá ghi nợ này?',async()=>{
    loanBook=loanBook.filter(x=>x.id!==editLoanId);
    await saveToFirestore();window.closeModal('modal-loanbook');renderAll();showToast('🗑 Đã xoá');
  });
};

// ── DEBT TYPE SHEET ───────────────────────────────────────────
window.openDebtTypeSheet=function(){
  document.getElementById('modal-debt-type').classList.add('open');
};
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
  const P       =getInputVal('ti-principal');
  const rYear   =Number(document.getElementById('ti-rate').value)||0;
  const n       =Number(document.getElementById('ti-terms').value)||0;
  const method  =document.getElementById('ti-method')?.value||'reducing_balance';
  const res     =document.getElementById('ti-result');
  if(!P||!rYear||!n){showToast('⚠️ Nhập đủ thông tin');return;}
  const r=rYear/100/12;
  let monthly,total,interest;
  if(method==='fixed_principal'){
    const princ=P/n;
    const firstMonth=princ+P*r;
    const lastMonth =princ+(P/n)*r;
    total   =tcTotalInterest(P,rYear,n,'fixed_principal')+P;
    interest=tcTotalInterest(P,rYear,n,'fixed_principal');
    monthly =firstMonth; // tháng đầu (cao nhất)
    res.className='tool-result show';
    res.innerHTML=`<div class="tr-row"><span class="tr-label">Trả tháng đầu</span><span class="tr-val" style="color:var(--accent)">${fmt(firstMonth)}</span></div>
      <div class="tr-row"><span class="tr-label">Trả tháng cuối</span><span class="tr-val" style="color:var(--accent)">${fmt(lastMonth)}</span></div>
      <div class="tr-row"><span class="tr-label">Tổng trả ${n} kỳ</span><span class="tr-val">${fmt(total)}</span></div>
      <div class="tr-row"><span class="tr-label">Tổng tiền lãi</span><span class="tr-val" style="color:var(--red)">${fmt(interest)}</span></div>
      <div class="tr-row"><span class="tr-label">Vốn gốc</span><span class="tr-val">${fmt(P)}</span></div>`;
  } else {
    const pmt=r?P*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1):P/n;
    total=pmt*n; interest=total-P;
    res.className='tool-result show';
    res.innerHTML=`<div class="tr-row"><span class="tr-label">Trả mỗi tháng (cố định)</span><span class="tr-val" style="color:var(--accent)">${fmt(pmt)}</span></div>
      <div class="tr-row"><span class="tr-label">Tổng trả ${n} kỳ</span><span class="tr-val">${fmt(total)}</span></div>
      <div class="tr-row"><span class="tr-label">Tổng tiền lãi</span><span class="tr-val" style="color:var(--red)">${fmt(interest)}</span></div>
      <div class="tr-row"><span class="tr-label">Vốn gốc</span><span class="tr-val">${fmt(P)}</span></div>`;
  }
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
  const data={debts,income,expense,ticks,txns,savings,loanBook,walletBase,lastAutoMonth};
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
        ticks={};txns={};savings=[];loanBook=[];walletBase=0;lastAutoMonth='';
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

// ── EXPORT CSV (UX#9) ─────────────────────────────────────────
window.exportCSV=function(){
  const rows=[['Tháng','Loại','Tên','Số tiền','Ngày','Danh mục']];
  Object.entries(txns).forEach(([month,list])=>{
    (list||[]).forEach(t=>{
      rows.push([getML(month), t.type==='in'?'Thu':'Chi', t.name, t.amount, t.date||'', t.cat||'']);
    });
  });
  income.forEach(x=>rows.push(['Cố định','Thu',x.name,x.amount,'',x.note||'']));
  expense.forEach(x=>rows.push(['Cố định','Chi',x.name,x.amount,'',x.note||'']));
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;
  a.download=`vi-cua-toi-${currentMonth}.csv`;a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Đã xuất CSV — mở bằng Excel');
};

// ── METHOD HELP TOGGLE (UX#6) ────────────────────────────────
window.showMethodHelp=function(){
  const el=document.getElementById('method-help');
  if(el) el.style.display=el.style.display==='none'?'block':'none';
};
