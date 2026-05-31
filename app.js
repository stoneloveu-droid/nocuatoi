import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, onSnapshot, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── FIREBASE CONFIG ────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyA1Pde18_aLXilbvs1Q0fWbVtcApkAdJcs",
  authDomain: "vicuatoi.firebaseapp.com",
  projectId: "vicuatoi",
  storageBucket: "vicuatoi.firebasestorage.app",
  messagingSenderId: "490747827741",
  appId: "1:490747827741:web:ea97898cec463d3d6f18f4"
};
const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);

// ── DEFAULT DATA ───────────────────────────────────────────────
const DEF_DEBTS = [
  {id:'tp',      name:'TP Bank',    type:'td', debt:12000000,  monthly:216000,  note:'1.80%/th',   payDay:15},
  {id:'ocb',     name:'OCB Bank',   type:'td', debt:36300000,  monthly:834900,  note:'2.30%/th',   payDay:20},
  {id:'vp-td',   name:'VP Bank TD', type:'td', debt:40500000,  monthly:202500,  note:'0.50%/th',   payDay:10},
  {id:'shin-td', name:'Shinhan TD', type:'td', debt:24500000,  monthly:318500,  note:'1.30%/th',   payDay:25},
  {id:'vp-tc',   name:'VP Bank TC', type:'tc', debt:17227509,  monthly:1113000, curTerm:13, totalTerm:35, payDay:5},
  {id:'shin-tc', name:'Shinhan TC', type:'tc', debt:29776139,  monthly:2312000, curTerm:46, totalTerm:60, payDay:8},
  {id:'hsbc',    name:'HSBC Bank',  type:'tc', debt:31962457,  monthly:2991000, curTerm:49, totalTerm:60, payDay:12},
  {id:'vib1',    name:'VIB Bank 1', type:'tc', debt:34200505,  monthly:2616000, curTerm:46, totalTerm:60, payDay:15},
  {id:'vib2',    name:'VIB Bank 2', type:'tc', debt:28926071,  monthly:1417000, curTerm:11, totalTerm:36, payDay:20},
];
const DEF_INCOME  = [{id:'sal',    name:'Lương cơ bản',         amount:12000000, note:'Hàng tháng'}];
const DEF_EXPENSE = [{id:'living', name:'Sinh hoạt / gia đình', amount:8200000,  note:'Cố định'}];

const SUGGEST_IN  = ['Thưởng','Freelance','Bán đồ','Hoàn tiền','Thu nợ','Lãi tiết kiệm','Quà tặng','Khác'];
const SUGGEST_OUT = ['Ăn uống','Di chuyển','Mua sắm','Y tế','Sửa chữa','Giải trí','Học phí','Tiền điện nước','Khác'];

// ── STATE ──────────────────────────────────────────────────────
let debts=[], income=[], expense=[], ticks={};
let txns={}, savings=[], walletBase=0, lastAutoMonth='';
let currentMonth='', currentFilter='all', openDetail=null;
let editDebtId=null, editFinId=null, finMode='income';
let editTxnId=null, txnType='out';
let uid=null, unsubSnap=null;
let fmtMode='short';

function clone(x){return JSON.parse(JSON.stringify(x));}
function initMonth(){
  const n=new Date();
  currentMonth=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
}

// ── FORMAT ─────────────────────────────────────────────────────
function fmt(n){
  n=Number(n)||0;
  if(fmtMode==='full')    return n.toLocaleString('vi-VN')+'đ';
  if(fmtMode==='million'){
    if(n>=1e9) return (n/1e9).toFixed(1)+' tỷ';
    if(n>=1e6) return (n/1e6).toFixed(1)+' triệu';
    if(n>=1e3) return (n/1e3).toFixed(0)+' nghìn';
    return n.toLocaleString('vi-VN')+'đ';
  }
  if(n>=1e9) return (n/1e9).toFixed(1)+'Bđ';
  if(n>=1e6) return (n/1e6).toFixed(1)+'Mđ';
  if(n>=1e3) return (n/1e3).toFixed(0)+'Kđ';
  return n.toLocaleString('vi-VN')+'đ';
}
window.changeFmt=function(val){
  fmtMode=val;localStorage.setItem('vn_fmt',val);
  renderAll();
};
function getML(k){const[y,m]=k.split('-');return `T${parseInt(m)}/${y}`;}

// ── FIRESTORE ──────────────────────────────────────────────────
function userDoc(){return doc(db,'users',uid);}

function startRealtimeSync(){
  if(unsubSnap) unsubSnap();
  unsubSnap = onSnapshot(userDoc(), (snap)=>{
    if(!snap.exists()) return;
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
  }, (e)=>{
    setSyncBadge('error','Mất kết nối');
    console.error(e);
  });
}

async function saveToFirestore(){
  if(!uid) return;
  setSyncBadge('syncing','Đang lưu…');
  try {
    await setDoc(userDoc(),
      {debts,income,expense,ticks,txns,savings,walletBase,lastAutoMonth},
      {merge:true}
    );
    setSyncBadge('synced','Đã đồng bộ');
  } catch(e){
    setSyncBadge('error','Lỗi lưu');
    console.error(e);
  }
}

