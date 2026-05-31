import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── FIREBASE CONFIG ───────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyA1Pde18_aLXilbvs1Q0fWbVtcApkAdJcs",
  authDomain: "vicuatoi.firebaseapp.com",
  projectId: "vicuatoi",
  storageBucket: "vicuatoi.firebasestorage.app",
  messagingSenderId: "490747827741",
  appId: "1:490747827741:web:ea97898cec463d3d6f18f4"
};
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── DEFAULT DATA ──────────────────────────────────────────────
const DEF_DEBTS = [
  {id:'tp',      name:'TP Bank',     type:'td', debt:12000000,  monthly:216000,  note:'1.80%/th',   payDay:15},
  {id:'ocb',     name:'OCB Bank',    type:'td', debt:36300000,  monthly:834900,  note:'2.30%/th',   payDay:20},
  {id:'vp-td',   name:'VP Bank TD',  type:'td', debt:40500000,  monthly:202500,  note:'0.50%/th',   payDay:10},
  {id:'shin-td', name:'Shinhan TD',  type:'td', debt:24500000,  monthly:318500,  note:'1.30%/th',   payDay:25},
  {id:'vp-tc',   name:'VP Bank TC',  type:'tc', debt:17227509,  monthly:1113000, curTerm:13, totalTerm:35, payDay:5},
  {id:'shin-tc', name:'Shinhan TC',  type:'tc', debt:29776139,  monthly:2312000, curTerm:46, totalTerm:60, payDay:8},
  {id:'hsbc',    name:'HSBC Bank',   type:'tc', debt:31962457,  monthly:2991000, curTerm:49, totalTerm:60, payDay:12},
  {id:'vib1',    name:'VIB Bank 1',  type:'tc', debt:34200505,  monthly:2616000, curTerm:46, totalTerm:60, payDay:15},
  {id:'vib2',    name:'VIB Bank 2',  type:'tc', debt:28926071,  monthly:1417000, curTerm:11, totalTerm:36, payDay:20},
];
const DEF_INCOME  = [{id:'sal', name:'Lương cơ bản', amount:12000000, note:'Hàng tháng'}];
const DEF_EXPENSE = [{id:'living', name:'Sinh hoạt / gia đình', amount:8200000, note:'Cố định'}];

const SUGGEST_IN  = ['Thưởng','Freelance','Bán đồ','Hoàn tiền','Thu nợ','Lãi tiết kiệm','Quà tặng','Khác'];
const SUGGEST_OUT = ['Ăn uống','Di chuyển','Mua sắm','Y tế','Sửa chữa','Giải trí','Học phí','Tiền điện nước','Khác'];

// ── STATE ─────────────────────────────────────────────────────
let debts=[], income=[], expense=[], ticks={};
let txns={};          // {YYYY-MM: [{id,name,amount,type:'in'|'out'}]}
let savings=[];       // [{id,name,amount,date}]
let walletBase=0;     // số dư ban đầu nhập tay
let lastAutoMonth=''; // tháng cuối đã auto-reduce nợ

let currentMonth='', currentFilter='all', openDetail=null;
let editDebtId=null, editFinId=null, finMode='income';
let editTxnId=null, txnType='out';
let uid=null;
let fmtMode='short';

function clone(x){return JSON.parse(JSON.stringify(x));}

