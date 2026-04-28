/* Accounts page */
const { useState: useSA, useMemo: useMA } = React;

window.AccountsPage = function AccountsPage({ data, onNav, setData, onQuickAdd }) {
  const { fmtUSD, fmtRelDay } = window.Utils;
  const [selected, setSelected] = useSA(data.accounts[0].id);
  const acct = data.accounts.find(a => a.id === selected);

  const txs = useMA(() => data.transactions
    .filter(t => t.accountId === selected || t.fromAccountId === selected || t.toAccountId === selected)
    .sort((a,b) => b.date.localeCompare(a.date)).slice(0, 20), [data, selected]);

  const total = data.accounts.reduce((s,a) => s + a.openingBalance, 0);
  const assets = data.accounts.filter(a => a.openingBalance > 0).reduce((s,a) => s+a.openingBalance, 0);
  const debt = Math.abs(data.accounts.filter(a => a.openingBalance < 0).reduce((s,a) => s+a.openingBalance, 0));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Accounts</h1><div className="sub">{data.accounts.length} accounts · {fmtUSD(total, {cents:false})} net</div></div>
        <button className="btn-primary"><Icon name="plus" size={14} stroke={2.5}/> Link account</button>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-label">Total assets</div><div className="kpi-value" style={{color:'var(--green)'}}>{fmtUSD(assets, {cents:false})}</div><div className="kpi-delta neutral">cash + savings + investments</div></div>
        <div className="kpi"><div className="kpi-label">Total debt</div><div className="kpi-value" style={{color:'var(--red)'}}>{fmtUSD(debt, {cents:false})}</div><div className="kpi-delta neutral">credit cards</div></div>
        <div className="kpi"><div className="kpi-label">Net worth</div><div className="kpi-value">{fmtUSD(total, {cents:false})}</div><div className="kpi-delta pos"><Icon name="arrowUp" size={9} stroke={2.5}/> +2.1% this month</div></div>
      </div>

      <div className="acct-detail">
        <div className="stack">
          {data.accounts.map(a => (
            <div key={a.id} className={'acct-big' + (a.id === selected ? ' featured' : '')} onClick={() => setSelected(a.id)}>
              <div className="acct-head">
                <div className="acct-emoji" style={{background: a.id===selected ? 'var(--green-bg)':'var(--bg-3)'}}><Icon name={a.icon} size={20}/></div>
                <span className="acct-type">{a.type}</span>
              </div>
              <div className="acct-name" style={{fontSize:'15px'}}>{a.name}</div>
              <div className={'acct-bal' + (a.openingBalance < 0 ? ' neg' : '')}>{fmtUSD(a.openingBalance, {cents:true})}</div>
              <div className="acct-big-foot">
                <span>{a.institution}{a.last4 ? ' · ···· ' + a.last4 : ''}</span>
                <span>{a.currency}</span>
              </div>
            </div>
          ))}
        </div>

        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{acct.name} · {acct.institution}</div>
              <div className="card-sub">Recent activity</div>
            </div>
            <button className="btn-ghost" style={{padding:'6px 12px', fontSize:'12px'}} onClick={() => onNav('tx')}>View all →</button>
          </div>
          <ul className="tx-list">
            {txs.length === 0 && <li style={{padding:'40px 22px', textAlign:'center', color:'var(--fg-3)', fontSize:'13px'}}>No activity yet</li>}
            {txs.map(t => {
              const cat = data.categories.find(c => c.id === t.categoryId);
              const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
              const cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : 'neutral';
              return (
                <li key={t.id} className="tx-row">
                  <div className={'tx-icon ' + (t.type==='income'?'in':'out')}>{cat ? cat.icon : '↔️'}</div>
                  <div className="tx-main">
                    <div className="tx-title">{t.merchant || t.notes || 'Transfer'}</div>
                    <div className="tx-meta"><span>{cat ? cat.name : 'Transfer'}</span><span className="sep">·</span><span>{fmtRelDay(t.date, data.today)}</span></div>
                  </div>
                  <div className={'tx-amount ' + cls}>{sign}{fmtUSD(t.amount, {cents:true})}</div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
};