function setSyncBadge(cls,txt){
  const b=document.getElementById('sync-badge');
  b.className='sync-badge '+cls;
  document.getElementById('sync-text').textContent=txt;
}

// ── MIGRATE old note="Kỳ X/Y" format ──────────────────────────
function migrateDebts(){
  debts.forEach(d=>{
    if(d.type==='tc'&&d.note&&!d.curTerm){
      const m=d.note.match(/^Kỳ\s*(\d+)\/(\d+)$/);
      if(m){d.curTerm=parseInt(m[1]);d.totalTerm=parseInt(m[2]);d.note='';}
    }
  });
}

// ── AUTO-REDUCE DEBTS mỗi tháng ──────────────────────────────
// Chạy sau khi dữ liệu đã được load, currentMonth đã được init
function autoReduceDebts(){
  if(!currentMonth || lastAutoMonth===currentMonth) return;
  debts.forEach(d=>{
    if(d.settled) return;
    d.debt=Math.max(0,(Number(d.debt)||0)-(Number(d.monthly)||0));
    if(d.type==='tc'&&d.totalTerm){
      d.curTerm=Math.min((d.curTerm||0)+1,d.totalTerm);
      if(d.curTerm>=d.totalTerm) d.settled=true;
    }
  });
  lastAutoMonth=currentMonth;
  saveToFirestore();
}

// ── AUTH ───────────────────────────────────────────────────────
window.signInGoogle=async()=>{
  try{const p=new GoogleAuthProvider();await signInWithPopup(auth,p);}
  catch(e){showToast('⚠️ Đăng nhập thất bại');}
};
window.signInAnon=async()=>{
  try{await signInAnonymously(auth);}
  catch(e){showToast('⚠️ Lỗi');}
};
window.doSignOut=async()=>{
  if(!confirm('Đăng xuất?'))return;
  if(unsubSnap){unsubSnap();unsubSnap=null;}
  await signOut(auth);
};

onAuthStateChanged(auth, async(user)=>{
  const overlay =document.getElementById('loading-overlay');
  const authPage=document.getElementById('auth-page');
  const bnav    =document.getElementById('bnav');

  if(user){
    uid=user.uid;
    // update account info
    const name =user.displayName||(user.isAnonymous?'Ẩn danh':'Người dùng');
    const email=user.email||(user.isAnonymous?'Không đăng nhập':'—');
    document.getElementById('acc-name').textContent    =name;
    document.getElementById('acc-email').textContent   =email;
    document.getElementById('acc-name-sub').textContent=name;
    document.getElementById('acc-email-sub').textContent=email;

    authPage.classList.remove('active');
    bnav.style.display='flex';

    // init month BEFORE realtime sync triggers autoReduce
    initMonth();

    // set initial loading badge, then start realtime
    setSyncBadge('syncing','Đang đồng bộ…');
    startRealtimeSync();

    // after first snapshot fires, autoReduceDebts is called in renderAll
    overlay.classList.add('hidden');
    setTimeout(()=>overlay.style.display='none',500);

    // show home
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

// ── RENDER ALL ─────────────────────────────────────────────────
function renderAll(){
  autoReduceDebts(); // safe: only runs once per month
  renderHome();
  renderPaid();
  renderTxnPage();
  renderSettings();
  renderTools();
}

// ── HOME ───────────────────────────────────────────────────────
function renderHome(){
  const n=new Date();
  document.getElementById('sub-date').textContent=
    n.toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'numeric'});
  document.getElementById('month-label').textContent=getML(currentMonth);

  const totalIncome =income.reduce((s,x)=>s+Number(x.amount),0);
  const totalExpense=expense.reduce((s,x)=>s+Number(x.amount),0);
  const totalDebtPay=debts.filter(d=>!d.settled).reduce((s,d)=>s+Number(d.monthly),0);

  const monthTxns=txns[currentMonth]||[];
  const txnIn =monthTxns.filter(t=>t.type==='in') .reduce((s,t)=>s+Number(t.amount),0);
  const txnOut=monthTxns.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);

  const totalIn =totalIncome+txnIn;
  const totalOut=totalExpense+txnOut;
  const remain  =totalIn-totalOut-totalDebtPay;
  const totalDebtLeft=debts.filter(d=>!d.settled).reduce((s,d)=>s+Number(d.debt),0);

  document.getElementById('kpi-income').textContent    =fmt(totalIn);
  document.getElementById('kpi-expense').textContent   =fmt(totalOut);
  document.getElementById('kpi-debt-pay').textContent  =fmt(totalDebtPay);
  document.getElementById('kpi-remain').textContent    =remain>=0?fmt(remain):'-'+fmt(Math.abs(remain));
  document.getElementById('kpi-remain').style.color    =remain>=0?'var(--purple)':'var(--red)';
  document.getElementById('kpi-debt-total').textContent=fmt(totalDebtLeft);

  // Tiền trong túi = thu nhập - chi cố định - trả nợ - chi đột xuất + thu đột xuất + điều chỉnh
  const monthTxnsAll=txns[currentMonth]||[];
  const txnInHome =monthTxnsAll.filter(t=>t.type==='in') .reduce((s,t)=>s+Number(t.amount),0);
  const txnOutHome=monthTxns.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);
  const wallet = totalIncome - totalExpense - totalDebtPay + txnInHome - txnOutHome + (walletBase||0);
  const wEl=document.getElementById('kpi-wallet');
  if(wEl){ wEl.textContent=fmt(wallet); wEl.style.color=wallet>=0?'var(--blue)':'var(--red)'; }

  // ratio bar
  if(totalIn>0){
    const ep=Math.min(totalOut/totalIn*100,100);
    const dp=Math.min(totalDebtPay/totalIn*100,Math.max(0,100-ep));
    const rp=Math.max(100-ep-dp,0);
    document.getElementById('rb-expense').style.width=ep+'%';
    document.getElementById('rb-debt').style.width   =dp+'%';
    document.getElementById('rb-remain').style.width =rp+'%';
  }

  // progress
  const ms=ticks[currentMonth]||{};
  const paidAmt=debts.filter(d=>!d.settled&&ms[d.id]).reduce((s,d)=>s+Number(d.monthly),0);
  const pct=totalDebtPay?Math.round(paidAmt/totalDebtPay*100):0;
  document.getElementById('prog-fill').style.width=pct+'%';
  document.getElementById('prog-pct').textContent =pct+'%';
}