// ── FORMAT ────────────────────────────────────────────────────
function fmt(n){
  n=Number(n)||0;
  if(fmtMode==='full') return n.toLocaleString('vi-VN')+'đ';
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
window.changeFmt=function(val){fmtMode=val;localStorage.setItem('vn_fmt',val);renderHome();renderSettings();};

function getML(k){const[y,m]=k.split('-');return `T${parseInt(m)}/${y}`;}
function initMonth(){
  const n=new Date();
  currentMonth=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
}

// ── FIRESTORE ─────────────────────────────────────────────────
function userDoc(){return doc(db,'users',uid);}

async function loadFromFirestore(){
  setSyncBadge('syncing','Đang tải…');
  try {
    const snap=await getDoc(userDoc());
    if(snap.exists()){
      const d=snap.data();
      debts         = d.debts         || clone(DEF_DEBTS);
      income        = d.income        || clone(DEF_INCOME);
      expense       = d.expense       || clone(DEF_EXPENSE);
      ticks         = d.ticks         || {};
      txns          = d.txns          || {};
      savings       = d.savings       || [];
      walletBase    = d.walletBase    || 0;
      lastAutoMonth = d.lastAutoMonth || '';
    } else {
      debts=clone(DEF_DEBTS);income=clone(DEF_INCOME);expense=clone(DEF_EXPENSE);
      ticks={};txns={};savings=[];walletBase=0;lastAutoMonth='';
      await saveToFirestore();
    }
    // Migrate old TC debts that use note="Kỳ X/Y" format to structured fields
    debts.forEach(d=>{
      if(d.type==='tc' && d.note && !d.curTerm){
        const m=d.note.match(/^Kỳ\s*(\d+)\/(\d+)$/);
        if(m){d.curTerm=parseInt(m[1]);d.totalTerm=parseInt(m[2]);d.note='';}
      }
    });
    autoReduceDebts();
    setSyncBadge('synced','Đã đồng bộ');
    renderHome();renderSettings();
  } catch(e){setSyncBadge('error','Lỗi kết nối');console.error(e);}
}

async function saveToFirestore(){
  if(!uid)return;
  setSyncBadge('syncing','Đang lưu…');
  try {
    await setDoc(userDoc(),{debts,income,expense,ticks,txns,savings,walletBase,lastAutoMonth},{merge:true});
    setSyncBadge('synced','Đã đồng bộ');
  } catch(e){setSyncBadge('error','Lỗi lưu');console.error(e);}
}

function setSyncBadge(cls,txt){
  const b=document.getElementById('sync-badge');
  b.className='sync-badge '+cls;
  document.getElementById('sync-text').textContent=txt;
}

// ── AUTO REDUCE DEBTS mỗi tháng ──────────────────────────────
// Chạy 1 lần khi mở app, nếu tháng hiện tại chưa được xử lý
function autoReduceDebts(){
  if(lastAutoMonth===currentMonth) return; // đã xử lý tháng này rồi
  debts.forEach(d=>{
    if(d.settled) return;
    // Giảm dư nợ
    d.debt=Math.max(0,(Number(d.debt)||0)-(Number(d.monthly)||0));
    // Tăng kỳ cho TC
    if(d.type==='tc' && d.totalTerm){
      d.curTerm=Math.min((d.curTerm||0)+1, d.totalTerm);
      if(d.curTerm>=d.totalTerm) d.settled=true;
    }
    // Reset tick tháng mới (ticks lưu theo tháng nên tự về {} cho tháng mới)
  });
  lastAutoMonth=currentMonth;
  saveToFirestore();
}

// ── AUTH ──────────────────────────────────────────────────────
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
  await signOut(auth);
};

onAuthStateChanged(auth,async(user)=>{
  const overlay  =document.getElementById('loading-overlay');
  const authPage =document.getElementById('auth-page');
  const homePage =document.getElementById('page-home');
  const settPage =document.getElementById('page-settings');
  const bnav     =document.querySelector('.bnav');
  if(user){
    uid=user.uid;
    document.getElementById('acc-name').textContent =user.displayName||(user.isAnonymous?'Ẩn danh':'Người dùng');
    document.getElementById('acc-email').textContent=user.email||(user.isAnonymous?'Không đăng nhập':'—');
    authPage.classList.remove('active');
    homePage.classList.add('active');
    bnav.style.display='flex';
    await loadFromFirestore();
    overlay.classList.add('hidden');
  } else {
    uid=null;
    overlay.classList.add('hidden');
    authPage.classList.add('active');
    homePage.classList.remove('active');
    settPage.classList.remove('active');
    bnav.style.display='none';
  }
});

