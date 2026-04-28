/* Quick-Add modal + Tweaks panel + App root */
const { useState: useSR, useEffect: useER } = React;

window.QuickAdd = function QuickAdd({ data, onClose, onSave }) {
  const [type, setType] = useSR('expense');
  const [amount, setAmount] = useSR('');
  const [merchant, setMerchant] = useSR('');
  const [accountId, setAccountId] = useSR(data.accounts[0].id);
  const [categoryId, setCategoryId] = useSR(data.categories.find(c => c.kind === 'expense').id);

  useER(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cats = data.categories.filter(c => type === 'income' ? c.kind === 'income' : type === 'expense' ? c.kind === 'expense' : true);

  const save = () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    onSave({ id: 't' + Date.now(), type, amount: n, merchant: merchant || (type==='transfer'?'Transfer':'(unnamed)'), accountId, categoryId: type==='transfer'?null:categoryId, date: data.today.toISOString().slice(0,10), createdAt: Date.now(), updatedAt: Date.now() });
    onClose();
  };

  return (
    <div className="backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div><h2 style={{fontSize:18, letterSpacing:'-0.02em'}}>New transaction</h2><div className="card-sub">Record money in, out, or moving</div></div>
          <button className="close-btn" onClick={onClose}><Icon name="close" size={14}/></button>
        </div>
        <div className="type-seg">
          {[['expense','Spent','neg'],['income','Received','pos'],['transfer','Moved','']].map(([k,l,c]) => (
            <button key={k} className={'type-btn ' + c + (type===k?' active':'')} onClick={() => setType(k)}>{l}</button>
          ))}
        </div>
        <div className="amount-field">
          <span className="amount-curr">$</span>
          <input className="amount-input mono" placeholder="0.00" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g,''))} autoFocus/>
        </div>
        <div className="form-grid">
          <div className="field">
            <span className="label-sm">Merchant / Note</span>
            <input className="input-field" placeholder="Where did it go?" value={merchant} onChange={e => setMerchant(e.target.value)}/>
          </div>
          <div className="field">
            <span className="label-sm">Account</span>
            <select className="input-field" value={accountId} onChange={e => setAccountId(e.target.value)}>
              {data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        {type !== 'transfer' && (
          <div className="field">
            <span className="label-sm">Category</span>
            <div className="cat-grid">
              {cats.map(c => (
                <button key={c.id} className={'cat-chip' + (categoryId===c.id?' active':'')} onClick={() => setCategoryId(c.id)}>{c.icon} {c.name}</button>
              ))}
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save transaction</button>
        </div>
      </div>
    </div>
  );
};

function App() {
  const [data, setData] = useSR(window.tallyData);
  const [page, setPage] = useSR(() => localStorage.getItem('tally.page') || 'home');
  const [quickOpen, setQuickOpen] = useSR(false);

  useER(() => { localStorage.setItem('tally.page', page); }, [page]);

  const onSave = tx => setData(d => ({ ...d, transactions: [tx, ...d.transactions] }));

  const titles = { home:'Home', accts:'Accounts', tx:'Transactions', bills:'Bills', budgets:'Budgets', analysis:'Analysis', profile:'Profile', settings:'Settings' };

  return (
    <div className="shell">
      <Sidebar active={page} onNav={setPage} data={data}/>
      <main className="main">
        <Topbar title={titles[page]} onQuickAdd={() => setQuickOpen(true)} onNav={setPage}/>
        {page === 'home' && <DashboardPage data={data} onQuickAdd={() => setQuickOpen(true)} onNav={setPage}/>}
        {page === 'accts' && <AccountsPage data={data} onNav={setPage} setData={setData} onQuickAdd={() => setQuickOpen(true)}/>}
        {page === 'tx' && <TransactionsPage data={data} onQuickAdd={() => setQuickOpen(true)}/>}
        {page === 'bills' && <BillsPage data={data} setData={setData}/>}
        {page === 'budgets' && <BudgetsPage data={data} setData={setData}/>}
        {page === 'analysis' && <AnalysisPage data={data}/>}
        {page === 'profile' && <ProfilePage data={data} onNav={setPage}/>}
        {page === 'settings' && <SettingsPage data={data}/>}
      </main>
      {quickOpen && <QuickAdd data={data} onClose={() => setQuickOpen(false)} onSave={onSave}/>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