// ── PAID (Đã thanh toán) ───────────────────────────────────────
function renderPaid(){
  document.getElementById('paid-month-label').textContent=getML(currentMonth);
  document.getElementById('paid-subtitle').textContent=getML(currentMonth);

  const ms=ticks[currentMonth]||{};
  const activeDebts=debts.filter(d=>!d.settled);
  const totalPay   =activeDebts.reduce((s,d)=>s+Number(d.monthly),0);
  const paidAmt    =activeDebts.filter(d=>ms[d.id]).reduce((s,d)=>s+Number(d.monthly),0);
  const unpaidAmt  =totalPay-paidAmt;

  document.getElementById('ps-total-debt').textContent=fmt(totalPay);
  document.getElementById('ps-paid').textContent      =fmt(paidAmt);
  document.getElementById('ps-unpaid').textContent    =fmt(unpaidAmt);

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
  if(d.type==='tc'&&d.totalTerm) return `Kỳ ${d.curTerm||0}/${d.totalTerm}${d.payDay?` · Ngày ${d.payDay}`:''}`;
  return (d.note||'')+(d.payDay?` · Ngày ${d.payDay}`:'');
}

function addCard(wrap,d,ms){
  const paid=!!ms[d.id], settled=!!d.settled;
  const div=document.createElement('div');
  div.className='dcard'+(paid?' paid':'')+(settled?' settled':'');
  div.id='dc-'+d.id;
  const pct=d.type==='tc'&&d.totalTerm?Math.round((d.curTerm||0)/d.totalTerm*100):null;
  div.innerHTML=`
    <div class="dcard-top" onclick="tapTop('${d.id}')">
      <div class="d-dot ${paid?'ok':d.type}"></div>
      <div class="d-info">
        <div class="d-name">${d.name}${settled?' <span class="settled-label">Tất toán</span>':''}</div>
        <div class="d-meta">${debtMeta(d)}</div>
      </div>
      <div class="d-right">
        <div class="d-amt ${d.type}">${fmt(d.monthly)}đ</div>
        <div class="d-unit">/ tháng</div>
      </div>
      <button class="chk${paid?' checked':''}" id="cb-${d.id}"
        onclick="event.stopPropagation();tapCheck('${d.id}')">✓</button>
    </div>
    <div class="dcard-detail" id="dd-${d.id}">
      <div class="dd-inner">
        <div class="dd-i"><label>Dư nợ</label><p>${fmt(d.debt)}đ</p></div>
        <div class="dd-i"><label>${d.type==='tc'?'Kỳ':'Trả/th'}</label>
          <p>${d.type==='tc'&&d.totalTerm?`${d.curTerm||0}/${d.totalTerm}${pct!==null?' ('+pct+'%)':''}`:fmt(d.monthly)+'đ'}</p></div>
        <div class="dd-i"><label>Trạng thái</label>
          <p id="ds-${d.id}" style="color:${settled?'var(--accent)':paid?'var(--accent)':'var(--orange)'}">
            ${settled?'Tất toán ✓':paid?'Đã TT ✓':'Chờ TT'}</p>
        </div>
      </div>
    </div>`;
  wrap.appendChild(div);
}

window.tapTop=function(id){
  const el=document.getElementById('dd-'+id);
  if(openDetail&&openDetail!==id){
    const p=document.getElementById('dd-'+openDetail);if(p)p.classList.remove('open');
  }
  if(openDetail===id){el.classList.remove('open');openDetail=null;}
  else{el.classList.add('open');openDetail=id;}
};