// ── RENDER HOME ───────────────────────────────────────────────
function renderHome(){
  const n=new Date();
  document.getElementById('sub-date').textContent=
    n.toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'numeric'});
  document.getElementById('month-label').textContent=getML(currentMonth);

  const totalIncome =income.reduce((s,x)=>s+Number(x.amount),0);
  const totalExpense=expense.reduce((s,x)=>s+Number(x.amount),0);
  const totalDebtPay=debts.filter(d=>!d.settled).reduce((s,d)=>s+Number(d.monthly),0);

  // Thu/Chi đột xuất tháng này
  const monthTxns=txns[currentMonth]||[];
  const txnIn =monthTxns.filter(t=>t.type==='in') .reduce((s,t)=>s+Number(t.amount),0);
  const txnOut=monthTxns.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);

  const totalIn =totalIncome+txnIn;
  const totalOut=totalExpense+txnOut;

  // Tổng dư nợ còn lại
  const totalDebtLeft=debts.filter(d=>!d.settled).reduce((s,d)=>s+Number(d.debt),0);

  // Tiền trong túi = số dư ban đầu + thu đột xuất - chi đột xuất
  const wallet=walletBase+txnIn-txnOut;

  // Tiết kiệm
  const totalSaving=savings.reduce((s,x)=>s+Number(x.amount),0);

  document.getElementById('kpi-income').textContent   =fmt(totalIn);
  document.getElementById('kpi-expense').textContent  =fmt(totalOut);
  document.getElementById('kpi-wallet').textContent   =fmt(wallet);
  document.getElementById('kpi-saving').textContent   =fmt(totalSaving);
  document.getElementById('kpi-debt-total').textContent=fmt(totalDebtLeft);

  // Ratio bar (chi / trả nợ / còn lại theo thu nhập)
  if(totalIncome>0){
    const ep=Math.min(totalOut/totalIncome*100,100);
    const dp=Math.min(totalDebtPay/totalIncome*100,Math.max(0,100-ep));
    const fp=Math.max(100-ep-dp,0);
    document.getElementById('rb-expense').style.width=ep+'%';
    document.getElementById('rb-debt').style.width   =dp+'%';
    document.getElementById('rb-free').style.width   =fp+'%';
  }

  // Progress trả nợ tháng này
  const ms=ticks[currentMonth]||{};
  const paidAmt=debts.filter(d=>!d.settled&&ms[d.id]).reduce((s,d)=>s+Number(d.monthly),0);
  const pct=totalDebtPay?Math.round(paidAmt/totalDebtPay*100):0;
  document.getElementById('prog-fill').style.width=pct+'%';
  document.getElementById('prog-pct').textContent =pct+'%';

  renderCards();
}

// ── RENDER CARDS ──────────────────────────────────────────────
function renderCards(){
  const list=document.getElementById('card-list');list.innerHTML='';
  const ms=ticks[currentMonth]||{};
  let show=debts;
  if(currentFilter==='td')    show=debts.filter(d=>d.type==='td');
  if(currentFilter==='tc')    show=debts.filter(d=>d.type==='tc');
  if(currentFilter==='unpaid')show=debts.filter(d=>!ms[d.id]&&!d.settled);

  const td=show.filter(d=>d.type==='td');
  const tc=show.filter(d=>d.type==='tc');
  if(!show.length){list.innerHTML=`<div class="empty">✅ Tháng này xong rồi!</div>`;return;}
  if(td.length){addSec(list,'💳 Thẻ Tín Dụng');const w=lastWrap(list);td.forEach(d=>addCard(w,d,ms));}
  if(tc.length){addSec(list,'💰 Vay Tín Chấp'); const w=lastWrap(list);tc.forEach(d=>addCard(w,d,ms));}
  const sp=document.createElement('div');sp.style.height='12px';list.appendChild(sp);
}

function addSec(list,txt){
  const h=document.createElement('div');h.className='slabel';h.textContent=txt;list.appendChild(h);
  const w=document.createElement('div');w.className='cards';list.appendChild(w);
}
function lastWrap(list){const ws=list.querySelectorAll('.cards');return ws[ws.length-1];}

function debtMeta(d){
  if(d.type==='tc'&&d.totalTerm) return `Kỳ ${d.curTerm||0}/${d.totalTerm}${d.payDay?' · Ngày '+d.payDay:''}`;
  return (d.note||'')+(d.payDay?' · Ngày '+d.payDay:'');
}

