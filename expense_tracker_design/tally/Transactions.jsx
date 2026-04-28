/* Transactions page */
const { useState: useST, useMemo: useMT } = React;

window.TransactionsPage = function TransactionsPage({ data, onQuickAdd }) {
  const { fmtUSD, parseDate, fmtRelDay } = window.Utils;
  const [type, setType] = useST('all');
  const [acctFilter, setAcctFilter] = useST('all');
  const [catFilter, setCatFilter] = useST('all');
  const [query, setQuery] = useST('');

  const filtered = useMT(() => {
    return data.transactions.filter(t => {
      if (type !== 'all' && t.type !== type) return false;
      if (acctFilter !== 'all' && t.accountId !== acctFilter && t.fromAccountId !== acctFilter && t.toAccountId !== acctFilter) return false;
      if (catFilter !== 'all' && t.categoryId !== catFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!((t.merchant||'').toLowerCase().includes(q) || (t.notes||'').toLowerCase().includes(q))) return false;
      }
      return true;
    }).sort((a,b) => b.date.localeCompare(a.date));
  }, [data, type, acctFilter, catFilter, query]);

  // Group by date
  const grouped = useMT(() => {
    const g = {};
    filtered.forEach(t => { (g[t.date] = g[t.date] || []).push(t); });
    return Object.entries(g).sort((a,b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const totalIn = filtered.filter(t => t.type === 'income').reduce((s,t) => s+t.amount, 0);
  const totalOut = filtered.filter(t => t.type === 'expense').reduce((s,t) => s+t.amount, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Transactions</h1><div className="sub">{filtered.length} transactions · {fmtUSD(totalIn, {cents:false})} in · {fmtUSD(totalOut, {cents:false})} out</div></div>
        <button className="btn-primary" onClick={onQuickAdd}><Icon name="plus" size={14} stroke={2.5}/> New transaction</button>
      </div>

      <div className="tx-toolbar">
        <div className="search" style={{maxWidth: 320, flex: '1 1 260px'}}>
          <Icon name="search" size={14}/>
          <input placeholder="Search merchants, notes…" value={query} onChange={e => setQuery(e.target.value)}/>
        </div>
        <div className="seg">
          {[['all','All'],['expense','Out'],['income','In'],['transfer','Move']].map(([k,l]) => (
            <button key={k} className={'seg-btn' + (type===k?' active':'')} onClick={() => setType(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="chips">
        <button className={'chip' + (acctFilter==='all'?' active':'')} onClick={() => setAcctFilter('all')}>All accounts</button>
        {data.accounts.map(a => (
          <button key={a.id} className={'chip' + (acctFilter===a.id?' active':'')} onClick={() => setAcctFilter(a.id)}>{a.name}</button>
        ))}
      </div>

      <div className="chips">
        <button className={'chip' + (catFilter==='all'?' active':'')} onClick={() => setCatFilter('all')}>All categories</button>
        {data.categories.map(c => (
          <button key={c.id} className={'chip' + (catFilter===c.id?' active':'')} onClick={() => setCatFilter(c.id)}>{c.icon} {c.name}</button>
        ))}
      </div>

      <section className="card tx-table">
        {grouped.length === 0 && <div style={{padding:'60px 22px', textAlign:'center', color:'var(--fg-3)'}}>No transactions match your filters</div>}
        {grouped.map(([date, rows]) => {
          const dayTotal = rows.reduce((s,t) => s + (t.type==='income' ? t.amount : t.type==='expense' ? -t.amount : 0), 0);
          return (
            <div key={date} className="tx-day-group">
              <div className="tx-day-hdr">
                <span>{fmtRelDay(date, data.today)} · {parseDate(date).toLocaleDateString('en-US', {weekday:'long'})}</span>
                <b>{fmtUSD(dayTotal, {sign:true, cents:false})}</b>
              </div>
              <ul className="tx-list" style={{padding: 0}}>
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
                        <div className="tx-meta"><span>{cat ? cat.name : 'Transfer'}</span><span className="sep">·</span><span>{acct ? acct.name : '—'}</span></div>
                      </div>
                      <div className={'tx-amount ' + cls}>{sign}{fmtUSD(t.amount, {cents:true})}</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
};