window.tapCheck=async function(id){
  if(!ticks[currentMonth])ticks[currentMonth]={};
  ticks[currentMonth][id]=!ticks[currentMonth][id];
  const paid=ticks[currentMonth][id];
  const d=debts.find(x=>x.id===id);

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

  // update progress bar inline
  const totalPay=debts.filter(x=>!x.settled).reduce((s,x)=>s+Number(x.monthly),0);
  const paidAmt =debts.filter(x=>!x.settled&&ticks[currentMonth]?.[x.id]).reduce((s,x)=>s+Number(x.monthly),0);
  const pct=totalPay?Math.round(paidAmt/totalPay*100):0;
  const pf=document.getElementById('prog-fill');
  const pp=document.getElementById('prog-pct');
  if(pf) pf.style.width=pct+'%';
  if(pp) pp.textContent=pct+'%';
  // update paid summary
  const ppaid=document.getElementById('ps-paid');
  const punpaid=document.getElementById('ps-unpaid');
  if(ppaid) ppaid.textContent=fmt(paidAmt);
  if(punpaid) punpaid.textContent=fmt(totalPay-paidAmt);

  if(currentFilter==='unpaid') setTimeout(()=>{openDetail=null;renderCards();},500);
  await saveToFirestore();
};

window.filterTab=function(f,el){
  currentFilter=f;openDetail=null;
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');renderCards();
};

// ── TXN PAGE ───────────────────────────────────────────────────
function renderTxnPage(){
  const tsl=document.getElementById('txn-subtitle');
  if(tsl) tsl.textContent=getML(currentMonth);
  const tml=document.getElementById('txn-month-label');
  if(tml) tml.textContent=getML(currentMonth);

  const monthTxns=txns[currentMonth]||[];
  const txnIn =monthTxns.filter(t=>t.type==='in') .reduce((s,t)=>s+Number(t.amount),0);
  const txnOut=monthTxns.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);

  document.getElementById('txn-kpi-in').textContent =fmt(txnIn);
  document.getElementById('txn-kpi-out').textContent=fmt(txnOut);

  const wi=document.getElementById('wallet-base-input');
  if(wi) wi.value=walletBase||'';

  // txn list
  const list=document.getElementById('txn-list');
  list.innerHTML='';
  if(!monthTxns.length){
    list.innerHTML=`<div class="empty" style="padding:24px 0">Chưa có giao dịch nào</div>`;
  } else {
    [...monthTxns].reverse().forEach(t=>{
      const row=document.createElement('div');row.className='txn-row';
      row.onclick=()=>openTxnEdit(t.id);
      row.innerHTML=`
        <div class="txn-dot ${t.type}"></div>
        <div class="txn-name">${t.name}</div>
        <div class="txn-amt ${t.type}">${t.type==='in'?'+':'-'}${fmt(t.amount)}</div>`;
      list.appendChild(row);
    });
  }

  // saving
  renderSavingList();
}

// ── TXN MODAL ──────────────────────────────────────────────────
window.openTxnModal=function(){
  editTxnId=null;
  document.getElementById('txn-name').value='';
  document.getElementById('txn-amount').value='';
  document.getElementById('txn-del').style.display='none';
  setTxnType('out');
  document.getElementById('modal-txn').classList.add('open');
  setTimeout(()=>document.getElementById('txn-amount').focus(),350);
};

function openTxnEdit(id){
  const t=(txns[currentMonth]||[]).find(x=>x.id===id);if(!t)return;
  editTxnId=id;
  document.getElementById('txn-name').value=t.name;
  document.getElementById('txn-amount').value=t.amount;
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
  const wrap=document.getElementById('txn-chips');
  wrap.innerHTML='';
  list.forEach(s=>{
    const c=document.createElement('div');c.className='chip';c.textContent=s;
    c.onclick=()=>{
      document.getElementById('txn-name').value=s==='Khác'?'':s;
      wrap.querySelectorAll('.chip').forEach(x=>x.classList.remove('sel'));
      c.classList.add('sel');
      if(s!=='Khác') document.getElementById('txn-amount').focus();
      else document.getElementById('txn-name').focus();
    };
    wrap.appendChild(c);
  });
}

window.saveTxn=async function(){
  const name  =document.getElementById('txn-name').value.trim()||'Không tên';
  const amount=Number(document.getElementById('txn-amount').value)||0;
  if(!amount){showToast('⚠️ Nhập số tiền');return;}
  if(!txns[currentMonth]) txns[currentMonth]=[];
  if(editTxnId){
    const t=txns[currentMonth].find(x=>x.id===editTxnId);
    if(t){t.name=name;t.amount=amount;t.type=txnType;}
  } else {
    txns[currentMonth].push({id:'t'+Date.now(),name,amount,type:txnType});
  }
  await saveToFirestore();
  closeModal('modal-txn');renderTxnPage();renderHome();
  showToast(txnType==='in'?`✓ +${fmt(amount)} Thu`:`✓ -${fmt(amount)} Chi`);
};

window.deleteTxn=async function(){
  if(!editTxnId||!confirm('Xoá?'))return;
  txns[currentMonth]=(txns[currentMonth]||[]).filter(x=>x.id!==editTxnId);
  await saveToFirestore();closeModal('modal-txn');renderTxnPage();renderHome();showToast('🗑 Đã xoá');
};

