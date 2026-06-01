// ── FORMAT MONEY ─────────────────────────────────────────────
export function fmt(n){
  n=Math.round(Number(n)||0);
  return n.toLocaleString('vi-VN')+'đ';
}
export function fmtNoUnit(n){
  n=Math.round(Number(n)||0);
  return n.toLocaleString('vi-VN');
}
export function getML(k){
  const[y,m]=k.split('-');
  return `T${parseInt(m)}/${y}`;
}

// ─────────────────────────────────────────────────────────────
// LOAN MATH — BIDV style
//
// method: 'fixed_principal'  → Gốc cố định (trả đều gốc, lãi giảm dần)
// method: 'reducing_balance' → Dư nợ giảm dần / PMT (trả đều tổng)
//
// rate đầu vào: %/năm  →  hàm tự chia 12
// ─────────────────────────────────────────────────────────────

/**
 * Tính tiền trả 1 kỳ cụ thể (kỳ thứ `term`, bắt đầu từ 1).
 * Trả về { total, principal, interest, balance }
 */
export function tcPaymentAtTerm(principal, rateYearly, totalTerm, method, term){
  const r = rateYearly / 100 / 12;
  const P = Number(principal)||0;
  const n = Number(totalTerm)||1;
  const t = Number(term)||1;

  if(method==='fixed_principal'){
    const principalPerTerm = P / n;
    const balance0 = P - principalPerTerm * (t - 1);   // dư nợ đầu kỳ t
    const interest  = Math.round(balance0 * r);
    const princ     = Math.round(principalPerTerm);
    return {
      total:     princ + interest,
      principal: princ,
      interest,
      balance:   Math.max(0, Math.round(balance0 - princ)),
    };
  } else {
    // Dư nợ giảm dần — PMT cố định
    if(!r) {
      const princ = Math.round(P / n);
      const balance = Math.max(0, P - princ * t);
      return { total: princ, principal: princ, interest: 0, balance };
    }
    const pmt     = P * r * Math.pow(1+r, n) / (Math.pow(1+r, n) - 1);
    const balance0= P * Math.pow(1+r, t-1) - pmt * (Math.pow(1+r, t-1) - 1) / r;
    const interest = Math.round(balance0 * r);
    const princ    = Math.round(pmt) - interest;
    const balance  = Math.max(0, Math.round(balance0 - princ));
    return {
      total:     Math.round(pmt),
      principal: princ,
      interest,
      balance,
    };
  }
}

/**
 * Tính tiền trả tháng hiện tại (kỳ = curTerm + 1).
 * Trả về { monthly, principal, interest, balance }
 */
export function tcCurrentPayment(d){
  const term = (Number(d.curTerm)||0) + 1;
  const method = d.method || 'reducing_balance';
  const res = tcPaymentAtTerm(d.principal, d.rate, d.totalTerm, method, term);
  return { monthly: res.total, principal: res.principal, interest: res.interest, balance: res.balance };
}

/**
 * Dư nợ còn lại sau `paidTerms` kỳ.
 */
export function tcBalance(principal, rateYearly, totalTerm, method, paidTerms){
  const r = rateYearly / 100 / 12;
  const P = Number(principal)||0;
  const n = Number(totalTerm)||1;
  const k = Number(paidTerms)||0;
  if(k<=0) return P;
  if(k>=n) return 0;

  if(method==='fixed_principal'){
    return Math.max(0, Math.round(P - P/n * k));
  } else {
    if(!r) return Math.max(0, Math.round(P - P/n * k));
    const pmt = P * r * Math.pow(1+r, n) / (Math.pow(1+r, n) - 1);
    const bal = P * Math.pow(1+r, k) - pmt * (Math.pow(1+r, k) - 1) / r;
    return Math.max(0, Math.round(bal));
  }
}

/**
 * Tổng lãi phải trả suốt vòng đời khoản vay.
 */
export function tcTotalInterest(principal, rateYearly, totalTerm, method){
  const r = rateYearly / 100 / 12;
  const P = Number(principal)||0;
  const n = Number(totalTerm)||1;
  if(method==='fixed_principal'){
    // Σ lãi = Σ_{t=1..n} [ (P - P/n*(t-1)) * r ]
    let total=0;
    for(let t=1;t<=n;t++) total += (P - P/n*(t-1)) * r;
    return Math.round(total);
  } else {
    if(!r) return 0;
    const pmt = P * r * Math.pow(1+r, n) / (Math.pow(1+r, n) - 1);
    return Math.round(pmt * n - P);
  }
}

/**
 * Bảng kế hoạch trả nợ đầy đủ (dùng trong Tiện ích).
 * Trả về mảng { term, total, principal, interest, balance }
 */
export function tcScheduleTable(principal, rateYearly, totalTerm, method){
  const rows = [];
  for(let t=1; t<=totalTerm; t++){
    const row = tcPaymentAtTerm(principal, rateYearly, totalTerm, method, t);
    rows.push({ term: t, ...row });
  }
  return rows;
}

// ── Shorthand dùng trong app.js ───────────────────────────────
export function tcGetMonthly(d){
  return tcCurrentPayment(d).monthly;
}
export function tcGetDebt(d){
  return tcBalance(d.principal, d.rate, d.totalTerm, d.method||'reducing_balance', d.curTerm||0);
}

// ── MIGRATE: rate %/tháng → %/năm ─────────────────────────────
// Dữ liệu cũ lưu rate là %/tháng (VD: 1.5).
// Nếu rate <= 5 thì có thể là %/tháng, nhân 12 để ra %/năm.
export function migrateRate(d){
  if(d.type==='tc' && d.rate && d.rate <= 5 && !d.rateConverted){
    d.rate = Math.round(d.rate * 12 * 100) / 100; // VD: 1.5 → 18
    d.rateConverted = true;
  }
}