function addCard(wrap,d,ms){
  const paid=!!ms[d.id];
  const settled=!!d.settled;
  const div=document.createElement('div');
  div.className='dcard'+(paid?' paid':'')+(settled?' settled':'');
  div.id='dc-'+d.id;

  const debtRemain=fmt(d.debt);
  const pct=d.type==='tc'&&d.totalTerm?Math.round((d.curTerm||0)/d.totalTerm*100):null;

  div.innerHTML=`
    <div class="dcard-top" onclick="tapTop('${d.id}')">
      <div class="d-dot ${paid?'ok':d.type}"></div>
      <div class="d-info">
        <div class="d-name">${d.name}${settled?' <span class="settled-label">Tất toán</span>':''}</div>
        <div class="d-meta" id="dm-${d.id}">${debtMeta(d)}</div>
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
        <div class="dd-i"><label>Dư nợ</label><p>${debtRemain}đ</p></div>
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

// ── TAP TOP / CHECK ───────────────────────────────────────────
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

  if(cb){cb.className='chk'+(paid?' checked pop':'');}
  if(dc) dc.className='dcard'+(paid?' paid':'')+(d?.settled?' settled':'');
  if(ds){ds.style.color=paid?'var(--accent)':'var(--orange)';ds.textContent=paid?'Đã TT ✓':'Chờ TT';}
  if(dot){dot.className='d-dot '+(paid?'ok':d?.type||'');}
  setTimeout(()=>{const b=document.getElementById('cb-'+id);if(b)b.classList.remove('pop');},250);

  showToast(paid?`✓ ${d?.name} đã thanh toán`:`↩ ${d?.name} bỏ tick`);

  // update progress bar
  const totalDebtPay=debts.filter(x=>!x.settled).reduce((s,x)=>s+Number(x.monthly),0);
  const paidAmt=debts.filter(x=>!x.settled&&ticks[currentMonth]?.[x.id]).reduce((s,x)=>s+Number(x.monthly),0);
  const pct=totalDebtPay?Math.round(paidAmt/totalDebtPay*100):0;
  document.getElementById('prog-fill').style.width=pct+'%';
  document.getElementById('prog-pct').textContent=pct+'%';

  if(currentFilter==='unpaid') setTimeout(()=>{openDetail=null;renderCards();},500);
  await saveToFirestore();
};

window.filterTab=function(f,el){
  currentFilter=f;openDetail=null;
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');renderCards();
};

// ── TXN (THU / CHI ĐỘT XUẤT) ─────────────────────────────────
window.openTxnModal=function(){
  editTxnId=null;txnType='out';
  document.getElementById('txn-name').value='';
  document.getElementById('txn-amount').value='';
  setTxnType('out');
  document.getElementById('txn-del').style.display='none';
  document.getElementById('modal-txn').classList.add('open');
  setTimeout(()=>document.getElementById('txn-amount').focus(),350);
};

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
  closeModal('modal-txn');renderHome();
  showToast(txnType==='in'?`✓ +${fmt(amount)} Thu`:`✓ -${fmt(amount)} Chi`);
};

window.deleteTxn=async function(){
  if(!editTxnId||!confirm('Xoá?'))return;
  txns[currentMonth]=(txns[currentMonth]||[]).filter(x=>x.id!==editTxnId);
  await saveToFirestore();closeModal('modal-txn');renderHome();showToast('🗑 Đã xoá');
};

// ── SETTINGS RENDER ───────────────────────────────────────────
function renderSettings(){
  renderFinList('income');renderFinList('expense');
  renderDebtList('td');renderDebtList('tc');
  const sel=document.getElementById('fmt-select');if(sel)sel.value=fmtMode;
  document.getElementById('wallet-base-input').value=walletBase||'';
  renderSavingList();
}

function renderFinList(mode){
  const items=mode==='income'?income:expense;
  const el=document.getElementById('list-'+mode);
  if(!items.length){el.innerHTML=`<div style="padding:14px;text-align:center;color:var(--sub);font-size:12px;font-weight:700">Chưa có</div>`;return;}
  el.innerHTML='';
  items.forEach((it,i)=>{
    const row=document.createElement('div');row.className='srow';
    if(i<items.length-1)row.style.borderBottom='1px solid var(--border)';
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
  if(!list.length){el.innerHTML=`<div style="padding:14px;text-align:center;color:var(--sub);font-size:12px;font-weight:700">Chưa có</div>`;return;}
  el.innerHTML='';
  list.forEach((d,i)=>{
    const row=document.createElement('div');row.className='srow';
    if(i<list.length-1)row.style.borderBottom='1px solid var(--border)';
    const ico=type==='td'?'💳':'💰';
    const bg =type==='td'?'rgba(255,179,71,.1)':'rgba(87,200,255,.1)';
    const kySub=type==='tc'&&d.totalTerm?` · Kỳ ${d.curTerm||0}/${d.totalTerm}`:'';
    const settledTag=d.settled?' 🎉':'';
    row.innerHTML=`
      <div class="s-ico" style="background:${bg}">${ico}</div>
      <div class="s-info" onclick="openDebtEdit('${d.id}')">
        <div class="s-name">${d.name}${settledTag}</div>
        <div class="s-val">${fmt(d.monthly)}đ/th · Ngày ${d.payDay||'—'}${kySub} · Dư: ${fmt(d.debt)}đ</div>
      </div>
      <button class="s-del" onclick="confirmDelDebt('${d.id}')">✕</button>`;
    el.appendChild(row);
  });
}

function renderSavingList(){
  const el=document.getElementById('saving-hist');
  el.innerHTML='';
  if(!savings.length){
    el.innerHTML=`<div style="padding:14px;text-align:center;color:var(--sub);font-size:12px;font-weight:700">Chưa có khoản nào</div>`;
    return;
  }
  [...savings].reverse().forEach(s=>{
    const row=document.createElement('div');row.className='save-row';
    row.innerHTML=`
      <div class="save-row-left">
        <div class="save-row-name">${s.name||'Tiết kiệm'}</div>
        <div class="save-row-date">${s.date||''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="save-row-amt">+${fmt(s.amount)}đ</div>
        <button class="s-del" onclick="deleteSaving('${s.id}')">✕</button>
      </div>`;
    el.appendChild(row);
  });
  const total=savings.reduce((s,x)=>s+Number(x.amount),0);
  document.getElementById('saving-total').textContent=fmt(total)+'đ';
}

// ── WALLET BASE ───────────────────────────────────────────────
window.saveWalletBase=async function(){
  const v=Number(document.getElementById('wallet-base-input').value)||0;
  walletBase=v;
  await saveToFirestore();renderHome();showToast('✓ Đã lưu số dư');
};

// ── SAVING ────────────────────────────────────────────────────
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
  const now=new Date();
  const date=now.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'});
  savings.push({id:'sv'+Date.now(),name,amount,date});
  await saveToFirestore();closeModal('modal-saving');renderSettings();renderHome();
  showToast(`✓ Tiết kiệm +${fmt(amount)}đ`);
};

window.deleteSaving=async function(id){
  if(!confirm('Xoá khoản tiết kiệm này?'))return;
  savings=savings.filter(x=>x.id!==id);
  await saveToFirestore();renderSettings();renderHome();showToast('🗑 Đã xoá');
};

// ── DEBT MODAL ────────────────────────────────────────────────
window.openDebtModal=function(type){
  editDebtId=null;
  document.getElementById('md-title').textContent=type==='td'?'Thêm thẻ tín dụng':'Thêm khoản vay';
  document.getElementById('md-name').value='';
  document.getElementById('md-type').value=type;
  document.getElementById('md-debt').value='';
  document.getElementById('md-monthly').value='';
  document.getElementById('md-note').value='';
  document.getElementById('md-payday').value='';
  document.getElementById('md-curterm').value='';
  document.getElementById('md-totalterm').value='';
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
function toggleTcFields(type){
  document.getElementById('md-tc-fields').style.display=type==='tc'?'block':'none';
}
window.onDebtTypeChange=function(val){toggleTcFields(val);};
window.confirmDelDebt=id=>window.openDebtEdit(id);
window.saveDebt=async function(){
  const name   =document.getElementById('md-name').value.trim();
  const type   =document.getElementById('md-type').value;
  const debt   =Number(document.getElementById('md-debt').value)||0;
  const monthly=Number(document.getElementById('md-monthly').value)||0;
  const note   =document.getElementById('md-note').value.trim();
  const payDay =Number(document.getElementById('md-payday').value)||0;
  const curTerm   =Number(document.getElementById('md-curterm').value)||0;
  const totalTerm =Number(document.getElementById('md-totalterm').value)||0;
  if(!name){showToast('⚠️ Nhập tên');return;}
  if(!monthly){showToast('⚠️ Nhập số tiền');return;}
  const obj={name,type,debt,monthly,note,payDay};
  if(type==='tc'){obj.curTerm=curTerm;obj.totalTerm=totalTerm;obj.settled=curTerm>=totalTerm&&totalTerm>0;}
  if(editDebtId){
    const d=debts.find(x=>x.id===editDebtId);
    if(d)Object.assign(d,obj);
  } else {
    debts.push({id:'d'+Date.now(),...obj});
  }
  await saveToFirestore();closeModal('modal-debt');renderSettings();renderHome();
  showToast(editDebtId?'✓ Đã cập nhật':'✓ Đã thêm');
};
window.deleteDebt=async function(){
  if(!editDebtId||!confirm('Xoá khoản này?'))return;
  debts=debts.filter(x=>x.id!==editDebtId);
  await saveToFirestore();closeModal('modal-debt');renderSettings();renderHome();showToast('🗑 Đã xoá');
};

// ── FINANCE MODAL ─────────────────────────────────────────────
window.openFinModal=function(mode){
  finMode=mode;editFinId=null;
  document.getElementById('mf-title').textContent=mode==='income'?'Thêm thu nhập':'Thêm chi phí';
  document.getElementById('mf-name').value='';
  document.getElementById('mf-amount').value='';
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
  await saveToFirestore();closeModal('modal-fin');renderSettings();renderHome();
  showToast(editFinId?'✓ Đã cập nhật':'✓ Đã thêm');
};
window.deleteFin=async function(){
  if(!editFinId||!confirm('Xoá?'))return;
  if(finMode==='income')income=income.filter(x=>x.id!==editFinId);
  else expense=expense.filter(x=>x.id!==editFinId);
  await saveToFirestore();closeModal('modal-fin');renderSettings();renderHome();showToast('🗑 Đã xoá');
};

// ── MONTH PICKER ──────────────────────────────────────────────
window.openMonthPicker=function(){
  const yr=currentMonth.split('-')[0];
  document.getElementById('mp-title').textContent=`Chọn tháng — ${yr}`;
  const grid=document.getElementById('mp-grid');grid.innerHTML='';
  for(let m=1;m<=12;m++){
    const key=`${yr}-${String(m).padStart(2,'0')}`;
    const b=document.createElement('div');
    b.className='mpbtn'+(key===currentMonth?' active':'');
    b.textContent=`T${m}`;
    b.onclick=()=>{currentMonth=key;closeModal('modal-month');openDetail=null;renderHome();};
    grid.appendChild(b);
  }
  document.getElementById('modal-month').classList.add('open');
};

// ── UTILS ─────────────────────────────────────────────────────
window.closeModal=id=>document.getElementById(id).classList.remove('open');
window.closeMBg=(id,e)=>{if(e.target===document.getElementById(id))window.closeModal(id);};

window.switchPage=function(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni,.fab-wrap').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  document.getElementById('nav-'+name)?.classList.add('active');
  openDetail=null;
  if(name==='settings')renderSettings();
  if(name==='home')renderHome();
};

window.resetAll=async function(){
  if(!confirm('Reset toàn bộ về mặc định?'))return;
  debts=clone(DEF_DEBTS);income=clone(DEF_INCOME);expense=clone(DEF_EXPENSE);
  ticks={};txns={};savings=[];walletBase=0;lastAutoMonth='';
  await saveToFirestore();renderSettings();renderHome();showToast('✓ Đã reset');
};

function showToast(msg){
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2200);
}

// ── INIT ──────────────────────────────────────────────────────
initMonth();
fmtMode=localStorage.getItem('vn_fmt')||'short';