// ── WALLET / SAVING ────────────────────────────────────────────
window.saveWalletBase=async function(){
  const v=Number(document.getElementById('wallet-base-input').value)||0;
  walletBase=v;await saveToFirestore();renderTxnPage();renderHome();showToast('✓ Đã lưu số dư');
};

window.openSavingModal=function(){
  document.getElementById('sv-name').value='';
  document.getElementById('sv-amount').value='';
  document.getElementById('modal-saving').classList.add('open');
  setTimeout(()=>document.getElementById('sv-amount').focus(),350);
};

window.saveSaving=async function(){
  const name  =document.getElementById('sv-name').value.trim()||'Tiết kiệm';
  const amount=Number(document.getElementById('sv-amount').value)||0;
  if(!amount){showToast('⚠️ Nhập số tiền');return;}
  const date=new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'});
  savings.push({id:'sv'+Date.now(),name,amount,date});
  await saveToFirestore();closeModal('modal-saving');renderTxnPage();
  showToast(`✓ Tiết kiệm +${fmt(amount)}`);
};

window.deleteSaving=async function(id){
  if(!confirm('Xoá khoản tiết kiệm này?'))return;
  savings=savings.filter(x=>x.id!==id);
  await saveToFirestore();renderTxnPage();showToast('🗑 Đã xoá');
};

function renderSavingList(){
  const el=document.getElementById('saving-hist');
  if(!el) return;
  el.innerHTML='';
  if(!savings.length){
    el.innerHTML=`<div style="padding:14px;text-align:center;color:var(--sub);font-size:12px;font-weight:700">Chưa có khoản nào</div>`;
  } else {
    [...savings].reverse().forEach(s=>{
      const row=document.createElement('div');row.className='save-row';
      row.innerHTML=`
        <div class="save-row-left">
          <div class="save-row-name">${s.name||'Tiết kiệm'}</div>
          <div class="save-row-date">${s.date||''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="save-row-amt">+${fmt(s.amount)}</div>
          <button class="s-del" onclick="deleteSaving('${s.id}')">✕</button>
        </div>`;
      el.appendChild(row);
    });
  }
  const total=savings.reduce((s,x)=>s+Number(x.amount),0);
  const st=document.getElementById('saving-total');
  if(st) st.textContent=fmt(total);
}

// ── TOOLS ──────────────────────────────────────────────────────
function renderTools(){
  renderSchedule();
  renderAnalyze();
}

window.toggleTool=function(id){
  const body =document.getElementById('body-'+id);
  const arrow=document.getElementById('arr-'+id);
  if(!body) return;
  const isOpen=body.classList.contains('open');
  // close all
  document.querySelectorAll('.tool-body').forEach(b=>b.classList.remove('open'));
  document.querySelectorAll('.tool-arrow').forEach(a=>a.classList.remove('open'));
  if(!isOpen){body.classList.add('open');arrow.classList.add('open');}
};

window.calcInterest=function(){
  const P=Number(document.getElementById('ti-principal').value)||0;
  const r=Number(document.getElementById('ti-rate').value)/100||0;
  const n=Number(document.getElementById('ti-terms').value)||0;
  const res=document.getElementById('ti-result');
  if(!P||!r||!n){showToast('⚠️ Nhập đủ thông tin');return;}
  // PMT formula
  const monthly=r>0?P*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1):P/n;
  const total=monthly*n;
  const interest=total-P;
  res.className='tool-result show';
  res.innerHTML=`
    <div class="tr-row"><span class="tr-label">Trả mỗi tháng</span><span class="tr-val" style="color:var(--accent)">${fmt(monthly)}</span></div>
    <div class="tr-row"><span class="tr-label">Tổng trả ${n} tháng</span><span class="tr-val">${fmt(total)}</span></div>
    <div class="tr-row"><span class="tr-label">Tổng tiền lãi</span><span class="tr-val" style="color:var(--red)">${fmt(interest)}</span></div>
    <div class="tr-row"><span class="tr-label">Vốn gốc</span><span class="tr-val">${fmt(P)}</span></div>`;
};

window.calcSaving=function(){
  const goal  =Number(document.getElementById('sc-goal').value)||0;
  const rYear =Number(document.getElementById('sc-rate').value)/100||0;
  const months=Number(document.getElementById('sc-months').value)||0;
  const res   =document.getElementById('sc-result');
  if(!goal||!months){showToast('⚠️ Nhập đủ thông tin');return;}
  const r=rYear/12;
  // FV = PMT * ((1+r)^n - 1) / r  =>  PMT = FV * r / ((1+r)^n - 1)
  const monthly=r>0?goal*r/(Math.pow(1+r,months)-1):goal/months;
  const totalDeposit=monthly*months;
  const interest=goal-totalDeposit;
  res.className='tool-result show';
  res.innerHTML=`
    <div class="tr-row"><span class="tr-label">Cần gửi mỗi tháng</span><span class="tr-val" style="color:var(--green)">${fmt(monthly)}</span></div>
    <div class="tr-row"><span class="tr-label">Tổng tiền gốc</span><span class="tr-val">${fmt(totalDeposit)}</span></div>
    <div class="tr-row"><span class="tr-label">Lãi kép tích lũy</span><span class="tr-val" style="color:var(--accent)">${fmt(interest)}</span></div>
    <div class="tr-row"><span class="tr-label">Mục tiêu đạt được</span><span class="tr-val" style="color:var(--green)">${fmt(goal)}</span></div>`;
};

