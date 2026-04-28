// Complete mock data for Tally app — shaped to codebase models
window.tallyData = (() => {
  const today = new Date('2026-04-22');
  const iso = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };

  const accounts = [
    { id: 'a1', name: 'Everyday',         type: 'checking',   openingBalance: 4820.14,  currency: 'USD', institution: 'Chase',    last4: '4421', color: '#00D64F', icon: 'wallet' },
    { id: 'a2', name: 'Savings',          type: 'savings',    openingBalance: 18420.00, currency: 'USD', institution: 'Ally',     last4: '9981', color: '#00D64F', icon: 'vault' },
    { id: 'a3', name: 'Credit',           type: 'credit',     openingBalance: -1284.52, currency: 'USD', institution: 'Amex',     last4: '0004', color: '#FFFFFF', icon: 'card' },
    { id: 'a4', name: 'Cash',             type: 'cash',       openingBalance: 142.00,   currency: 'USD', institution: 'Wallet',                  color: '#A8A8AE', icon: 'cash' },
    { id: 'a5', name: 'Invest',           type: 'investment', openingBalance: 38204.77, currency: 'USD', institution: 'Fidelity', last4: '7712', color: '#F5C518', icon: 'chart' },
  ];

  const categories = [
    { id: 'c_sal',  name: 'Salary',     kind: 'income',  icon: '💼' },
    { id: 'c_frl',  name: 'Freelance',  kind: 'income',  icon: '🧑‍💻' },
    { id: 'c_gro',  name: 'Groceries',  kind: 'expense', icon: '🛒' },
    { id: 'c_din',  name: 'Dining',     kind: 'expense', icon: '🍜' },
    { id: 'c_trn',  name: 'Transport',  kind: 'expense', icon: '🚇' },
    { id: 'c_ent',  name: 'Entertain',  kind: 'expense', icon: '🎬' },
    { id: 'c_shp',  name: 'Shopping',   kind: 'expense', icon: '🛍️' },
    { id: 'c_utl',  name: 'Utilities',  kind: 'expense', icon: '💡' },
    { id: 'c_hlth', name: 'Health',     kind: 'expense', icon: '🩺' },
    { id: 'c_sub',  name: 'Subs',       kind: 'expense', icon: '📡' },
    { id: 'c_rent', name: 'Rent',       kind: 'expense', icon: '🏠' },
  ];

  const seed = [
    [0,  'expense', 4.75,   'c_din', 'Blue Bottle',        'a3'],
    [0,  'expense', 38.20,  'c_gro', 'Whole Foods',         'a1'],
    [1,  'expense', 12.00,  'c_trn', 'Muni',                'a4'],
    [1,  'expense', 89.40,  'c_shp', 'Uniqlo',              'a3'],
    [2,  'expense', 14.99,  'c_sub', 'Spotify',             'a3'],
    [2,  'income',  4250.00,'c_sal', 'Acme Payroll',        'a1'],
    [3,  'expense', 56.20,  'c_din', 'Rintaro',             'a1'],
    [3,  'expense', 22.40,  'c_trn', 'Lyft',                'a3'],
    [4,  'expense', 109.00, 'c_utl', 'PG&E',                'a1'],
    [5,  'expense', 9.50,   'c_din', 'Philz',               'a3'],
    [5,  'expense', 64.12,  'c_gro', "Trader Joe's",        'a1'],
    [6,  'expense', 28.00,  'c_ent', 'AMC Metreon',         'a3'],
    [7,  'transfer', 500.00, null,   'Savings transfer',    'a1', 'a2'],
    [8,  'expense', 18.75,  'c_din', 'Tartine',             'a1'],
    [8,  'expense', 42.30,  'c_shp', 'Amazon',              'a3'],
    [9,  'expense', 11.20,  'c_trn', 'Muni',                'a4'],
    [10, 'expense', 52.00,  'c_hlth','One Medical',         'a1'],
    [11, 'expense', 76.44,  'c_gro', 'Safeway',             'a1'],
    [12, 'income',  820.00, 'c_frl', 'Freelance invoice',   'a1'],
    [12, 'expense', 21.00,  'c_din', 'Souvla',              'a3'],
    [13, 'expense', 8.99,   'c_sub', 'NYT',                 'a3'],
    [14, 'expense', 134.20, 'c_shp', 'Apple Store',         'a3'],
    [15, 'expense', 6.50,   'c_din', 'Sightglass',          'a4'],
    [16, 'expense', 15.00,  'c_trn', 'BART',                'a4'],
    [17, 'expense', 31.12,  'c_gro', 'Rainbow Grocery',     'a1'],
    [18, 'expense', 19.99,  'c_sub', 'Claude Pro',          'a3'],
    [19, 'expense', 85.00,  'c_ent', 'Fillmore Concert',    'a3'],
    [20, 'expense', 14.20,  'c_din', 'Che Fico',            'a1'],
    [21, 'expense', 48.50,  'c_gro', 'Bi-Rite',             'a1'],
    [22, 'expense', 38.00,  'c_utl', 'Comcast',             'a1'],
    [23, 'expense', 2850.00,'c_rent','Rent',                'a1'],
    [24, 'expense', 112.88, 'c_shp', 'Muji',                'a3'],
    [25, 'expense', 7.40,   'c_din', 'Reveille',            'a3'],
    [26, 'expense', 18.20,  'c_trn', 'Uber',                'a3'],
    [28, 'expense', 58.10,  'c_gro', "Gus's Market",        'a1'],
    [30, 'income',  4250.00,'c_sal', 'Acme Payroll',        'a1'],
    [31, 'expense', 96.00,  'c_utl', 'Internet',            'a1'],
    [33, 'expense', 22.00,  'c_din', 'Turtle Tower',        'a1'],
    [36, 'expense', 11.99,  'c_sub', 'Notion',              'a3'],
    [38, 'expense', 240.00, 'c_hlth','Pharmacy',            'a1'],
    [42, 'expense', 62.30,  'c_gro', 'Costco',              'a1'],
    [45, 'expense', 185.00, 'c_shp', 'REI',                 'a3'],
    [48, 'expense', 12.50,  'c_din', 'Kantine',             'a4'],
    [52, 'income',  620.00, 'c_frl', 'Consulting',          'a1'],
    [53, 'expense', 2850.00,'c_rent','Rent',                'a1'],
    [55, 'expense', 140.00, 'c_ent', 'Warriors Game',       'a3'],
    [58, 'expense', 74.00,  'c_gro', 'Whole Foods',         'a1'],
  ];

  const transactions = seed.map((row, i) => {
    const [d, type, amount, categoryId, merchant, accountId, toAccountId] = row;
    const base = { id: 't' + i, type, amount, date: daysAgo(d), createdAt: Date.now() - d * 86400000, updatedAt: Date.now() - d * 86400000 };
    if (type === 'transfer') return { ...base, fromAccountId: accountId, toAccountId, notes: merchant };
    return { ...base, accountId, categoryId, merchant };
  });

  const bills = [
    { id: 'b1', name: 'Rent',       amount: 2850.00, frequency: 'monthly', nextDueDate: daysAgo(-8),  accountId: 'a1', categoryId: 'c_rent', active: true, icon: '🏠' },
    { id: 'b2', name: 'Claude Pro', amount: 19.99,   frequency: 'monthly', nextDueDate: daysAgo(-3),  accountId: 'a3', categoryId: 'c_sub',  active: true, icon: '🤖' },
    { id: 'b3', name: 'Comcast',    amount: 96.00,   frequency: 'monthly', nextDueDate: daysAgo(-5),  accountId: 'a1', categoryId: 'c_utl',  active: true, icon: '📡' },
    { id: 'b4', name: 'Spotify',    amount: 14.99,   frequency: 'monthly', nextDueDate: daysAgo(-12), accountId: 'a3', categoryId: 'c_sub',  active: true, icon: '🎧' },
    { id: 'b5', name: 'Gym',        amount: 65.00,   frequency: 'monthly', nextDueDate: daysAgo(-14), accountId: 'a3', categoryId: 'c_hlth', active: true, icon: '🏋️' },
    { id: 'b6', name: 'iCloud+',    amount: 2.99,    frequency: 'monthly', nextDueDate: daysAgo(-18), accountId: 'a3', categoryId: 'c_sub',  active: true, icon: '☁️' },
    { id: 'b7', name: 'Renters Ins',amount: 18.00,   frequency: 'monthly', nextDueDate: daysAgo(-22), accountId: 'a1', categoryId: 'c_utl',  active: true, icon: '🛡️' },
  ];

  const budgets = [
    { id: 'bd1', categoryId: 'c_gro', month: '2026-04', limit: 600 },
    { id: 'bd2', categoryId: 'c_din', month: '2026-04', limit: 300 },
    { id: 'bd3', categoryId: 'c_shp', month: '2026-04', limit: 400 },
    { id: 'bd4', categoryId: 'c_ent', month: '2026-04', limit: 200 },
    { id: 'bd5', categoryId: 'c_trn', month: '2026-04', limit: 150 },
    { id: 'bd6', categoryId: 'c_sub', month: '2026-04', limit: 80 },
  ];

  const user = { name: 'Ella Maren', handle: '$ellamaren', email: 'ella@proton.me', joined: 'Mar 2025', avatar: 'E' };

  const contacts = [
    { id: 'u1', name: 'Marcus Lee',     handle: '$marcuslee',   avatar: 'M' },
    { id: 'u2', name: 'Priya Shah',     handle: '$priyashah',   avatar: 'P' },
    { id: 'u3', name: 'Jordan Ellis',   handle: '$jordan',      avatar: 'J' },
    { id: 'u4', name: 'Sam Okonkwo',    handle: '$samo',        avatar: 'S' },
    { id: 'u5', name: 'Alex Romero',    handle: '$aromero',     avatar: 'A' },
  ];

  return { accounts, categories, transactions, bills, budgets, today, user, contacts };
})();

// Shared utils
window.Utils = (() => {
  const fmtUSD = (n, opts = {}) => {
    const { sign = false, cents = true, compact = false } = opts;
    const abs = Math.abs(n);
    if (compact && abs >= 1000) return (n < 0 ? '−' : sign ? '+' : '') + '$' + (abs/1000).toFixed(abs >= 10000 ? 0 : 1) + 'k';
    const s = abs.toLocaleString('en-US', { style:'currency', currency:'USD', minimumFractionDigits: cents?2:0, maximumFractionDigits: cents?2:0 });
    if (sign) return (n < 0 ? '−' : '+') + s;
    return (n < 0 ? '−' : '') + s;
  };
  const parseDate = (s) => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
  const fmtDate = (s) => parseDate(s).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const fmtRelDay = (s, today) => {
    const d = parseDate(s);
    const diff = Math.round((today - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return diff + 'd ago';
    return fmtDate(s);
  };
  return { fmtUSD, parseDate, fmtDate, fmtRelDay };
})();
