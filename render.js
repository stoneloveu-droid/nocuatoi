// ── render.js ─────────────────────────────────────────────────
// Tất cả hàm render UI: home, paid, cards, txn, settings,
// tools, report, charts
// Nhận state qua tham số — không giữ state nội bộ
// ─────────────────────────────────────────────────────────────

import { fmt, fmtNoUnit, getML,
         tcGetMonthly, tcGetDebt, tcCurrentPayment, tcTotalInterest } from "./calc.js";
import { setInputFmt, showToast, setTheme } from "./ui-utils.js";

// ── SECTION / CARD HELPERS ────────────────────────────────────
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

// addCard — legacy (dùng trong vài code path cũ)
export function addCard(wrap,d,ms){
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
        <div class="dd-i"><label>Trả tất toán sớm</label><p>${settleFee?fmt(settleFee):'—'}</p></div>
        <div class="dd-i"><label>Trạng thái</label><p id="ds-${d.id}" style="color:${paid?'var(--accent)':'var(--orange)'}">${paid?'Đã TT ✓':'Chờ TT'}</p></div>
      </div>
      <div class="credit-bar-wrap">
        <div class="credit-bar-labels"><span>0%</span><span>${usedPct}% đã dùng</span><span>100%</span></div>
        <div class="credit-bar-track"><div class="credit-bar-fill" style="width:${usedPct}%;background:${barColor}"></div></div>
      </div>`;
  } else {
    const balance=tcGetDebt(d);
    // FIX: chia thêm /12 vì rate là %/năm
    const r=Number(d.rate||0)/100/12;
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

// Bank color/abbr maps
const BANK_COLORS={'tp':'#B91C1C','ocb':'#D97706','vp-td':'#0369A1','shin-td':'#7C3AED',
  'vp-tc':'#0369A1','shin-tc':'#7C3AED','hsbc':'#B91C1C','vib1':'#059669','vib2':'#059669'};
const BANK_ABBR={'tp':'TP','ocb':'OCB','vp-td':'VP','shin-td':'SH','vp-tc':'VP','shin-tc':'SH','hsbc':'HS','vib1':'VIB','vib2':'VIB'};

export function addCard2(wrap,d,ms){
  const paid=!!ms[d.id], settled=!!d.settled;
  const monthly=d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0);
  const bg=BANK_COLORS[d.id]||'#374151';
  const abbr=BANK_ABBR[d.id]||(d.name.slice(0,2).toUpperCase());

  let sub='';
  if(d.type==='tc'&&d.totalTerm){
    const pct=Math.round((d.curTerm||0)/d.totalTerm*100);
    sub=`Kỳ ${d.curTerm||0}/${d.totalTerm} · ${pct}% · Ngày ${d.payDay||'—'}`;
  } else {
    sub=`${d.note||''} · Ngày ${d.payDay||'—'}`;
  }

  let usageBarHTML='';
  if(d.type==='td'&&d.limit){
    const used=Number(d.used||0), limit=Number(d.limit);
    const usedPct=limit?Math.min(100,Math.round(used/limit*100)):0;
    const barColor=usedPct>80?'var(--red)':usedPct>60?'var(--orange)':'var(--accent)';
    const settle=Number(d.settleFee||0);
    usageBarHTML=`<div class="td-usage">
      <div class="td-usage-track"><div class="td-usage-fill" style="width:${usedPct}%;background:${barColor}"></div></div>
      <div class="td-usage-labels"><span>Đã dùng ${fmt(used)} (${usedPct}%)</span><span>Còn ${fmt(Math.max(0,limit-used))}</span></div>
      ${settle?`<div class="td-settle-fee">Phí tất toán: ${fmt(settle)}</div>`:''}
    </div>`;
  }

  let detailGrid='';
  if(d.type==='tc'){
    const cp=tcCurrentPayment(d);
    detailGrid=`<div class="dd-grid">
      <div class="dd-i"><label>Dư nợ</label><p>${fmt(tcGetDebt(d))}</p></div>
      <div class="dd-i"><label>Lãi/tháng</label><p style="color:var(--orange)">${fmt(cp.interest)}</p></div>
      <div class="dd-i"><label>Trả gốc</label><p style="color:var(--teal)">${fmt(cp.principal)}</p></div>
    </div>`;
  } else {
    const avail=Math.max(0,(d.limit||0)-(d.used||0));
    detailGrid=`<div class="dd-grid">
      <div class="dd-i"><label>Hạn mức</label><p>${fmt(d.limit||0)}</p></div>
      <div class="dd-i"><label>Đã dùng</label><p style="color:var(--orange)">${fmt(d.used||0)}</p></div>
      <div class="dd-i"><label>Còn lại</label><p style="color:var(--accent)">${fmt(avail)}</p></div>
    </div>`;
  }

  const div=document.createElement('div');
  div.className='dcard'+(paid?' paid':'')+(settled?' settled':'');
  div.id='dc-'+d.id;
  div.innerHTML=`
    <div class="dcard-top" onclick="tapTop('${d.id}')">
      <div class="bank-ico" style="background:${bg}">${abbr}</div>
      <div class="d-info">
        <div class="d-name">${d.name}${settled?'<span class="settled-tag">Tất toán</span>':''}</div>
        <div class="d-sub">${sub}</div>
      </div>
      <div class="d-right">
        <div class="d-amt ${d.type}">${fmt(monthly)}</div>
        <div class="d-unit">/ tháng</div>
      </div>
      <button class="chk${paid?' checked':''}" id="cb-${d.id}"
        onclick="event.stopPropagation();tapCheck('${d.id}')">✓</button>
    </div>
    <div class="dcard-detail" id="dd-${d.id}">
      ${detailGrid}
      ${usageBarHTML}
    </div>`;
  wrap.appendChild(div);
}

// ── RENDER HOME ───────────────────────────────────────────────
export function renderHome({debts, income, expense, ticks, txns, savings, walletBase, walletHidden, currentMonth}){
  const el=id=>document.getElementById(id);
  const n=new Date();
  if(el('sub-date')) el('sub-date').textContent=n.toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'numeric'});
  if(el('month-label')) el('month-label').textContent=getML(currentMonth);

  const totalIncome =income.reduce((s,x)=>s+Number(x.amount),0);
  const totalExpense=expense.reduce((s,x)=>s+Number(x.amount),0);
  const totalDebtPay=debts.filter(d=>!d.settled).reduce((s,d)=>s+(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0)),0);
  const monthTxns=txns[currentMonth]||[];
  const txnIn =monthTxns.filter(t=>t.type==='in').reduce((s,t)=>s+Number(t.amount),0);
  const txnOut=monthTxns.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);
  const totalIn =totalIncome+txnIn;
  const totalOut=totalExpense+txnOut;
  const remain  =totalIn-totalOut-totalDebtPay;
  const totalDebtLeft=debts.filter(d=>!d.settled).reduce((s,d)=>s+(d.type==='tc'?tcGetDebt(d):Number(d.used||0)),0);
  const wallet=walletBase+txnIn-txnOut;

  if(el('kpi-income'))   el('kpi-income').textContent=fmt(totalIn);
  if(el('kpi-expense'))  el('kpi-expense').textContent=fmt(totalOut);
  if(el('kpi-debt-pay')) el('kpi-debt-pay').textContent=fmt(totalDebtPay);
  if(el('kpi-remain')){
    el('kpi-remain').textContent=remain>=0?fmt(remain):'-'+fmt(Math.abs(remain));
    el('kpi-remain').style.color=remain>=0?'var(--purple)':'var(--red)';
  }
  if(el('kpi-debt-total')) el('kpi-debt-total').textContent=fmt(totalDebtLeft);
  if(el('kpi-wallet')) el('kpi-wallet').textContent=walletHidden?'••••••':fmt(wallet);

  // Show setup hint if wallet base hasn't been configured
  const hint=el('wc-setup-hint');
  if(hint) hint.style.display=(walletBase===0)?'block':'none';

  const ms=ticks[currentMonth]||{};
  const paidAmt=debts.filter(d=>!d.settled&&ms[d.id]).reduce((s,d)=>s+(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0)),0);
  const pct=totalDebtPay?Math.round(paidAmt/totalDebtPay*100):0;
  const circumference=201;
  const offset=circumference-(circumference*pct/100);
  if(el('circ-fill')) el('circ-fill').style.strokeDashoffset=offset;
  if(el('prog-pct'))  el('prog-pct').textContent=pct+'%';
  if(el('prog-paid-amt'))  el('prog-paid-amt').textContent=fmt(paidAmt);
  if(el('prog-total-amt')) el('prog-total-amt').textContent=fmt(totalDebtPay);

  const today=new Date().getDate();
  const upcoming=debts.filter(d=>!d.settled&&d.payDay&&(d.payDay>=today&&d.payDay<=today+7));
  if(el('upcoming-badge')) el('upcoming-badge').textContent=upcoming.length;
  if(el('upcoming-sub')){
    if(upcoming.length){
      const names=upcoming.map(d=>d.name).join(', ');
      el('upcoming-sub').textContent=`${upcoming.length} khoản nợ trong 7 ngày tới`;
    } else {
      el('upcoming-sub').textContent='Không có khoản nào sắp đến hạn';
    }
  }
  if(el('upcoming-card')) el('upcoming-card').style.display=upcoming.length?'flex':'none';
}

// ── RENDER PAID ───────────────────────────────────────────────
export function renderPaid({debts, ticks, currentMonth, currentFilter}){
  const el=id=>document.getElementById(id);
  if(el('paid-month-label')) el('paid-month-label').textContent=getML(currentMonth);

  const ms=ticks[currentMonth]||{};
  const activeDebts=debts.filter(d=>!d.settled);
  const totalPay=activeDebts.reduce((s,d)=>s+(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0)),0);
  const paidAmt =activeDebts.filter(d=>ms[d.id]).reduce((s,d)=>s+(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0)),0);
  const pct=totalPay?Math.round(paidAmt/totalPay*100):0;

  if(el('ps-total-debt')) el('ps-total-debt').textContent=fmt(totalPay);
  if(el('ps-paid'))       el('ps-paid').textContent=fmt(paidAmt);
  if(el('debt-prog-fill')) el('debt-prog-fill').style.width=pct+'%';
  if(el('debt-prog-pct'))  el('debt-prog-pct').textContent=pct+'%';

  const unpaidCount=activeDebts.filter(d=>!ms[d.id]).length;
  const paidCount  =activeDebts.filter(d=>ms[d.id]).length;
  if(el('badge-unpaid')) el('badge-unpaid').textContent=unpaidCount;
  if(el('badge-paid2'))  el('badge-paid2').textContent=paidCount;

  renderCards({debts, ticks, currentMonth, currentFilter});
}

export function renderCards({debts, ticks, currentMonth, currentFilter}){
  const list=document.getElementById('card-list');
  if(!list) return;
  list.innerHTML='';
  const ms=ticks[currentMonth]||{};
  const hideSettled=localStorage.getItem('vn_hide_settled')!=='0'; // default true
  let show=hideSettled?debts.filter(d=>!d.settled):debts;
  if(currentFilter==='unpaid') show=show.filter(d=>!ms[d.id]&&!d.settled);
  if(currentFilter==='paid2')  show=show.filter(d=>!!ms[d.id]||(!hideSettled&&d.settled));
  if(currentFilter==='td')     show=show.filter(d=>d.type==='td');
  if(currentFilter==='tc')     show=show.filter(d=>d.type==='tc');
  const td=show.filter(d=>d.type==='td');
  const tc=show.filter(d=>d.type==='tc');
  if(!show.length){list.innerHTML='<div class="empty">✅ Tất cả đã xong!</div>';return;}
  const addSection=(title,items)=>{
    const lbl=document.createElement('div');lbl.className='slabel';lbl.textContent=title;list.appendChild(lbl);
    const wrap=document.createElement('div');wrap.className='cards-wrap';list.appendChild(wrap);
    items.forEach(d=>addCard2(wrap,d,ms));
  };
  if(td.length) addSection('💳 Thẻ Tín Dụng',td);
  if(tc.length) addSection('💰 Vay Tín Chấp',tc);
  list.appendChild(Object.assign(document.createElement('div'),{style:'height:8px'}));
}
// Expose for settled toggle
window._renderCards = null; // set by app.js after import

// ── RENDER TXN PAGE ───────────────────────────────────────────
export function renderTxnPage({txns, savings, walletBase, currentMonth, showAllTxnsFlag}){
  const el=id=>document.getElementById(id);
  if(el('txn-month-label')) el('txn-month-label').textContent=getML(currentMonth);
  const monthTxns=txns[currentMonth]||[];
  const txnIn =monthTxns.filter(t=>t.type==='in').reduce((s,t)=>s+Number(t.amount),0);
  const txnOut=monthTxns.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);
  const txnRemain=txnIn-txnOut;
  if(el('txn-kpi-in'))  el('txn-kpi-in').textContent=fmt(txnIn);
  if(el('txn-kpi-out')) el('txn-kpi-out').textContent=fmt(txnOut);
  if(el('txn-kpi-remain')){
    el('txn-kpi-remain').textContent=txnRemain>=0?fmt(txnRemain):'-'+fmt(Math.abs(txnRemain));
    el('txn-kpi-remain').style.color=txnRemain>=0?'var(--teal)':'var(--red)';
  }
  const list=el('txn-list');
  if(list){
    list.innerHTML='';
    if(!monthTxns.length){
      list.innerHTML='<div class="empty" style="padding:20px">Chưa có giao dịch</div>';
    } else {
      const show=[...monthTxns].reverse().slice(0,showAllTxnsFlag?9999:8);
      show.forEach(t=>{
        const row=document.createElement('div');row.className='txn-row';
        row.onclick=()=>window._openTxnEdit&&window._openTxnEdit(t.id);
        const ico=txnCatIcon(t.name,t.type);
        const bg=t.type==='in'?'rgba(76,175,80,.12)':'rgba(255,79,79,.12)';
        row.innerHTML=`
          <div class="txn-cat-ico" style="background:${bg}">${ico}</div>
          <div class="txn-info">
            <div class="txn-name">${t.name}</div>
          </div>
          <div class="txn-amount ${t.type}">${t.type==='in'?'+':'-'}${fmt(t.amount)}</div>`;
        list.appendChild(row);
      });
    }
  }
  if(el('wallet-base-input')&&!el('wallet-base-input').matches(':focus'))
    setInputFmt('wallet-base-input',walletBase);
  renderSavingList(savings);
}

function txnCatIcon(name,type){
  if(type==='in'){
    if(/lương|salary/i.test(name)) return '💼';
    if(/thưởng|bonus/i.test(name)) return '🎁';
    if(/bán/i.test(name)) return '🛒';
    return '💰';
  }
  if(/ăn|food|cơm/i.test(name)) return '🍜';
  if(/xăng|xe|đi lại|di chuyển/i.test(name)) return '🚗';
  if(/mua sắm|shop/i.test(name)) return '🛍️';
  if(/điện|nước|internet/i.test(name)) return '💡';
  if(/y tế|thuốc|bệnh/i.test(name)) return '💊';
  if(/giải trí|cafe|nhà hàng/i.test(name)) return '🎬';
  return '📝';
}

// ── RENDER SAVING LIST ────────────────────────────────────────
export function renderSavingList(savings){
  const el=document.getElementById('saving-hist');if(!el)return;
  el.innerHTML='';
  if(!savings.length){el.innerHTML=`<div style="padding:14px;text-align:center;color:var(--sub);font-size:12px;font-weight:700">Chưa có</div>`;return;}
  [...savings].reverse().forEach(s=>{
    const row=document.createElement('div');row.className='save-row';
    row.innerHTML=`<div class="save-row-left"><div class="save-row-name">${s.name}</div><div class="save-row-date">${s.date||''}</div></div>
      <div style="display:flex;align-items:center;gap:8px"><div class="save-row-amt">+${fmt(s.amount)}</div>
      <button class="s-del" onclick="window.deleteSaving('${s.id}')">✕</button></div>`;
    el.appendChild(row);
  });
  const total=savings.reduce((s,x)=>s+Number(x.amount),0);
  const st=document.getElementById('saving-total');if(st) st.textContent=fmt(total);
}

// ── RENDER SETTINGS ───────────────────────────────────────────
export function renderSettings({debts, income, expense, savings, txns, walletBase, currentMonth, currentTheme}){
  renderFinList('income', income);
  renderFinList('expense', expense);
  renderDebtList('td', debts);
  renderDebtList('tc', debts);
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
  renderSavingList(savings);
  setTheme(currentTheme);
}

function renderFinList(mode, items){
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

function renderDebtList(type, debts){
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

// ── RENDER TOOLS ──────────────────────────────────────────────
export function renderTools({debts, income, expense}){
  renderSchedule(debts);
  renderAnalyze({debts, income, expense});
}

function renderSchedule(debts){
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

function renderAnalyze({debts, income, expense}){
  const el=document.getElementById('analyze-content');if(!el)return;
  const totalIncome  =income.reduce((s,x)=>s+Number(x.amount),0);
  const totalDebtPay =debts.filter(d=>!d.settled).reduce((s,d)=>s+(d.type==='tc'?tcGetMonthly(d):Number(d.monthly||0)),0);
  const totalExpense =expense.reduce((s,x)=>s+Number(x.amount),0);
  const totalDebtLeft=debts.filter(d=>!d.settled).reduce((s,d)=>s+(d.type==='tc'?tcGetDebt(d):Number(d.used||0)),0);
  const debtRatio   =totalIncome>0?Math.round(totalDebtPay/totalIncome*100):0;
  const expenseRatio=totalIncome>0?Math.round(totalExpense/totalIncome*100):0;
  const remainRatio =Math.max(0,100-debtRatio-expenseRatio);

  // FIX UX: Nếu chưa nhập thu nhập, không hiện điểm misleading
  if(!totalIncome){
    el.innerHTML=`<div style="padding:20px;text-align:center;color:var(--sub);font-size:13px;font-weight:700">
      ⚠️ Chưa có dữ liệu thu nhập.<br>Vào <b>Cài đặt → Thu nhập</b> để nhập lương/thu nhập cố định.
    </div>`;
    return;
  }

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

// ── RENDER REPORT ─────────────────────────────────────────────
let donutChart=null, barChart=null;

export function renderReport({debts, income, expense, txns, savings, currentMonth}){
  const el=id=>document.getElementById(id);
  if(el('report-month-label')) el('report-month-label').textContent=getML(currentMonth);
  const m=parseInt(currentMonth.split('-')[1]);
  if(el('rpt-title')) el('rpt-title').textContent=`Tổng quan tháng ${m}`;

  const totalIncome =income.reduce((s,x)=>s+Number(x.amount),0);
  const monthTxns   =txns[currentMonth]||[];
  const txnIn       =monthTxns.filter(t=>t.type==='in').reduce((s,t)=>s+Number(t.amount),0);
  const txnOut      =monthTxns.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);
  const totalIn     =totalIncome+txnIn;
  // FIX: tách fixedExpense để không double-count txnOut trong donut
  const fixedExpense=expense.reduce((s,x)=>s+Number(x.amount),0);
  const totalExpense=fixedExpense+txnOut;
  const totalSaving =savings.reduce((s,x)=>s+Number(x.amount),0);

  if(el('rpt-income'))  el('rpt-income').textContent=fmt(totalIn);
  if(el('rpt-expense')) el('rpt-expense').textContent=fmt(totalExpense);
  if(el('rpt-saving'))  el('rpt-saving').textContent=fmt(totalSaving);

  // FIX: truyền fixedExpense (không có txnOut) vào donut
  renderDonutChart(fixedExpense, monthTxns);
  renderBarChart({income, expense, txns, currentMonth});
}

const CAT_GROUPS=[
  {label:'Ăn uống',   color:'#4CAF50', match:/ăn|food|cơm|phở|nhà hàng|cafe/i},
  {label:'Gia đình',  color:'#2196F3', match:/gia đình|sinh hoạt|nhà/i},
  {label:'Di chuyển', color:'#FF9800', match:/xăng|xe|di chuyển|đi lại/i},
  {label:'Giải trí',  color:'#E91E63', match:/giải trí|phim|game/i},
  {label:'Khác',      color:'#9C27B0', match:/.*/},
];
function categorize(name){
  return CAT_GROUPS.find(c=>c.match.test(name))||CAT_GROUPS[CAT_GROUPS.length-1];
}

function renderDonutChart(fixedExpense, monthTxns){
  const el=id=>document.getElementById(id);
  const outTxns=monthTxns.filter(t=>t.type==='out');
  const cats={};
  outTxns.forEach(t=>{
    const c=categorize(t.name);
    cats[c.label]=(cats[c.label]||{label:c.label,color:c.color,amount:0});
    cats[c.label].amount+=Number(t.amount);
  });
  if(fixedExpense>0){
    cats['Chi cố định']=(cats['Chi cố định']||{label:'Chi cố định',color:'#2196F3',amount:0});
    cats['Chi cố định'].amount+=fixedExpense;
  }
  const data=Object.values(cats).filter(c=>c.amount>0);
  const total=data.reduce((s,c)=>s+c.amount,0)||1;
  if(el('donut-total')) el('donut-total').textContent=fmt(total);

  const canvas=el('donut-chart');
  if(!canvas) return;
  if(donutChart) donutChart.destroy();
  donutChart=new Chart(canvas,{
    type:'doughnut',
    data:{labels:data.map(c=>c.label),datasets:[{data:data.map(c=>c.amount),backgroundColor:data.map(c=>c.color),borderWidth:2,borderColor:'var(--surface)'}]},
    options:{cutout:'70%',plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${fmt(ctx.raw)}`}}},animation:{animateRotate:true,duration:600}}
  });

  const legend=el('donut-legend');
  if(legend){
    legend.innerHTML='';
    data.forEach(c=>{
      const pct=Math.round(c.amount/total*100);
      const row=document.createElement('div');row.className='dl-row';
      row.innerHTML=`<div class="dl-dot" style="background:${c.color}"></div>
        <span class="dl-name">${c.label}</span>
        <span class="dl-pct">${pct}%</span>
        <span class="dl-amt">${fmt(c.amount)}</span>`;
      legend.appendChild(row);
    });
  }
}