function renderSchedule(){
  const el=document.getElementById('schedule-list');
  if(!el) return;
  el.innerHTML='';
  const today=new Date().getDate();
  const activeDebts=debts.filter(d=>!d.settled&&d.payDay);
  if(!activeDebts.length){
    el.innerHTML=`<div style="color:var(--sub);font-size:12px;font-weight:700;text-align:center;padding:16px 0">Chưa có ngày thanh toán nào được thiết lập</div>`;
    return;
  }
  const sorted=[...activeDebts].sort((a,b)=>(a.payDay||0)-(b.payDay||0));
  sorted.forEach(d=>{
    const row=document.createElement('div');row.className='sched-row';
    const isToday=d.payDay===today;
    const isOverdue=d.payDay<today;
    row.innerHTML=`
      <div class="sched-day${isToday?' today':isOverdue?' overdue':''}">${d.payDay}</div>
      <div>
        <div class="sched-name">${d.name}</div>
        <div style="font-size:10px;font-weight:600;color:var(--sub)">${isToday?'🔴 Hôm nay':isOverdue?'Đã qua':'Sắp tới'}</div>
      </div>
      <div class="sched-amt">${fmt(d.monthly)}đ</div>`;
    el.appendChild(row);
  });
}

function renderAnalyze(){
  const el=document.getElementById('analyze-content');
  if(!el) return;
  const totalIncome=income.reduce((s,x)=>s+Number(x.amount),0);
  const totalDebtPay=debts.filter(d=>!d.settled).reduce((s,d)=>s+Number(d.monthly),0);
  const totalExpense=expense.reduce((s,x)=>s+Number(x.amount),0);
  const totalDebtLeft=debts.filter(d=>!d.settled).reduce((s,d)=>s+Number(d.debt),0);

  const debtRatio=totalIncome>0?Math.round(totalDebtPay/totalIncome*100):0;
  const expenseRatio=totalIncome>0?Math.round(totalExpense/totalIncome*100):0;
  const remainRatio=Math.max(0,100-debtRatio-expenseRatio);

  // Health score: 100 - penalties
  let score=100;
  if(debtRatio>50) score-=30;
  else if(debtRatio>35) score-=15;
  else if(debtRatio>20) score-=5;
  if(expenseRatio>60) score-=20;
  else if(expenseRatio>45) score-=10;
  const scoreColor=score>=80?'var(--accent)':score>=60?'var(--orange)':'var(--red)';
  const scoreLabel=score>=80?'Tốt 🟢':score>=60?'Cần cải thiện 🟡':'Rủi ro cao 🔴';

  // Estimate payoff
  let earliestPayoff=null;
  const ms=ticks[currentMonth]||{};
  debts.filter(d=>!d.settled&&d.type==='tc'&&d.totalTerm).forEach(d=>{
    const remaining=d.totalTerm-(d.curTerm||0);
    const n=new Date();
    n.setMonth(n.getMonth()+remaining);
    const label=`${d.name}: ${n.toLocaleDateString('vi-VN',{month:'numeric',year:'numeric'})}`;
    if(!earliestPayoff) earliestPayoff=label;
  });

  el.innerHTML=`
    <div class="analyze-score">
      <div class="analyze-score-num" style="color:${scoreColor}">${score}</div>
      <div class="analyze-score-label">Điểm sức khoẻ tài chính · ${scoreLabel}</div>
    </div>
    <div class="analyze-item"><span class="analyze-key">Tỉ lệ nợ / thu nhập</span><span class="analyze-val" style="color:${debtRatio>40?'var(--red)':'var(--accent)'}">${debtRatio}%</span></div>
    <div class="analyze-item"><span class="analyze-key">Tỉ lệ chi phí / thu nhập</span><span class="analyze-val">${expenseRatio}%</span></div>
    <div class="analyze-item"><span class="analyze-key">Tỉ lệ tự do</span><span class="analyze-val" style="color:var(--purple)">${remainRatio}%</span></div>
    <div class="analyze-item"><span class="analyze-key">Tổng dư nợ còn lại</span><span class="analyze-val">${fmt(totalDebtLeft)}</span></div>
    ${earliestPayoff?`<div class="analyze-item"><span class="analyze-key">Dự kiến tất toán sớm nhất</span><span class="analyze-val" style="font-size:12px">${earliestPayoff}</span></div>`:''}
    <div class="analyze-tip">${
      debtRatio>50?'⚠️ Tỉ lệ nợ trên 50% thu nhập — rủi ro cao. Ưu tiên trả nợ lãi suất cao nhất trước.':
      debtRatio>35?'💡 Tỉ lệ nợ khá cao. Hạn chế chi tiêu phát sinh và tập trung trả nợ.':
      '✅ Tỉ lệ nợ ổn. Duy trì kỷ luật chi tiêu và tăng quỹ tiết kiệm khẩn cấp.'
    }</div>`;
}

