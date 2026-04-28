/* Bills, Budgets, Analysis, Profile, Settings pages */
const { useState: useSP, useMemo: useMP } = React;

window.BillsPage = function BillsPage({ data, setData }) {
  const { fmtUSD, parseDate } = window.Utils;
  const [filter, setFilter] = useSP('all');
  const bills = data.bills.filter(b => filter === 'all' ? true : filter === 'active' ? b.active : !b.active)
    .map(b => ({ ...b, daysAway: Math.round((parseDate(b.nextDueDate)-data.today)/86400000) }))
    .sort((a,b) => a.daysAway - b.daysAway);
  const monthly = data.bills.filter(b => b.active && b.frequency==='monthly').reduce((s,b) => s+b.amount, 0);
  const next7 = data.bills.filter(b => b.active && (parseDate(b.nextDueDate) - data.today)/86400000 <= 7).length;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Bills</h1><div className="sub">{data.bills.length} tracked · {fmtUSD(monthly, {cents:false})}/mo</div></div>
        <button className="btn-primary"><Icon name="plus" size={14} stroke={2.5}/> Add bill</button>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-label">Monthly subscriptions</div><div className="kpi-value">{fmtUSD(monthly, {cents:false})}</div><div className="kpi-delta neutral">{data.bills.filter(b=>b.active).length} active</div></div>
        <div className="kpi"><div className="kpi-label">Due this week</div><div className="kpi-value">{next7}</div><div className="kpi-delta neutral">within 7 days</div></div>
        <div className="kpi"><div className="kpi-label">Yearly total</div><div className="kpi-value">{fmtUSD(monthly*12, {cents:false})}</div><div className="kpi-delta neutral">at current rate</div></div>
      </div>

      <div className="seg">
        {[['all','All'],['active','Active'],['inactive','Paused']].map(([k,l]) => (
          <button key={k} className={'seg-btn' + (filter===k?' active':'')} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      <section className="card">
        <ul className="bills-list" style={{padding: '10px 14px 14px'}}>
          {bills.map(b => {
            const acct = data.accounts.find(a => a.id === b.accountId);
            const due = b.daysAway <= 3;
            return (
              <li key={b.id} className="bill-row" style={{gridTemplateColumns: '48px 1fr auto auto', gap: 16, padding: 14}}>
                <div className="bill-date" style={due ? {borderColor:'var(--green)', background:'var(--green-bg)'} : {}}>
                  <div className="bill-day">{parseDate(b.nextDueDate).getDate()}</div>
                  <div className="bill-mon">{parseDate(b.nextDueDate).toLocaleDateString('en-US',{month:'short'}).toUpperCase()}</div>
                </div>
                <div>
                  <div className="bill-name" style={{fontSize:15}}>{b.icon} {b.name}</div>
                  <div className="bill-sub">{acct ? acct.name : '—'} · {b.frequency} · {due ? 'due in ' + b.daysAway + 'd' : 'in ' + b.daysAway + 'd'}</div>
                </div>
                <div className="bill-amount" style={{fontSize:16}}>{fmtUSD(b.amount, {cents:true})}</div>
                <button className="btn-ghost" style={{padding:'7px 12px', fontSize:12}}>Pay</button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};

window.BudgetsPage = function BudgetsPage({ data, setData }) {
  const { fmtUSD } = window.Utils;
  const month = '2026-04';
  const rows = useMP(() => {
    const spent = {};
    for (const t of data.transactions) {
      if (t.type !== 'expense' || !t.date.startsWith(month)) continue;
      spent[t.categoryId] = (spent[t.categoryId] || 0) + t.amount;
    }
    return data.budgets.map(b => {
      const cat = data.categories.find(c => c.id === b.categoryId);
      const s = spent[b.categoryId] || 0;
      return { ...b, cat, spent: s, pct: (s/b.limit)*100, remaining: b.limit - s };
    }).sort((a,b) => b.pct - a.pct);
  }, [data]);

  const totalLimit = rows.reduce((s,r) => s+r.limit, 0);
  const totalSpent = rows.reduce((s,r) => s+r.spent, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Budgets</h1><div className="sub">April 2026 · {fmtUSD(totalSpent, {cents:false})} of {fmtUSD(totalLimit, {cents:false})}</div></div>
        <button className="btn-primary"><Icon name="plus" size={14} stroke={2.5}/> New budget</button>
      </div>

      <section className="card" style={{padding: 28}}>
        <div style={{display:'flex', justifyContent:'space-between', marginBottom:12}}>
          <div>
            <div className="card-sub">Total spent · April</div>
            <div style={{fontSize:42, fontWeight:650, letterSpacing:'-0.04em', fontVariantNumeric:'tabular-nums'}}>{fmtUSD(totalSpent, {cents:false})}</div>
          </div>
          <div style={{textAlign:'right'}}>
            <div className="card-sub">Remaining</div>
            <div style={{fontSize:28, fontWeight:600, letterSpacing:'-0.03em', color: totalLimit-totalSpent >= 0 ? 'var(--green)' : 'var(--red)'}}>{fmtUSD(Math.max(0, totalLimit-totalSpent), {cents:false})}</div>
          </div>
        </div>
        <div className="budget-bar" style={{height:10, borderRadius:5}}>
          <div className={'budget-fill' + (totalSpent/totalLimit >= 1 ? ' over' : totalSpent/totalLimit >= 0.8 ? ' warn' : '')} style={{width: Math.min(100,(totalSpent/totalLimit)*100) + '%'}}/>
        </div>
      </section>

      <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap: 14}}>
        {rows.map(r => {
          const over = r.pct >= 100; const warn = r.pct >= 80 && !over;
          return (
            <section key={r.id} className="card" style={{padding:20}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12}}>
                <div style={{display:'flex', gap:10, alignItems:'center'}}>
                  <div style={{width:40,height:40,borderRadius:12,background:'var(--bg-3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{r.cat.icon}</div>
                  <div>
                    <div style={{fontSize:15, fontWeight:600, letterSpacing:'-0.02em'}}>{r.cat.name}</div>
                    <div className="card-sub">{fmtUSD(r.limit, {cents:false})} limit</div>
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:20, fontWeight:650, fontVariantNumeric:'tabular-nums', letterSpacing:'-0.03em', color: over ? 'var(--red)' : warn ? 'var(--amber)' : 'var(--fg)'}}>{fmtUSD(r.spent, {cents:false})}</div>
                  <div className="card-sub">{r.pct.toFixed(0)}% used</div>
                </div>
              </div>
              <div className="budget-bar"><div className={'budget-fill' + (over?' over':warn?' warn':'')} style={{width: Math.min(100, r.pct) + '%'}}/></div>
              <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--fg-3)', marginTop:10}}>
                <span>{r.remaining >= 0 ? fmtUSD(r.remaining, {cents:false}) + ' left' : fmtUSD(-r.remaining, {cents:false}) + ' over'}</span>
                <span>Resets May 1</span>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

window.AnalysisPage = function AnalysisPage({ data }) {
  const { fmtUSD, parseDate } = window.Utils;

  const byMonth = useMP(() => {
    const m = {};
    for (const t of data.transactions) {
      if (t.type === 'transfer') continue;
      const key = t.date.slice(0,7);
      m[key] = m[key] || { month: key, income: 0, expense: 0 };
      if (t.type === 'income') m[key].income += t.amount;
      else m[key].expense += t.amount;
    }
    return Object.values(m).sort((a,b) => a.month.localeCompare(b.month));
  }, [data]);

  const byCat = useMP(() => {
    const m = {};
    for (const t of data.transactions) {
      if (t.type !== 'expense') continue;
      m[t.categoryId] = (m[t.categoryId] || 0) + t.amount;
    }
    return Object.entries(m).map(([cid,v]) => ({ cat: data.categories.find(c=>c.id===cid), value: v })).filter(e => e.cat).sort((a,b) => b.value - a.value);
  }, [data]);

  const byMerchant = useMP(() => {
    const m = {};
    for (const t of data.transactions) {
      if (t.type !== 'expense' || !t.merchant) continue;
      m[t.merchant] = (m[t.merchant] || { name: t.merchant, total: 0, count: 0 });
      m[t.merchant].total += t.amount; m[t.merchant].count += 1;
    }
    return Object.values(m).sort((a,b) => b.total - a.total).slice(0, 8);
  }, [data]);

  const totalIncome = byMonth.reduce((s,m) => s+m.income, 0);
  const totalExpense = byMonth.reduce((s,m) => s+m.expense, 0);
  const avgMonthlySpend = totalExpense / Math.max(1, byMonth.length);
  const topCat = byCat[0];

  const max = Math.max(...byMonth.map(m => Math.max(m.income, m.expense)), 100);
  const COLORS = ['#00D64F','#4DA6FF','#A78BFA','#FFB020','#FF4D5E','#00C9B7','#F5C518'];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Analysis</h1><div className="sub">Trends and patterns across your spend</div></div>
        <button className="btn-ghost"><Icon name="calendar" size={14}/> Last 90 days</button>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:14}}>
        <div className="stat-card"><div className="card-sub">Avg monthly spend</div><div className="stat-big">{fmtUSD(avgMonthlySpend, {cents:false})}</div><div className="stat-sub">across {byMonth.length} months</div></div>
        <div className="stat-card"><div className="card-sub">Top category</div><div className="stat-big" style={{fontSize:28}}>{topCat?.cat.icon} {topCat?.cat.name}</div><div className="stat-sub">{fmtUSD(topCat?.value || 0, {cents:false})}</div></div>
        <div className="stat-card"><div className="card-sub">Savings rate</div><div className="stat-big" style={{color:'var(--green)'}}>{((totalIncome-totalExpense)/totalIncome*100).toFixed(0)}%</div><div className="stat-sub">period-over-period</div></div>
        <div className="stat-card"><div className="card-sub">Largest expense</div><div className="stat-big">{fmtUSD(Math.max(...data.transactions.filter(t=>t.type==='expense').map(t=>t.amount)), {cents:false})}</div><div className="stat-sub">single transaction</div></div>
      </div>

      <section className="card">
        <div className="card-head"><div><div className="card-title">Monthly trend</div><div className="card-sub">Income vs spending</div></div></div>
        <div style={{padding:'10px 22px 22px'}}>
          <svg viewBox="0 0 760 240" width="100%" height="240">
            {[0.33,0.66,1].map(f => <line key={f} x1="20" x2="740" y1={24+(1-f)*180} y2={24+(1-f)*180} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4"/>)}
            {byMonth.map((m, i) => {
              const slotW = 720 / byMonth.length;
              const barW = Math.min(28, slotW * 0.3);
              const x = 20 + slotW*i + slotW/2;
              const hI = (m.income/max)*180, hE = (m.expense/max)*180;
              return (
                <g key={m.month}>
                  <rect x={x - barW - 2} y={204-hI} width={barW} height={hI} rx={4} fill="var(--green)"/>
                  <rect x={x + 2} y={204-hE} width={barW} height={hE} rx={4} fill="#fff"/>
                  <text x={x} y={228} textAnchor="middle" fontSize="10.5" fill="var(--fg-3)">{parseDate(m.month+'-01').toLocaleDateString('en-US',{month:'short'})}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><div><div className="card-title">Top merchants</div><div className="card-sub">All time</div></div></div>
          <ul className="tx-list" style={{padding:'0 12px 12px'}}>
            {byMerchant.map((m, i) => (
              <li key={m.name} className="tx-row">
                <div className="tx-icon" style={{background:'var(--bg-3)'}}>{String(i+1).padStart(2,'0')}</div>
                <div className="tx-main">
                  <div className="tx-title">{m.name}</div>
                  <div className="tx-meta">{m.count} transaction{m.count>1?'s':''}</div>
                </div>
                <div className="tx-amount neg">{fmtUSD(m.total, {cents:false})}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="card-head"><div><div className="card-title">Spending by category</div><div className="card-sub">All time</div></div></div>
          <div style={{padding:'4px 22px 22px', display:'flex', flexDirection:'column', gap:10}}>
            {byCat.slice(0,7).map((c,i) => {
              const maxCat = byCat[0].value;
              return (
                <div key={c.cat.id}>
                  <div style={{display:'flex', justifyContent:'space-between', fontSize:12.5, marginBottom:5}}>
                    <span style={{display:'flex', gap:8, alignItems:'center'}}><span>{c.cat.icon}</span>{c.cat.name}</span>
                    <span className="mono" style={{fontWeight:600}}>{fmtUSD(c.value, {cents:false})}</span>
                  </div>
                  <div style={{height:7, borderRadius:4, background:'var(--bg-3)', overflow:'hidden'}}>
                    <div style={{width: (c.value/maxCat)*100 + '%', height:'100%', background: COLORS[i % COLORS.length], borderRadius:4}}/>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

window.ProfilePage = function ProfilePage({ data, onNav }) {
  const { fmtUSD } = window.Utils;
  const total = data.accounts.reduce((s,a) => s+a.openingBalance, 0);
  return (
    <div className="page">
      <section className="profile-head">
        <div className="avatar xl">{data.user.avatar}</div>
        <div style={{flex:1}}>
          <div className="profile-name">{data.user.name}</div>
          <div className="profile-handle">{data.user.handle}</div>
          <div className="profile-meta">
            <span>{data.user.email}</span><span>·</span>
            <span>Member since {data.user.joined}</span>
          </div>
          <div style={{display:'flex', gap:8, marginTop:16}}>
            <button className="btn-primary"><Icon name="edit" size={14}/> Edit profile</button>
            <button className="btn-ghost">Share $ellamaren</button>
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div className="card-sub">Net worth</div>
          <div style={{fontSize:36, fontWeight:650, letterSpacing:'-0.04em', fontVariantNumeric:'tabular-nums'}}>{fmtUSD(total, {cents:false})}</div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><div><div className="card-title">Contacts</div><div className="card-sub">People you've paid or requested</div></div></div>
          <ul className="tx-list">
            {data.contacts.map(c => (
              <li key={c.id} className="tx-row">
                <div className="avatar" style={{background:'var(--bg-3)', color:'var(--fg)'}}>{c.avatar}</div>
                <div className="tx-main">
                  <div className="tx-title">{c.name}</div>
                  <div className="tx-meta">{c.handle}</div>
                </div>
                <button className="btn-ghost" style={{padding:'6px 12px', fontSize:12}}>Pay</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="card-head"><div><div className="card-title">Quick stats</div><div className="card-sub">Your money at a glance</div></div></div>
          <div style={{padding:'4px 22px 22px', display:'flex', flexDirection:'column', gap:14}}>
            {[
              ['Accounts', data.accounts.length],
              ['Transactions', data.transactions.length],
              ['Active bills', data.bills.filter(b => b.active).length],
              ['Budgets', data.budgets.length],
              ['Categories tracked', data.categories.length],
            ].map(([l, v]) => (
              <div key={l} style={{display:'flex', justifyContent:'space-between', padding:'10px 0', borderTop:'1px solid var(--line)'}}>
                <span style={{color:'var(--fg-2)', fontSize:13.5}}>{l}</span>
                <span style={{fontWeight:600, fontVariantNumeric:'tabular-nums'}}>{v}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

window.SettingsPage = function SettingsPage({ data }) {
  const [section, setSection] = useSP('account');
  const [notifs, setNotifs] = useSP({ bills: true, budgets: true, weekly: false, push: true });
  const [theme, setTheme] = useSP('dark');
  const [privacy, setPrivacy] = useSP({ hide: false, faceId: true, twoFa: true });

  const Toggle = ({ on, onChange }) => <div className={'toggle' + (on ? ' on' : '')} onClick={onChange}/>;

  const sections = [
    { id: 'account', label: 'Account' },
    { id: 'notifs', label: 'Notifications' },
    { id: 'security', label: 'Security' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'payment', label: 'Payment methods' },
    { id: 'data', label: 'Data & export' },
  ];

  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><div className="sub">Manage your account and preferences</div></div></div>

      <div className="settings-grid">
        <div className="settings-nav">
          {sections.map(s => (
            <div key={s.id} className={'settings-nav-item' + (section===s.id?' active':'')} onClick={() => setSection(s.id)}>{s.label}</div>
          ))}
        </div>

        <div>
          {section === 'account' && (
            <>
              <section className="settings-section">
                <div className="settings-h">Profile</div>
                <div className="settings-hint">Your public profile information</div>
                <div className="form-grid">
                  <div className="field"><span className="label-sm">Name</span><input className="input-field" defaultValue={data.user.name}/></div>
                  <div className="field"><span className="label-sm">Tally handle</span><input className="input-field" defaultValue={data.user.handle}/></div>
                  <div className="field"><span className="label-sm">Email</span><input className="input-field" defaultValue={data.user.email}/></div>
                  <div className="field"><span className="label-sm">Phone</span><input className="input-field" placeholder="(555) 123-4567"/></div>
                </div>
                <div style={{display:'flex', gap:8, marginTop:18}}>
                  <button className="btn-primary">Save changes</button>
                  <button className="btn-ghost">Cancel</button>
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-h" style={{color:'var(--red)'}}>Danger zone</div>
                <div className="settings-hint">Permanent actions</div>
                <div className="setting-row">
                  <div><div className="lbl">Sign out of all devices</div><div className="desc">Log out from every browser and app</div></div>
                  <button className="btn-ghost">Sign out</button>
                </div>
                <div className="setting-row">
                  <div><div className="lbl">Delete account</div><div className="desc">This cannot be undone</div></div>
                  <button className="btn-danger">Delete</button>
                </div>
              </section>
            </>
          )}
          {section === 'notifs' && (
            <section className="settings-section">
              <div className="settings-h">Notifications</div>
              <div className="settings-hint">Choose what to be notified about</div>
              <div className="setting-row"><div><div className="lbl">Bill reminders</div><div className="desc">Get notified 3 days before a bill is due</div></div><Toggle on={notifs.bills} onChange={() => setNotifs(n => ({...n, bills:!n.bills}))}/></div>
              <div className="setting-row"><div><div className="lbl">Budget alerts</div><div className="desc">When you hit 80% of any budget</div></div><Toggle on={notifs.budgets} onChange={() => setNotifs(n => ({...n, budgets:!n.budgets}))}/></div>
              <div className="setting-row"><div><div className="lbl">Weekly summary</div><div className="desc">Every Monday at 8am</div></div><Toggle on={notifs.weekly} onChange={() => setNotifs(n => ({...n, weekly:!n.weekly}))}/></div>
              <div className="setting-row"><div><div className="lbl">Push notifications</div><div className="desc">On this device</div></div><Toggle on={notifs.push} onChange={() => setNotifs(n => ({...n, push:!n.push}))}/></div>
            </section>
          )}
          {section === 'security' && (
            <section className="settings-section">
              <div className="settings-h">Security</div>
              <div className="settings-hint">Keep your account safe</div>
              <div className="setting-row"><div><div className="lbl">Hide balances</div><div className="desc">Blur balances until revealed</div></div><Toggle on={privacy.hide} onChange={() => setPrivacy(p => ({...p, hide:!p.hide}))}/></div>
              <div className="setting-row"><div><div className="lbl">Face ID</div><div className="desc">Use biometrics to open the app</div></div><Toggle on={privacy.faceId} onChange={() => setPrivacy(p => ({...p, faceId:!p.faceId}))}/></div>
              <div className="setting-row"><div><div className="lbl">Two-factor authentication</div><div className="desc">Required for sign-in on new devices</div></div><Toggle on={privacy.twoFa} onChange={() => setPrivacy(p => ({...p, twoFa:!p.twoFa}))}/></div>
              <div className="setting-row"><div><div className="lbl">Change password</div><div className="desc">Last changed 4 months ago</div></div><button className="btn-ghost">Update</button></div>
            </section>
          )}
          {section === 'appearance' && (
            <section className="settings-section">
              <div className="settings-h">Appearance</div>
              <div className="settings-hint">Tally is designed dark-first</div>
              <div className="setting-row">
                <div><div className="lbl">Theme</div><div className="desc">Currently dark (recommended)</div></div>
                <div className="seg">
                  {['light','dark','system'].map(t => <button key={t} className={'seg-btn' + (theme===t?' active':'')} onClick={() => setTheme(t)}>{t}</button>)}
                </div>
              </div>
              <div className="setting-row">
                <div><div className="lbl">Accent color</div><div className="desc">Signature green — the Tally default</div></div>
                <div style={{display:'flex', gap:6}}>
                  {['#00D64F','#4DA6FF','#A78BFA','#FFB020','#FF4D5E'].map(c => <div key={c} style={{width:22,height:22,borderRadius:7,background:c,border: c==='#00D64F' ? '2px solid var(--fg)' : '2px solid transparent'}}/>)}
                </div>
              </div>
              <div className="setting-row"><div><div className="lbl">Currency display</div><div className="desc">USD · $</div></div><button className="btn-ghost">Change</button></div>
            </section>
          )}
          {section === 'payment' && (
            <section className="settings-section">
              <div className="settings-h">Linked accounts</div>
              <div className="settings-hint">Where Tally connects for syncing</div>
              {data.accounts.map(a => (
                <div key={a.id} className="setting-row">
                  <div style={{display:'flex', gap:12, alignItems:'center'}}>
                    <div style={{width:40,height:40,borderRadius:11,background:'var(--bg-3)',border:'1px solid var(--line)',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name={a.icon} size={18}/></div>
                    <div><div className="lbl">{a.name}</div><div className="desc">{a.institution}{a.last4 ? ' · ···· ' + a.last4 : ''}</div></div>
                  </div>
                  <button className="btn-ghost" style={{padding:'7px 12px', fontSize:12}}>Manage</button>
                </div>
              ))}
              <button className="btn-primary" style={{marginTop:14}}><Icon name="plus" size={14} stroke={2.5}/> Link new account</button>
            </section>
          )}
          {section === 'data' && (
            <section className="settings-section">
              <div className="settings-h">Data & export</div>
              <div className="settings-hint">Take your data with you</div>
              <div className="setting-row"><div><div className="lbl">Export all transactions</div><div className="desc">CSV · {data.transactions.length} records</div></div><button className="btn-ghost">Download</button></div>
              <div className="setting-row"><div><div className="lbl">Export budgets</div><div className="desc">JSON format</div></div><button className="btn-ghost">Download</button></div>
              <div className="setting-row"><div><div className="lbl">Import from file</div><div className="desc">CSV · QIF · OFX</div></div><button className="btn-ghost">Import</button></div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
