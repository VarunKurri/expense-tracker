/* Dashboard page */
const { useState: useSD, useMemo: useMD } = React;

window.DashboardPage = function DashboardPage({ data, onQuickAdd, onNav }) {
  const { fmtUSD, parseDate, fmtRelDay } = window.Utils;
  const [range, setRange] = useSD('30D');
  const ranges = ['7D', '30D', '90D', 'YTD'];

  const net = useMD(() => data.accounts.reduce((s,a) => s + a.openingBalance, 0), [data]);

  const stats = useMD(() => {
    const days = range === '7D' ? 7 : range === '30D' ? 30 : range === '90D' ? 90 : 365;
    const cutoff = new Date(data.today); cutoff.setDate(cutoff.getDate() - days);
    const prevCutoff = new Date(cutoff); prevCutoff.setDate(prevCutoff.getDate() - days);
    let income = 0, expense = 0, pIncome = 0, pExpense = 0;
    for (const t of data.transactions) {
      if (t.type === 'transfer') continue;
      const d = parseDate(t.date);
      if (d >= cutoff) { if (t.type === 'income') income += t.amount; else expense += t.amount; }
      else if (d >= prevCutoff) { if (t.type === 'income') pIncome += t.amount; else pExpense += t.amount; }
    }
    const pct = (a,b) => b===0 ? 0 : ((a-b)/b)*100;
    return { income, expense, net: income-expense, iDelta: pct(income,pIncome), eDelta: pct(expense,pExpense), savings: income===0 ? 0 : ((income-expense)/income)*100 };
  }, [data, range]);

  const [dollars, cents] = net.toFixed(2).split('.');

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-top">
          <div className="hero-label"><span className="dot"/> Net worth · all accounts</div>
          <div className="range-seg">
            {ranges.map(r => <button key={r} className={'range-btn' + (r===range?' active':'')} onClick={() => setRange(r)}>{r}</button>)}
          </div>
        </div>
        <div className="hero-number">
          <span className="cur">$</span>
          <span>{Number(dollars).toLocaleString('en-US')}</span>
          <span className="cents">.{cents}</span>
        </div>
        <div className="hero-meta">
          <span className={'change-chip ' + (stats.net >= 0 ? 'pos' : 'neg')}>
            <Icon name={stats.net >= 0 ? 'arrowUp' : 'arrowDown'} size={10} stroke={2.5}/>
            {fmtUSD(stats.net, { sign: true, cents: false })}
          </span>
          <span>in the last {range === 'YTD' ? 'year' : range.toLowerCase()}</span>
        </div>
        <div className="hero-actions">
          <button className="btn-primary" onClick={onQuickAdd}><Icon name="plus" size={14} stroke={2.5}/> Add money</button>
          <button className="btn-ghost" onClick={() => onNav('tx')}><Icon name="tx" size={14}/> Transactions</button>
          <button className="btn-ghost" onClick={() => onNav('accts')}><Icon name="accounts" size={14}/> Accounts</button>
        </div>
      </section>

      <div className="kpi-grid">
        <KpiTile label="Income" value={stats.income} delta={stats.iDelta} tone="pos"/>
        <KpiTile label="Spending" value={stats.expense} delta={stats.eDelta} tone="neg" invert/>
        <KpiTile label="Savings rate" value={stats.savings} delta={null} unit="%" tone="neutral"/>
      </div>

      <section className="accts-grid">
        {data.accounts.map(a => (
          <div key={a.id} className="acct-card" onClick={() => onNav('accts')}>
            <div className="acct-head">
              <div className="acct-emoji"><Icon name={a.icon} size={17}/></div>
              <span className="acct-type">{a.type}</span>
            </div>
            <div className="acct-name">{a.name}</div>
            <div className={'acct-bal' + (a.openingBalance < 0 ? ' neg' : '')}>{fmtUSD(a.openingBalance, { cents: false })}</div>
            {a.last4 && <div className="acct-sub">· · · · {a.last4}</div>}
          </div>
        ))}
      </section>

      <div className="grid-2">
        <SpendChart data={data} range={range}/>
        <CategoryDonut data={data} range={range}/>
      </div>

      <div className="grid-2">
        <ActivityCard data={data} onQuickAdd={onQuickAdd} onNav={onNav}/>
        <div className="stack">
          <UpcomingBillsCard data={data} onNav={onNav}/>
          <BudgetsCard data={data} onNav={onNav}/>
        </div>
      </div>
    </div>
  );
};

function KpiTile({ label, value, delta, tone, invert, unit }) {
  const { fmtUSD } = window.Utils;
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="sw" style={{background: tone==='pos'?'var(--green)':tone==='neg'?'var(--red)':'var(--fg-3)'}}/>
      </div>
      <div className="kpi-value">{unit === '%' ? value.toFixed(1) + '%' : fmtUSD(value, { cents: false })}</div>
      {delta !== null ? (
        <div className={'kpi-delta ' + ((invert ? -delta : delta) >= 0 ? 'pos' : 'neg')}>
          <Icon name={delta >= 0 ? 'arrowUp' : 'arrowDown'} size={9} stroke={2.5}/>
          {Math.abs(delta).toFixed(1)}% vs prior
        </div>
      ) : <div className="kpi-delta neutral">of income kept</div>}
    </div>
  );
}
