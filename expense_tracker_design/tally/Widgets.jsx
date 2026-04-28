/* Chart, donut, activity, bills, budgets */
const { useState: useSC, useMemo: useMC } = React;

window.SpendChart = function SpendChart({ data, range }) {
  const { fmtUSD, parseDate } = window.Utils;
  const [hover, setHover] = useSC(null);

  const { series, totalIn, totalOut, max } = useMC(() => {
    const nDays = range === '7D' ? 7 : range === '30D' ? 30 : range === '90D' ? 90 : 365;
    const today = new Date(data.today); today.setHours(0,0,0,0);
    const days = [];
    for (let i = nDays - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      days.push({ date: d, key: d.toISOString().slice(0,10), income: 0, expense: 0 });
    }
    const map = new Map(days.map(d => [d.key, d]));
    let totalIn = 0, totalOut = 0;
    for (const t of data.transactions) {
      if (t.type === 'transfer') continue;
      const b = map.get(t.date); if (!b) continue;
      if (t.type === 'income') { b.income += t.amount; totalIn += t.amount; }
      else { b.expense += t.amount; totalOut += t.amount; }
    }
    const max = Math.max(...days.map(d => Math.max(d.income, d.expense)), 100);
    return { series: days, totalIn, totalOut, max };
  }, [data, range]);

  const W = 760, H = 240, padX = 16, padTop = 16, padBot = 28;
  const chartW = W - padX*2, chartH = H - padTop - padBot;
  const n = series.length, slotW = chartW / n, barW = Math.max(2, Math.min(14, slotW * 0.4));
  const yFor = v => padTop + chartH - (v / max) * chartH;

  const smoothed = useMC(() => {
    const out = []; const win = Math.max(2, Math.floor(n / 14));
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i-win); j <= Math.min(n-1, i+win); j++) { s += series[j].expense; c++; }
      out.push(s/c);
    }
    return out;
  }, [series, n]);

  const linePath = smoothed.map((v,i) => `${i===0?'M':'L'}${(padX + slotW*i + slotW/2).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
  const areaPath = linePath + ` L${(padX+chartW).toFixed(1)},${padTop+chartH} L${padX.toFixed(1)},${padTop+chartH} Z`;

  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(n-1, Math.floor((x - padX) / slotW))));
  };

  const ticks = useMC(() => {
    const k = n <= 7 ? n : n <= 30 ? 5 : 6;
    const step = Math.max(1, Math.floor(n / k));
    const out = []; for (let i = 0; i < n; i += step) out.push(i);
    if (out[out.length-1] !== n-1) out.push(n-1);
    return out;
  }, [n]);

  const h = hover !== null ? series[hover] : null;

  return (
    <section className="card">
      <div className="chart-head">
        <div>
          <div className="card-title">Cash flow</div>
          <div className="chart-legend">
            <span className="lg"><span className="sw in"/>Income <b>{fmtUSD(totalIn, {cents:false})}</b></span>
            <span className="lg"><span className="sw out"/>Spending <b>{fmtUSD(totalOut, {cents:false})}</b></span>
          </div>
        </div>
        <div className="net-box">
          <div className="net-label">Net</div>
          <div className={'net-value ' + (totalIn-totalOut >= 0 ? 'pos' : 'neg')}>{fmtUSD(totalIn-totalOut, {sign:true, cents:false})}</div>
        </div>
      </div>
      <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" onMouseMove={onMove}>
          {[0.33, 0.66, 1].map(f => <line key={f} x1={padX} x2={W-padX} y1={yFor(max*f)} y2={yFor(max*f)} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4"/>)}
          <defs>
            <linearGradient id="areaG" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.12"/>
              <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#areaG)"/>
          <path d={linePath} stroke="rgba(255,255,255,0.3)" strokeWidth="1.25" fill="none"/>
          {series.map((d,i) => {
            const x = padX + slotW*i + slotW/2 - barW/2;
            const active = hover === i;
            return (
              <g key={i} opacity={hover === null || active ? 1 : 0.4}>
                {d.income > 0 && <rect x={x} y={yFor(d.income)} width={barW} height={Math.max(1, (padTop+chartH)-yFor(d.income))} rx={barW/3} fill="var(--green)"/>}
                {d.expense > 0 && <rect x={x + barW + 1} y={yFor(d.expense)} width={barW} height={Math.max(1, (padTop+chartH)-yFor(d.expense))} rx={barW/3} fill="#fff"/>}
              </g>
            );
          })}
          {h && <line x1={padX + slotW*hover + slotW/2} x2={padX + slotW*hover + slotW/2} y1={padTop} y2={padTop+chartH} stroke="rgba(255,255,255,0.2)" strokeDasharray="2 3"/>}
          {ticks.map(i => <text key={i} x={padX + slotW*i + slotW/2} y={H-8} textAnchor="middle" fontSize="10.5" fill="var(--fg-3)">{series[i].date.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</text>)}
        </svg>
        {h && (
          <div className="chart-tt" style={{left: `${((padX + slotW*hover + slotW/2)/W)*100}%`}}>
            <div className="tt-date">{h.date.toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})}</div>
            <div className="tt-row"><span className="sw in"/>Income <b>{fmtUSD(h.income, {cents:false})}</b></div>
            <div className="tt-row"><span className="sw out"/>Spending <b>{fmtUSD(h.expense, {cents:false})}</b></div>
          </div>
        )}
      </div>
    </section>
  );
};

window.CategoryDonut = function CategoryDonut({ data, range }) {
  const { fmtUSD, parseDate } = window.Utils;
  const days = range === '7D' ? 7 : range === '30D' ? 30 : range === '90D' ? 90 : 365;
  const COLORS = ['#00D64F','#4DA6FF','#A78BFA','#FFB020','#FF4D5E','#00C9B7','#F5C518'];

  const { slices, total } = useMC(() => {
    const cutoff = new Date(data.today); cutoff.setDate(cutoff.getDate() - days);
    const byCat = {};
    for (const t of data.transactions) {
      if (t.type !== 'expense') continue;
      if (parseDate(t.date) < cutoff) continue;
      byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount;
    }
    const entries = Object.entries(byCat).map(([cid, v], i) => ({ cat: data.categories.find(c=>c.id===cid), value: v }))
      .filter(e => e.cat).sort((a,b) => b.value - a.value)
      .map((e, i) => ({ ...e, color: COLORS[i % COLORS.length] }));
    return { slices: entries, total: entries.reduce((s,e) => s+e.value, 0) };
  }, [data, range]);

  const R=64, r=44, cx=80, cy=80; let acc = 0;
  const arcs = slices.map(s => {
    const frac = s.value / total;
    const a0 = acc * 2*Math.PI - Math.PI/2; acc += frac;
    const a1 = acc * 2*Math.PI - Math.PI/2;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = cx+R*Math.cos(a0), y0 = cy+R*Math.sin(a0);
    const x1 = cx+R*Math.cos(a1), y1 = cy+R*Math.sin(a1);
    const xi0 = cx+r*Math.cos(a0), yi0 = cy+r*Math.sin(a0);
    const xi1 = cx+r*Math.cos(a1), yi1 = cy+r*Math.sin(a1);
    return { d: `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${xi1},${yi1} A${r},${r} 0 ${large} 0 ${xi0},${yi0} Z`, color: s.color, key: s.cat.id };
  });

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Where it went</div>
          <div className="card-sub">Last {range === 'YTD' ? 'year' : range.toLowerCase()}</div>
        </div>
      </div>
      <div className="donut-body">
        <svg viewBox="0 0 160 160" width="150" height="150">
          {arcs.map(a => <path key={a.key} d={a.d} fill={a.color}/>)}
          <text x="80" y="76" textAnchor="middle" fontSize="10" fill="var(--fg-3)">Total</text>
          <text x="80" y="95" textAnchor="middle" fontSize="17" fontWeight="650" fill="var(--fg)" style={{letterSpacing:'-0.03em'}}>{fmtUSD(total, {cents:false})}</text>
        </svg>
        <ul className="donut-legend">
          {slices.slice(0,6).map(s => (
            <li key={s.cat.id}>
              <span className="sw" style={{background: s.color}}/>
              <span className="lg-name">{s.cat.name}</span>
              <span className="lg-val">{fmtUSD(s.value, {cents:false})}</span>
              <span className="lg-pct">{((s.value/total)*100).toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

window.ActivityCard = function ActivityCard({ data, onQuickAdd, onNav }) {
  const { fmtUSD, fmtRelDay } = window.Utils;
  const [filter, setFilter] = useSC('all');
  const rows = useMC(() => {
    const all = data.transactions.slice().sort((a,b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    return (filter === 'all' ? all : all.filter(t => t.type === filter)).slice(0, 8);
  }, [data, filter]);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Activity</div>
          <div className="card-sub">Recent transactions</div>
        </div>
        <div className="seg">
          {[['all','All'],['expense','Out'],['income','In'],['transfer','Move']].map(([k,l]) => (
            <button key={k} className={'seg-btn' + (filter===k?' active':'')} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>
      <ul className="tx-list">
        {rows.map(t => {
          const cat = data.categories.find(c => c.id === t.categoryId);
          const acct = data.accounts.find(a => a.id === (t.accountId || t.fromAccountId));
          const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
          const cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : 'neutral';
          return (
            <li key={t.id} className="tx-row">
              <div className={'tx-icon ' + (t.type==='income'?'in':'out')}>{cat ? cat.icon : '↔️'}</div>
              <div className="tx-main">
                <div className="tx-title">{t.merchant || t.notes || 'Transfer'}</div>
                <div className="tx-meta">
                  <span>{cat ? cat.name : 'Transfer'}</span><span className="sep">·</span>
                  <span>{acct ? acct.name : '—'}</span><span className="sep">·</span>
                  <span>{fmtRelDay(t.date, data.today)}</span>
                </div>
              </div>
              <div className={'tx-amount ' + cls}>{sign}{fmtUSD(t.amount, {cents:true})}</div>
            </li>
          );
        })}
      </ul>
      <button className="tx-add-btn" onClick={onQuickAdd}><Icon name="plus" size={14}/> Add transaction</button>
    </section>
  );
};

window.UpcomingBillsCard = function UpcomingBillsCard({ data, onNav }) {
  const { fmtUSD, parseDate } = window.Utils;
  const bills = data.bills.filter(b => b.active).map(b => ({ ...b, daysAway: Math.round((parseDate(b.nextDueDate)-data.today)/86400000) })).sort((a,b) => a.daysAway - b.daysAway);
  const total = bills.reduce((s,b) => s+b.amount, 0);
  return (
    <section className="card">
      <div className="card-head">
        <div><div className="card-title">Upcoming</div><div className="card-sub">{bills.length} bills · {fmtUSD(total, {cents:false})}</div></div>
        <button className="btn-ghost" style={{padding:'6px 12px', fontSize:'12px'}} onClick={() => onNav('bills')}>All →</button>
      </div>
      <ul className="bills-list">
        {bills.slice(0,4).map(b => (
          <li key={b.id} className="bill-row">
            <div className="bill-date">
              <div className="bill-day">{parseDate(b.nextDueDate).getDate()}</div>
              <div className="bill-mon">{parseDate(b.nextDueDate).toLocaleDateString('en-US',{month:'short'}).toUpperCase()}</div>
            </div>
            <div><div className="bill-name">{b.icon} {b.name}</div><div className="bill-sub">in {b.daysAway}d · {b.frequency}</div></div>
            <div className="bill-amount">{fmtUSD(b.amount, {cents:false})}</div>
          </li>
        ))}
      </ul>
    </section>
  );
};

window.BudgetsCard = function BudgetsCard({ data, onNav }) {
  const { fmtUSD } = window.Utils;
  const month = '2026-04';
  const rows = useMC(() => {
    const spent = {};
    for (const t of data.transactions) {
      if (t.type !== 'expense' || !t.date.startsWith(month)) continue;
      spent[t.categoryId] = (spent[t.categoryId] || 0) + t.amount;
    }
    return data.budgets.map(b => {
      const cat = data.categories.find(c => c.id === b.categoryId);
      const s = spent[b.categoryId] || 0;
      return { ...b, cat, spent: s, pct: Math.min(120, (s/b.limit)*100) };
    }).sort((a,b) => b.pct - a.pct);
  }, [data]);
  return (
    <section className="card">
      <div className="card-head">
        <div><div className="card-title">Budgets · April</div><div className="card-sub">{rows.length} tracked</div></div>
        <button className="btn-ghost" style={{padding:'6px 12px', fontSize:'12px'}} onClick={() => onNav('budgets')}>Manage →</button>
      </div>
      <div className="budget-list">
        {rows.slice(0,4).map(r => {
          const over = r.pct >= 100; const warn = r.pct >= 80 && !over;
          return (
            <div key={r.id} className="budget-row">
              <div className="budget-top">
                <span className="budget-name"><span>{r.cat.icon}</span>{r.cat.name}</span>
                <span className="budget-amt"><b>{fmtUSD(r.spent, {cents:false})}</b><span className="muted"> / {fmtUSD(r.limit, {cents:false})}</span></span>
              </div>
              <div className="budget-bar"><div className={'budget-fill' + (over?' over':warn?' warn':'')} style={{width: Math.min(100, r.pct) + '%'}}/></div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