// ── SETTINGS ───────────────────────────────────────────────────
function renderSettings(){
  renderFinList('income');
  renderFinList('expense');
  renderDebtList('td');
  renderDebtList('tc');
  const sel=document.getElementById('fmt-select');
  if(sel) sel.value=fmtMode;
  const activeCount=debts.filter(d=>!d.settled).length;
  const sub=document.getElementById('acc-debt-sub');
  if(sub) sub.textContent=`${activeCount} khoản đang hoạt động`;
  const wi=document.getElementById('wallet-base-input');
  if(wi) wi.value=walletBase||'';
  const wsub=document.getElementById('acc-wallet-sub');
  if(wsub) wsub.textContent=walletBase?(walletBase>0?`Điều chỉnh +${fmt(walletBase)}`:`Điều chỉnh ${fmt(walletBase)}`):'Chưa điều chỉnh';
  renderSavingList();
}

window.toggleAcc=function(id){
  const body =document.getElementById('body-'+id);
  const arrow=document.getElementById('arr-'+id);
  if(!body) return;
  const isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  arrow.classList.toggle('open',!isOpen);
};

function renderFinList(mode){
  const items=mode==='income'?income:expense;
  const el=document.getElementById('list-'+mode);
  if(!el) return;
  if(!items.length){el.innerHTML=`<div style="padding:14px;text-align:center;color:var(--sub);font-size:12px;font-weight:700">Chưa có</div>`;return;}
  el.innerHTML='';
  items.forEach((it,i)=>{
    const row=document.createElement('div');row.className='srow';
    if(i<items.length-1) row.style.borderBottom='1px solid var(--border)';
    const ico=mode==='income'?'💵':'🧾';
    const bg =mode==='income'?'rgba(200,255,87,.1)':'rgba(255,87,87,.1)';
    row.innerHTML=`
      <div class="s-ico" style="background:${bg}">${ico}</div>
      <div class="s-info" onclick="openFinEdit('${mode}','${it.id}')">
        <div class="s-name">${it.name}</div>
        <div class="s-val fin-val">${fmt(it.amount)}đ <span style="font-weight:600;color:var(--sub)">${it.note||''}</span></div>
      </div>
      <button class="s-del" onclick="confirmDelFin('${mode}','${it.id}')">✕</button>`;
    el.appendChild(row);
  });
}

function renderDebtList(type){
  const list=debts.filter(d=>d.type===type);
  const el=document.getElementById('list-'+type);
  if(!el) return;
  if(!list.length){el.innerHTML=`<div style="padding:14px;text-align:center;color:var(--sub);font-size:12px;font-weight:700">Chưa có</div>`;return;}
  el.innerHTML='';
  list.forEach((d,i)=>{
    const row=document.createElement('div');row.className='srow';
    if(i<list.length-1) row.style.borderBottom='1px solid var(--border)';
    const ico=type==='td'?'💳':'💰';
    const bg =type==='td'?'rgba(255,179,71,.1)':'rgba(87,200,255,.1)';
    const kySub=type==='tc'&&d.totalTerm?` · Kỳ ${d.curTerm||0}/${d.totalTerm}`:'';
    row.innerHTML=`
      <div class="s-ico" style="background:${bg}">${ico}</div>
      <div class="s-info" onclick="openDebtEdit('${d.id}')">
        <div class="s-name">${d.name}${d.settled?' 🎉':''}</div>
        <div class="s-val">${fmt(d.monthly)}đ/th · Ngày ${d.payDay||'—'}${kySub} · Dư: ${fmt(d.debt)}đ</div>
      </div>
      <button class="s-del" onclick="confirmDelDebt('${d.id}')">✕</button>`;
    el.appendChild(row);
  });
}

