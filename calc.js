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

// ── TC LOAN MATH ──────────────────────────────────────────────
export function tcCalc(principal, ratePerMonth, totalTerm){
  const r=ratePerMonth/100;
  if(!r||!totalTerm) return {monthly:0,totalInterest:0};
  const pmt=principal*r*Math.pow(1+r,totalTerm)/(Math.pow(1+r,totalTerm)-1);
  return {monthly:Math.round(pmt), totalInterest:Math.round(pmt*totalTerm-principal)};
}
export function tcBalance(principal, ratePerMonth, totalTerm, paidTerms){
  const r=ratePerMonth/100;
  if(!r||!totalTerm) return Math.max(0, principal-principal/totalTerm*paidTerms);
  const pmt=principal*r*Math.pow(1+r,totalTerm)/(Math.pow(1+r,totalTerm)-1);
  const balance=principal*Math.pow(1+r,paidTerms)-pmt*(Math.pow(1+r,paidTerms)-1)/r;
  return Math.max(0,Math.round(balance));
}
export function tcGetMonthly(d){
  return tcCalc(d.principal||0, d.rate||0, d.totalTerm||0).monthly;
}
export function tcGetDebt(d){
  return tcBalance(d.principal||0, d.rate||0, d.totalTerm||0, d.curTerm||0);
}
// Trả về {interest, principal} của kỳ hiện tại
export function tcCurrentPayment(d){
  const balance=tcGetDebt(d);
  const r=(d.rate||0)/100;
  const interest=Math.round(balance*r);
  const monthly=tcGetMonthly(d);
  const principal=Math.max(0,monthly-interest);
  return {interest, principal};
}
// Tổng lãi phải trả từ kỳ hiện tại đến hết
export function tcTotalInterest(d){
  const monthly=tcGetMonthly(d);
  const rem=(d.totalTerm||0)-(d.curTerm||0);
  const balance=tcGetDebt(d);
  return Math.max(0,monthly*rem-balance);
}
// Bảng lịch trả nợ (dùng cho Tools)
export function tcScheduleTable(d, maxRows=12){
  const r=(d.rate||0)/100;
  const monthly=tcGetMonthly(d);
  let balance=tcGetDebt(d);
  const rows=[];
  const start=d.curTerm||0;
  const total=d.totalTerm||0;
  for(let i=0;i<maxRows&&start+i<total;i++){
    const interest=Math.round(balance*r);
    const principal=Math.max(0,monthly-interest);
    balance=Math.max(0,balance-principal);
    rows.push({term:start+i+1, monthly, interest, principal, balance});
  }
  return rows;
}
// Migrate lãi suất từ năm sang tháng nếu cần
export function migrateRate(rate){
  if(!rate) return 0;
  // Nếu rate > 5 thì nhiều khả năng là %/năm → đổi sang %/tháng
  return rate>5 ? rate/12 : rate;
}