function renderBarChart({income, expense, txns, currentMonth}){
  const canvas=document.getElementById('bar-chart');
  if(!canvas) return;
  const labels=[],dataIn=[],dataOut=[];
  const [cy,cm]=currentMonth.split('-').map(Number);
  for(let i=5;i>=0;i--){
    const d=new Date(cy,cm-1-i,1);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    labels.push(`T${d.getMonth()+1}`);
    const mt=txns[key]||[];
    const inc=income.reduce((s,x)=>s+Number(x.amount),0)+mt.filter(t=>t.type==='in').reduce((s,t)=>s+Number(t.amount),0);
    const exp=expense.reduce((s,x)=>s+Number(x.amount),0)+mt.filter(t=>t.type==='out').reduce((s,t)=>s+Number(t.amount),0);
    dataIn.push(+(inc/1e6).toFixed(1));
    dataOut.push(+(exp/1e6).toFixed(1));
  }
  if(barChart) barChart.destroy();
  barChart=new Chart(canvas,{
    type:'bar',
    data:{labels,datasets:[
      {label:'Thu',data:dataIn,backgroundColor:'rgba(76,175,80,.7)',borderRadius:6,borderSkipped:false},
      {label:'Chi',data:dataOut,backgroundColor:'rgba(244,67,54,.7)',borderRadius:6,borderSkipped:false},
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.raw}M`}}},
      scales:{
        x:{grid:{display:false},ticks:{color:'var(--sub)',font:{size:11,weight:'600'}}},
        y:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'var(--sub)',font:{size:10},callback:v=>v+'M'}}
      }
    }
  });
}