// ── DEBT MODAL ─────────────────────────────────────────────────
window.openDebtModal=function(type){
  editDebtId=null;
  document.getElementById('md-title').textContent=type==='td'?'Thêm thẻ tín dụng':'Thêm khoản vay';
  ['md-name','md-debt','md-monthly','md-note','md-payday','md-curterm','md-totalterm'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('md-type').value=type;
  document.getElementById('md-del').style.display='none';
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
  document.getElementById('md-debt').value=d.debt;
  document.getElementById('md-monthly').value=d.monthly;
  document.getElementById('md-note').value=d.note||'';
  document.getElementById('md-payday').value=d.payDay||'';
  document.getElementById('md-curterm').value=d.curTerm||'';
  document.getElementById('md-totalterm').value=d.totalTerm||'';
  document.getElementById('md-del').style.display='block';
  toggleTcFields(d.type);
  document.getElementById('modal-debt').classList.add('open');
};
function toggleTcFields(type){document.getElementById('md-tc-fields').style.display=type==='tc'?'block':'none';}
window.onDebtTypeChange=val=>toggleTcFields(val);
window.confirmDelDebt=id=>window.openDebtEdit(id);
window.saveDebt=async function(){
  const name    =document.getElementById('md-name').value.trim();
  const type    =document.getElementById('md-type').value;
  const debt    =Number(document.getElementById('md-debt').value)||0;
  const monthly =Number(document.getElementById('md-monthly').value)||0;
  const note    =document.getElementById('md-note').value.trim();
  const payDay  =Number(document.getElementById('md-payday').value)||0;
  const curTerm =Number(document.getElementById('md-curterm').value)||0;
  const totalTerm=Number(document.getElementById('md-totalterm').value)||0;
  if(!name){showToast('⚠️ Nhập tên');return;}
  if(!monthly){showToast('⚠️ Nhập số tiền');return;}
  const obj={name,type,debt,monthly,note,payDay};
  if(type==='tc'){obj.curTerm=curTerm;obj.totalTerm=totalTerm;obj.settled=curTerm>=totalTerm&&totalTerm>0;}
  if(editDebtId){const d=debts.find(x=>x.id===editDebtId);if(d)Object.assign(d,obj);}
  else debts.push({id:'d'+Date.now(),...obj});
  await saveToFirestore();closeModal('modal-debt');renderAll();
  showToast(editDebtId?'✓ Đã cập nhật':'✓ Đã thêm');
};
window.deleteDebt=async function(){
  if(!editDebtId||!confirm('Xoá khoản này?'))return;
  debts=debts.filter(x=>x.id!==editDebtId);
  await saveToFirestore();closeModal('modal-debt');renderAll();showToast('🗑 Đã xoá');
};

// ── FINANCE MODAL ──────────────────────────────────────────────
window.openFinModal=function(mode){
  finMode=mode;editFinId=null;
  document.getElementById('mf-title').textContent=mode==='income'?'Thêm thu nhập':'Thêm chi phí';
  ['mf-name','mf-amount','mf-note'].forEach(id=>document.getElementById(id).value='');
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
  document.getElementById('mf-amount').value=it.amount;
  document.getElementById('mf-note').value=it.note||'';
  document.getElementById('mf-del').style.display='block';
  document.getElementById('modal-fin').classList.add('open');
};
window.confirmDelFin=(mode,id)=>window.openFinEdit(mode,id);
window.saveFin=async function(){
  const name  =document.getElementById('mf-name').value.trim();
  const amount=Number(document.getElementById('mf-amount').value)||0;
  const note  =document.getElementById('mf-note').value.trim();
  if(!name){showToast('⚠️ Nhập tên');return;}
  if(!amount){showToast('⚠️ Nhập số tiền');return;}
  const list=finMode==='income'?income:expense;
  if(editFinId){const it=list.find(x=>x.id===editFinId);if(it){it.name=name;it.amount=amount;it.note=note;}}
  else list.push({id:'f'+Date.now(),name,amount,note});
  await saveToFirestore();closeModal('modal-fin');renderAll();
  showToast(editFinId?'✓ Đã cập nhật':'✓ Đã thêm');
};
window.deleteFin=async function(){
  if(!editFinId||!confirm('Xoá?'))return;
  if(finMode==='income') income=income.filter(x=>x.id!==editFinId);
  else expense=expense.filter(x=>x.id!==editFinId);
  await saveToFirestore();closeModal('modal-fin');renderAll();showToast('🗑 Đã xoá');
};

// ── MONTH PICKER ───────────────────────────────────────────────
window.openMonthPicker=function(){
  const yr=currentMonth.split('-')[0];
  document.getElementById('mp-title').textContent=`Chọn tháng — ${yr}`;
  const grid=document.getElementById('mp-grid');grid.innerHTML='';
  for(let m=1;m<=12;m++){
    const key=`${yr}-${String(m).padStart(2,'0')}`;
    const b=document.createElement('div');
    b.className='mpbtn'+(key===currentMonth?' active':'');
    b.textContent=`T${m}`;
    b.onclick=()=>{currentMonth=key;closeModal('modal-month');openDetail=null;renderAll();};
    grid.appendChild(b);
  }
  document.getElementById('modal-month').classList.add('open');
};

// ── UTILS ──────────────────────────────────────────────────────
window.closeModal=id=>document.getElementById(id).classList.remove('open');
window.closeMBg=(id,e)=>{if(e.target===document.getElementById(id))window.closeModal(id);};

window.switchPage=function(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+name)?.classList.add('active');
  document.getElementById('nav-'+name)?.classList.add('active');
  openDetail=null;
  // re-render on tab switch to keep data fresh
  if(name==='home')     renderHome();
  if(name==='paid')     renderPaid();
  if(name==='txn')      renderTxnPage();
  if(name==='tools')    renderTools();
  if(name==='settings') renderSettings();
};

window.resetAll=async function(){
  if(!confirm('Reset toàn bộ về mặc định?'))return;
  debts=clone(DEF_DEBTS);income=clone(DEF_INCOME);expense=clone(DEF_EXPENSE);
  ticks={};txns={};savings=[];walletBase=0;lastAutoMonth='';
  await saveToFirestore();renderAll();showToast('✓ Đã reset');
};

function showToast(msg){
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2200);
}

// ── INIT ───────────────────────────────────────────────────────
initMonth();
fmtMode=localStorage.getItem('vn_fmt')||'short';
