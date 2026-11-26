(() => {
  'use strict';

  const OWNER_EMAIL = 'sandeepharmen@gmail.com';
  const money = paise => '₹' + (Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const el = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== '') node.textContent = text;
    return node;
  };
  const inputField = (labelText, name, type = 'text', options = {}) => {
    const label = el('label', '', labelText);
    const input = el('input');
    input.name = name;
    input.type = type;
    if (options.required) input.required = true;
    if (options.min !== undefined) input.min = String(options.min);
    if (options.step !== undefined) input.step = String(options.step);
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.value !== undefined) input.value = String(options.value);
    if (options.placeholder) input.placeholder = options.placeholder;
    label.append(input);
    return label;
  };
  const selectField = (labelText, name, options, required = true) => {
    const label = el('label', '', labelText);
    const select = el('select');
    select.name = name;
    select.required = required;
    for (const [value, text] of options) select.add(new Option(text, value));
    label.append(select);
    return label;
  };
  const statusLine = () => el('small', 'owner-live-status');
  const actionButton = (text, className = 'auth-switch') => {
    const button = el('button', className, text);
    button.type = 'button';
    return button;
  };
  const addSubmit = (form, text) => {
    const button = el('button', 'auth-submit', text);
    button.type = 'submit';
    form.append(button, statusLine());
    return button;
  };
  const setStatus = (form, text, error = false) => {
    const note = form.querySelector('.owner-live-status');
    if (note) {
      note.textContent = text;
      note.classList.toggle('owner-live-error', error);
    }
  };
  const withSubmit = async (form, action, successText) => {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus(form, 'Saving…');
    try {
      await action(new FormData(form));
      setStatus(form, successText);
      return true;
    } catch (error) {
      setStatus(form, error.message || 'Could not save this record.', true);
      return false;
    } finally {
      button.disabled = false;
    }
  };
  const safeLink = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const csvCell = value => {
    let text = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const downloadCsv = (filename, columns, rows) => {
    const csv = '\uFEFF' + [columns.map(csvCell).join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = el('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const schemaSetupHint = error => {
    const message = String(error?.message || '');
    if (/schema cache|could not find the table|relation .* does not exist|404/i.test(message)) {
      return 'Dashboard database migration is not installed yet. The owner-only data tables must be applied before these records can sync.';
    }
    return message || 'Could not load this dashboard data.';
  };
  const localDateKey = value => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };

  let activePcTimer = null;
  const stopPcTimer = () => { if (activePcTimer) clearInterval(activePcTimer); activePcTimer = null; };

  function enhance(root) {
    const backend = window.DeepCSCBackend;
    const owner = backend?.getAccount?.();
    if (!owner || String(owner.email || '').toLowerCase() !== OWNER_EMAIL || backend.getAssuranceLevel?.() !== 'aal2') return;
    if (!root.querySelector('.owner-page-head') || root.querySelector('#owner-live-integrations')) return;

    stopPcTimer();
    const operations = root.querySelector('#owner-operations');
    if (!operations) return;
    const existingHint = operations.querySelector('.password-note');
    if (existingHint) existingHint.textContent = 'Payments and centre operations below save to your owner-only Supabase records. Gateway payments and the CSC portal wallet still need provider access.';
    const cards = [...operations.querySelectorAll('.owner-operation-card')];
    const cardStates = [
      ['Deadlines & renewals', 'Owner-managed job, scholarship and customer reminders', 'Connected'],
      ['Staff & daily expenses', 'Owner-recorded centre expenses; staff sign-in is not enabled', 'Expenses connected'],
      ['Inventory & low-stock alerts', 'Current stock quantities and reorder thresholds', 'Connected'],
      ['Cyber cafe PCs & timers', 'Start and stop timed sessions; estimated charge is recorded', 'Manual timer'],
      ['Payments & wallet balance', 'Manual due/receipt ledger; no gateway verification', 'Manual ledger'],
      ['Document checklist follow-up', 'Service checklist and customer status follow-up', 'Checklist available']
    ];
    cards.forEach((card, index) => {
      const state = card.querySelector('span');
      const detail = card.querySelector('p');
      if (!cardStates[index]) return;
      if (state) {
        state.textContent = cardStates[index][2];
        state.className = 'is-connected';
      }
      if (detail) detail.textContent = cardStates[index][1];
    });
    const setOperationState = (index, label, connected) => {
      const state = cards[index]?.querySelector('span');
      if (!state) return;
      state.textContent = label;
      state.className = connected ? 'is-connected' : 'is-pending';
    };

    const rootPanel = el('div', 'owner-live-integrations');
    rootPanel.id = 'owner-live-integrations';
    const heading = el('h4', '', 'Live centre records');
    const intro = el('p', 'password-note', 'Amounts and stock below are manually recorded by the owner. They are not verified by a bank, payment gateway or government portal.');
    const grid = el('div', 'owner-live-grid');
    const finance = el('section', 'owner-live-card');
    const expenses = el('section', 'owner-live-card');
    const inventory = el('section', 'owner-live-card');
    const reminders = el('section', 'owner-live-card');
    const pcs = el('section', 'owner-live-card');
    const activity = el('section', 'owner-live-card owner-live-activity');
    grid.append(finance, expenses, inventory, reminders, pcs, activity);
    rootPanel.append(heading, intro, grid);
    operations.append(rootPanel);

    let applications = [];
    let paymentRows = [];
    let expenseRows = [];
    let inventoryRows = [];
    let reminderRows = [];
    let pcRows = [];
    let applicationLoadError = '';
    let paymentLedgerReady = false;
    let expensesReady = false;

    const recordActivity = (type, id, details = {}) => backend.recordOwnerDashboardActivity(type, id, details).catch(() => {});
    const refreshFinance = async () => {
      const results = await Promise.allSettled([backend.listOwnerPayments(), backend.listOwnerExpenses()]);
      if (results[0].status === 'fulfilled') {
        paymentRows = results[0].value || [];
        paymentLedgerReady = true;
        setOperationState(4, 'Manual ledger connected', true);
      } else {
        paymentRows = [];
        paymentLedgerReady = false;
        setOperationState(4, 'Ledger setup needed', false);
      }
      if (results[1].status === 'fulfilled') {
        expenseRows = results[1].value || [];
        expensesReady = true;
        setOperationState(1, 'Expenses connected', true);
      } else {
        expenseRows = [];
        expensesReady = false;
        setOperationState(1, 'Expense setup needed', false);
      }
      renderFinance(results[0].status === 'rejected' ? results[0].reason : null);
      renderExpenses(results[1].status === 'rejected' ? results[1].reason : null);
      updateOverview();
    };
    const updateOverview = () => {
      const today = localDateKey(new Date());
      const month = today.slice(0, 7);
      const paidRows = paymentRows.filter(row => row.status === 'paid');
      const receivedToday = paidRows.filter(row => row.paid_at && localDateKey(new Date(row.paid_at)) === today).reduce((sum, row) => sum + Number(row.total_amount_paise || 0), 0);
      const due = paymentRows.filter(row => row.status === 'due').reduce((sum, row) => sum + Number(row.total_amount_paise || 0), 0);
      const paidThisMonth = paidRows.filter(row => row.paid_at && localDateKey(new Date(row.paid_at)).slice(0, 7) === month);
      const government = paidThisMonth.reduce((sum, row) => sum + Number(row.government_fee_paise || 0), 0);
      const service = paidThisMonth.reduce((sum, row) => sum + Number(row.service_charge_paise || 0), 0);
      const spent = expenseRows.filter(row => String(row.spent_on || '').startsWith(month)).reduce((sum, row) => sum + Number(row.amount_paise || 0), 0);
      const stats = root.querySelectorAll('.owner-stat');
      if (stats[4]?.querySelector('strong')) stats[4].querySelector('strong').textContent = paymentLedgerReady ? money(receivedToday) + ' / ' + money(due) : 'Not synced';
      if (stats[4]?.querySelector('small')) stats[4].querySelector('small').textContent = paymentLedgerReady ? 'Today’s manual receipts / open dues' : 'Manual payment ledger unavailable';
      if (stats[5]?.querySelector('strong')) stats[5].querySelector('strong').textContent = 'Not linked';
      if (stats[5]?.querySelector('small')) stats[5].querySelector('small').textContent = 'CSC portal wallet API unavailable';
      const panel = [...root.querySelectorAll('.owner-insight-panel')].find(node => node.querySelector('strong')?.textContent === 'Revenue, dues & CSC wallet');
      if (panel) {
        panel.classList.toggle('owner-finance-unavailable', !(paymentLedgerReady && expensesReady));
        const p = panel.querySelector('p');
        if (p) p.textContent = paymentLedgerReady && expensesReady
          ? `Open dues ${money(due)} · this month: government fees ${money(government)} · centre charges ${money(service)} · expenses ${money(spent)} · estimated centre balance after expenses ${money(service - spent)}. Manually recorded entries only; customer payments are not gateway verified.`
          : 'Finance figures are hidden until both owner-only payment and expense tables are available. Manual entries are not bank-verified and are not customer checkout.';
      }
    };

    function renderFinance(loadError = null) {
      finance.replaceChildren();
      finance.append(el('h5', '', 'Payment ledger & receipts'));
      finance.append(el('p', 'password-note', 'Create a due quote after checking the customer files. Mark money received only after you confirm it in the selected payment app or at the counter.'));
      if (applicationLoadError) finance.append(el('p', 'owner-live-error', 'Applications could not load for linking: ' + applicationLoadError));
      if (loadError) finance.append(el('p', 'owner-live-error', schemaSetupHint(loadError)));
      const exportLedger = actionButton('Export ledger CSV');
      exportLedger.disabled = !paymentLedgerReady;
      exportLedger.onclick = () => downloadCsv('punjab-csc-payment-ledger.csv', ['Service', 'Government fee INR', 'Centre charge INR', 'Total INR', 'Status', 'Method', 'Payment reference', 'Created', 'Paid at', 'Notes'], paymentRows.map(row => [row.service_name, Number(row.government_fee_paise) / 100, Number(row.service_charge_paise) / 100, Number(row.total_amount_paise) / 100, row.status, row.method, row.payment_reference, row.created_at, row.paid_at, row.notes]));
      finance.append(exportLedger);
      const form = el('form', 'owner-admin-form owner-live-form');
      const applicationLabel = selectField('Application (optional)', 'applicationId', [['', 'Unlinked / walk-in record'], ...applications.map(app => [app.id, `${String(app.id).slice(0, 8).toUpperCase()} · ${app.service} · ${app.applicant_name}`])], false);
      const service = inputField('Service', 'serviceName', 'text', { required: true, maxLength: 180 });
      applicationLabel.querySelector('select').onchange = event => {
        const app = applications.find(item => item.id === event.target.value);
        if (app) service.querySelector('input').value = app.service || '';
      };
      const amounts = el('div', 'owner-form-grid');
      amounts.append(inputField('Government fee (₹)', 'governmentFeeRupees', 'number', { min: 0, step: '0.01', value: 0, required: true }), inputField('Punjab CSC charge (₹)', 'serviceChargeRupees', 'number', { min: 0, step: '0.01', value: 0, required: true }));
      form.append(applicationLabel, service, amounts, inputField('Note', 'notes', 'text', { maxLength: 500, placeholder: 'Optional quote / service note' }));
      const save = addSubmit(form, 'Add amount due');
      const list = el('div', 'owner-record-list');
      form.onsubmit = async event => {
        event.preventDefault();
        const ok = await withSubmit(form, async data => {
          const result = await backend.createOwnerPayment({ applicationId: data.get('applicationId'), serviceName: data.get('serviceName'), governmentFeeRupees: data.get('governmentFeeRupees'), serviceChargeRupees: data.get('serviceChargeRupees'), notes: data.get('notes') });
          const row = Array.isArray(result) ? result[0] : result;
          await recordActivity('manual_payment_due_created', row?.id, { total_amount_paise: row?.total_amount_paise || 0 });
          form.reset();
          await refreshFinance();
        }, 'Due record saved.');
        if (!ok) save.disabled = false;
      };
      paymentRows.forEach(row => {
        const item = el('article', 'owner-record-card');
        const customer = row.customer_applications || {};
        item.append(el('strong', '', `${row.service_name} · ${money(row.total_amount_paise)}`));
        item.append(el('small', '', `${customer.applicant_name || 'Walk-in / unlinked'} · ${row.status}${row.method ? ' · ' + row.method.replaceAll('_', ' ') : ''} · ${new Date(row.created_at).toLocaleString('en-IN')}`));
        if (row.payment_reference) item.append(el('small', '', 'Reference: ' + row.payment_reference));
        const actions = el('div', 'owner-live-actions');
        if (row.status === 'due') {
          const method = selectField('Received by', 'method', [['upi','UPI'],['cash','Cash'],['bank_transfer','Bank transfer'],['card','Card'],['other','Other']]);
          const reference = inputField('Payment reference (optional)', 'reference', 'text', { maxLength: 160 });
          const paid = actionButton('Record payment received', 'auth-submit');
          paid.onclick = async () => {
            paid.disabled = true;
            try {
              await backend.updateOwnerPayment(row.id, 'paid', method.querySelector('select').value, reference.querySelector('input').value);
              await recordActivity('manual_payment_received_recorded', row.id, { total_amount_paise: row.total_amount_paise, method: method.querySelector('select').value });
              await refreshFinance();
            } catch (error) { window.alert(error.message); paid.disabled = false; }
          };
          const cancel = actionButton('Cancel due');
          cancel.onclick = async () => {
            cancel.disabled = true;
            try { await backend.updateOwnerPayment(row.id, 'cancelled'); await recordActivity('manual_payment_due_cancelled', row.id); await refreshFinance(); }
            catch (error) { window.alert(error.message); cancel.disabled = false; }
          };
          actions.append(method, reference, paid, cancel);
        } else if (row.status === 'paid') {
          const receipt = actionButton('Print receipt');
          receipt.onclick = () => printReceipt(row);
          actions.append(receipt);
        }
        item.append(actions);
        list.append(item);
      });
      if (!paymentRows.length) list.append(el('p', 'password-note', 'No payment records yet.'));
      finance.append(form, list);
    }

    function printReceipt(row) {
      const customer = row.customer_applications || {};
      const popup = window.open('', '_blank');
      if (!popup) { window.alert('Allow the receipt window, then try again.'); return; }
      const receiptId = String(row.id || '').slice(0, 8).toUpperCase();
      popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Punjab CSC receipt ${receiptId}</title><style>body{font:16px Arial,sans-serif;max-width:700px;margin:36px auto;color:#173d34}h1{margin-bottom:4px}small{color:#53675f}.row{display:flex;justify-content:space-between;border-bottom:1px solid #d7e2dd;padding:10px 0}.total{font-weight:700;font-size:20px;margin-top:18px}</style></head><body><h1>Punjab CSC</h1><small>Chhajli, Sunam · WhatsApp +91 79866 30948</small><h2>Payment receipt</h2><div class="row"><span>Receipt reference</span><b>${escapeHtml(receiptId)}</b></div><div class="row"><span>Customer</span><b>${escapeHtml(customer.applicant_name || 'Walk-in customer')}</b></div><div class="row"><span>Service</span><b>${escapeHtml(row.service_name)}</b></div><div class="row"><span>Government fee</span><b>${escapeHtml(money(row.government_fee_paise))}</b></div><div class="row"><span>Centre charge</span><b>${escapeHtml(money(row.service_charge_paise))}</b></div><div class="row total"><span>Received</span><b>${escapeHtml(money(row.total_amount_paise))}</b></div><div class="row"><span>Method</span><b>${escapeHtml(row.method || 'Not recorded')}</b></div><div class="row"><span>Payment date</span><b>${escapeHtml(row.paid_at ? new Date(row.paid_at).toLocaleString('en-IN') : '')}</b></div><p>Keep this receipt for your records. Government fee and Punjab CSC service charge are shown separately.</p></body></html>`);
      popup.document.close();
      window.setTimeout(() => popup.print(), 250);
    }

    function renderExpenses(loadError = null) {
      expenses.replaceChildren();
      expenses.append(el('h5', '', 'Daily expenses'));
      if (loadError) expenses.append(el('p', 'owner-live-error', schemaSetupHint(loadError)));
      const exportExpenses = actionButton('Export expenses CSV');
      exportExpenses.disabled = !expensesReady;
      exportExpenses.onclick = () => downloadCsv('punjab-csc-business-expenses.csv', ['Category', 'Amount INR', 'Date', 'Notes'], expenseRows.map(row => [row.category, Number(row.amount_paise) / 100, row.spent_on, row.notes]));
      expenses.append(exportExpenses);
      const form = el('form', 'owner-admin-form owner-live-form');
      const category = selectField('Category', 'category', [['paper','Paper'],['ink','Ink / toner'],['electricity','Electricity'],['internet','Internet'],['tea','Tea / water'],['repairs','Repairs'],['other','Other']]);
      const amount = inputField('Amount (₹)', 'amountRupees', 'number', { min: 0.01, step: '0.01', required: true });
      const date = inputField('Date', 'spentOn', 'date', { required: true, value: localDateKey(new Date()) });
      const note = inputField('Note', 'notes', 'text', { maxLength: 500 });
      form.append(category, amount, date, note);
      const save = addSubmit(form, 'Save expense');
      form.onsubmit = async event => {
        event.preventDefault();
        const ok = await withSubmit(form, async data => {
          const result = await backend.createOwnerExpense({ category: data.get('category'), amountRupees: data.get('amountRupees'), spentOn: data.get('spentOn'), notes: data.get('notes') });
          const row = Array.isArray(result) ? result[0] : result;
          await recordActivity('business_expense_created', row?.id, { category: data.get('category'), amount_paise: row?.amount_paise || 0 });
          form.reset(); date.querySelector('input').value = localDateKey(new Date());
          await refreshFinance();
        }, 'Expense saved.');
        if (!ok) save.disabled = false;
      };
      expenses.append(form);
      expenses.append(el('p', 'password-note', 'Recorded total: ' + money(expenseRows.reduce((sum, row) => sum + Number(row.amount_paise || 0), 0))));
      const list = el('div', 'owner-record-list');
      expenseRows.slice(0, 20).forEach(row => {
        const item = el('article', 'owner-record-card');
        item.append(el('strong', '', `${row.category} · ${money(row.amount_paise)}`));
        item.append(el('small', '', `${row.spent_on}${row.notes ? ' · ' + row.notes : ''}`));
        const remove = actionButton('Delete');
        remove.onclick = async () => { if (!window.confirm('Delete this expense entry?')) return; remove.disabled = true; try { await backend.deleteOwnerExpense(row.id); await recordActivity('business_expense_deleted', row.id); await refreshFinance(); } catch (error) { window.alert(error.message); remove.disabled = false; } };
        item.append(remove); list.append(item);
      });
      if (!expenseRows.length) list.append(el('p', 'password-note', 'No expenses recorded yet.'));
      expenses.append(list);
    }

    async function refreshInventory() {
      try { inventoryRows = await backend.listOwnerInventory() || []; setOperationState(2, 'Inventory connected', true); renderInventory(); }
      catch (error) { setOperationState(2, 'Inventory setup needed', false); inventory.replaceChildren(el('h5', '', 'Inventory & low-stock alerts'), el('p', 'owner-live-error', schemaSetupHint(error))); }
    }
    function renderInventory(editRow = null) {
      inventory.replaceChildren();
      inventory.append(el('h5', '', 'Inventory & low-stock alerts'));
      const form = el('form', 'owner-admin-form owner-live-form');
      const name = inputField('Item', 'itemName', 'text', { required: true, maxLength: 120, placeholder: 'PVC card, paper, ink…' });
      const quantity = inputField('Current quantity', 'quantity', 'number', { required: true, min: 0, step: '0.01' });
      const unit = inputField('Unit', 'unit', 'text', { required: true, maxLength: 24, value: 'pieces' });
      const threshold = inputField('Low-stock alert at', 'lowStockAt', 'number', { required: true, min: 0, step: '0.01', value: 1 });
      const cost = inputField('Unit cost (₹, optional)', 'unitCostRupees', 'number', { min: 0, step: '0.01' });
      const row = el('div', 'owner-form-grid'); row.append(quantity, unit, threshold, cost);
      form.append(name, row);
      const save = addSubmit(form, 'Save stock');
      if (editRow) {
        name.querySelector('input').value = editRow.item_name;
        quantity.querySelector('input').value = editRow.quantity;
        unit.querySelector('input').value = editRow.unit;
        threshold.querySelector('input').value = editRow.low_stock_at;
        cost.querySelector('input').value = editRow.unit_cost_paise === null ? '' : (Number(editRow.unit_cost_paise) / 100).toFixed(2);
      }
      form.onsubmit = async event => {
        event.preventDefault();
        const ok = await withSubmit(form, async data => {
          const result = await backend.saveOwnerInventoryItem({ itemName: data.get('itemName'), quantity: data.get('quantity'), unit: data.get('unit'), lowStockAt: data.get('lowStockAt'), unitCostRupees: data.get('unitCostRupees') });
          const saved = Array.isArray(result) ? result[0] : result;
          await recordActivity('inventory_item_saved', saved?.id, { item: String(data.get('itemName') || '').slice(0, 120), quantity: Number(data.get('quantity')) });
          form.reset();
          await refreshInventory();
        }, 'Stock saved.');
        if (!ok) save.disabled = false;
      };
      inventory.append(form);
      const list = el('div', 'owner-record-list');
      inventoryRows.forEach(item => {
        const row = el('article', 'owner-record-card');
        const low = Number(item.quantity) <= Number(item.low_stock_at);
        row.append(el('strong', '', `${item.item_name} · ${item.quantity} ${item.unit}${low ? ' · LOW STOCK' : ''}`));
        row.append(el('small', '', `Alert threshold ${item.low_stock_at}${item.unit_cost_paise !== null ? ' · Unit cost ' + money(item.unit_cost_paise) : ''}`));
        const edit = actionButton('Edit'); edit.onclick = () => renderInventory(item);
        const remove = actionButton('Delete'); remove.onclick = async () => { if (!window.confirm('Delete this stock item?')) return; remove.disabled = true; try { await backend.deleteOwnerInventoryItem(item.id); await recordActivity('inventory_item_deleted', item.id); await refreshInventory(); } catch (error) { window.alert(error.message); remove.disabled = false; } };
        const actions = el('div', 'owner-live-actions'); actions.append(edit, remove); row.append(actions); list.append(row);
      });
      if (!inventoryRows.length) list.append(el('p', 'password-note', 'No inventory items recorded yet.'));
      inventory.append(list);
    }

    async function refreshReminders() {
      try { reminderRows = await backend.listOwnerReminders() || []; setOperationState(0, 'Reminders connected', true); renderReminders(); }
      catch (error) { setOperationState(0, 'Reminder setup needed', false); reminders.replaceChildren(el('h5', '', 'Deadlines & renewals'), el('p', 'owner-live-error', schemaSetupHint(error))); }
    }
    function renderReminders() {
      reminders.replaceChildren();
      reminders.append(el('h5', '', 'Deadlines & renewals'));
      const form = el('form', 'owner-admin-form owner-live-form');
      const type = selectField('Type', 'reminderType', [['job','Job / recruitment'],['scholarship','Scholarship'],['tax','Tax'],['insurance','Insurance'],['puc','PUC'],['licence','Licence'],['followup','Customer follow-up'],['other','Other']]);
      const title = inputField('Reminder title', 'title', 'text', { required: true, maxLength: 160 });
      const due = inputField('Due date', 'dueOn', 'date', { required: true });
      const link = inputField('Official HTTPS link (optional)', 'officialUrl', 'url', { maxLength: 2048, placeholder: 'https://…' });
      const notes = inputField('Notes', 'notes', 'text', { maxLength: 600 });
      form.append(type, title, due, link, notes);
      const save = addSubmit(form, 'Save reminder');
      form.onsubmit = async event => {
        event.preventDefault();
        const ok = await withSubmit(form, async data => {
          const result = await backend.createOwnerReminder({ reminderType: data.get('reminderType'), title: data.get('title'), dueOn: data.get('dueOn'), officialUrl: data.get('officialUrl'), notes: data.get('notes') });
          const saved = Array.isArray(result) ? result[0] : result;
          await recordActivity('reminder_created', saved?.id, { reminder_type: data.get('reminderType'), due_on: data.get('dueOn') });
          form.reset(); await refreshReminders();
        }, 'Reminder saved.');
        if (!ok) save.disabled = false;
      };
      reminders.append(form);
      const list = el('div', 'owner-record-list');
      reminderRows.forEach(item => {
        const card = el('article', 'owner-record-card');
        card.append(el('strong', '', `${item.title} · ${item.due_on}${item.completed ? ' · Done' : ''}`));
        card.append(el('small', '', `${item.reminder_type.replaceAll('_', ' ')}${item.notes ? ' · ' + item.notes : ''}`));
        const actions = el('div', 'owner-live-actions');
        const href = safeLink(item.official_url || '');
        if (href) { const anchor = el('a', 'auth-switch', 'Open official link ↗'); anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; actions.append(anchor); }
        if (!item.completed) {
          const done = actionButton('Mark complete'); done.onclick = async () => { done.disabled = true; try { await backend.updateOwnerReminder(item.id, true); await recordActivity('reminder_completed', item.id); await refreshReminders(); } catch (error) { window.alert(error.message); done.disabled = false; } };
          actions.append(done);
        }
        const remove = actionButton('Delete'); remove.onclick = async () => { if (!window.confirm('Delete this reminder?')) return; remove.disabled = true; try { await backend.deleteOwnerReminder(item.id); await recordActivity('reminder_deleted', item.id); await refreshReminders(); } catch (error) { window.alert(error.message); remove.disabled = false; } };
        actions.append(remove); card.append(actions); list.append(card);
      });
      if (!reminderRows.length) list.append(el('p', 'password-note', 'No reminders saved yet.'));
      reminders.append(list);
    }

    async function refreshPcSessions() {
      try { pcRows = await backend.listOwnerPcSessions() || []; setOperationState(3, 'Timer connected', true); renderPcSessions(); }
      catch (error) { setOperationState(3, 'Timer setup needed', false); pcs.replaceChildren(el('h5', '', 'Cyber cafe PC sessions'), el('p', 'owner-live-error', schemaSetupHint(error))); }
    }
    function renderPcSessions() {
      stopPcTimer();
      pcs.replaceChildren();
      pcs.append(el('h5', '', 'Cyber cafe PC sessions'));
      const form = el('form', 'owner-admin-form owner-live-form');
      form.append(inputField('Computer label', 'computerLabel', 'text', { required: true, maxLength: 40, placeholder: 'PC-01' }), inputField('Rate per hour (₹)', 'hourlyRateRupees', 'number', { required: true, min: 0, step: '0.01', value: 0 }));
      const save = addSubmit(form, 'Start session');
      form.onsubmit = async event => {
        event.preventDefault();
        const ok = await withSubmit(form, async data => {
          const result = await backend.startOwnerPcSession({ computerLabel: data.get('computerLabel'), hourlyRateRupees: data.get('hourlyRateRupees') });
          const saved = Array.isArray(result) ? result[0] : result;
          await recordActivity('pc_session_started', saved?.id, { computer_label: data.get('computerLabel') });
          form.reset(); form.elements.hourlyRateRupees.value = '0'; await refreshPcSessions();
        }, 'Session started.');
        if (!ok) save.disabled = false;
      };
      pcs.append(form);
      const list = el('div', 'owner-record-list');
      pcRows.forEach(session => {
        const row = el('article', 'owner-record-card');
        const title = el('strong', '', `${session.computer_label} · ${session.status}`);
        const started = Date.parse(session.started_at);
        const elapsed = el('small', '', 'Started ' + new Date(session.started_at).toLocaleTimeString('en-IN'));
        if (session.status === 'running') {
          elapsed.className = 'pc-session-elapsed';
          elapsed.dataset.started = String(started);
          elapsed.dataset.rate = String(session.hourly_rate_paise || 0);
          const end = actionButton('End session');
          end.onclick = async () => { end.disabled = true; try { await backend.endOwnerPcSession(session.id); await recordActivity('pc_session_ended', session.id); await refreshPcSessions(); } catch (error) { window.alert(error.message); end.disabled = false; } };
          row.append(title, elapsed, el('small', '', 'Charge is an estimate from the entered hourly rate; no payment is processed.'), end);
        } else {
          elapsed.textContent = `${new Date(session.started_at).toLocaleString('en-IN')} · Estimated charge ${money(session.total_amount_paise)}`;
          row.append(title, elapsed);
        }
        list.append(row);
      });
      if (!pcRows.length) list.append(el('p', 'password-note', 'No PC sessions recorded yet.'));
      pcs.append(list);
      const update = () => pcs.querySelectorAll('.pc-session-elapsed').forEach(node => {
        const elapsedSeconds = Math.max(0, (Date.now() - Number(node.dataset.started)) / 1000);
        const amount = Math.ceil(elapsedSeconds * Number(node.dataset.rate || 0) / 3600);
        node.textContent = `Running ${Math.floor(elapsedSeconds / 60)} min · estimated ${money(amount)}`;
      });
      update(); activePcTimer = setInterval(update, 15000);
    }

    async function refreshActivity() {
      activity.replaceChildren(el('h5', '', 'Dashboard activity log'));
      try {
        const rows = await backend.listOwnerDashboardActivity();
        if (!rows.length) activity.append(el('p', 'password-note', 'No dashboard changes recorded yet.'));
        rows.forEach(event => {
          const card = el('article', 'owner-record-card');
          card.append(el('strong', '', event.event_type.replaceAll('_', ' ')));
          card.append(el('small', '', new Date(event.created_at).toLocaleString('en-IN')));
          const details = Object.entries(event.details || {}).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value)}`).join(' · ');
          if (details) card.append(el('p', '', details));
          activity.append(card);
        });
      } catch (error) { activity.append(el('p', 'owner-live-error', error.message)); }
    }

    async function loadApplications() {
      try { applications = await backend.listOwnerApplications() || []; }
      catch (error) { applicationLoadError = schemaSetupHint(error); }
    }

    function connectSettings() {
      const settingsForm = root.querySelector('.owner-settings-form');
      if (!settingsForm) return;
      const help = root.querySelector('.owner-settings-section .password-note');
      if (help) help.textContent = 'Profile, tariff notes, receipt details, message templates and QR image are saved to the private owner database. These values do not activate a payment gateway or publish unverified prices.';
      const paymentIntro = root.querySelector('.owner-payment-section .password-note');
      if (paymentIntro) paymentIntro.textContent = 'Provider and accepted-method preferences sync to the owner database. No gateway credentials are collected here; checkout remains disabled until a secure server integration is configured.';
      const paymentForm = root.querySelector('.owner-payment-form');
      const loadSettings = async () => {
        try {
          const saved = await backend.getOwnerSettings();
          if (!saved || typeof saved !== 'object') {
            const localDraft = (() => { try { return JSON.parse(localStorage.getItem('punjab-csc-owner-settings-v1') || 'null'); } catch { return null; } })();
            const note = settingsForm.querySelector('.owner-settings-saved');
            if (note && localDraft) note.textContent = 'Showing this browser’s older draft. Save settings to sync them to your owner account.';
            return {};
          }
          for (const field of ['centerName','cscId','address','mobile','email','receiptNote','logoUrl','welcomeTemplate','completedTemplate','followupTemplate','paymentTemplate','upiId']) {
            if (settingsForm.elements[field] && typeof saved[field] === 'string') settingsForm.elements[field].value = saved[field];
          }
          const rates = saved.rates || {};
          settingsForm.querySelectorAll('.owner-settings-rates input').forEach(input => { if (typeof rates[input.name] === 'string') input.value = rates[input.name]; });
          const existing = new Set([...settingsForm.querySelectorAll('.owner-settings-rates th[scope="row"]')].map(cell => cell.textContent.toLowerCase()));
          for (const name of (Array.isArray(saved.customServices) ? saved.customServices : [])) {
            if (!existing.has(String(name).toLowerCase())) {
              settingsForm.elements.newServiceName.value = String(name);
              settingsForm.querySelector('#owner-add-service')?.click();
            }
          }
          const qr = settingsForm.querySelector('.owner-settings-qr-preview img');
          const qrBox = settingsForm.querySelector('.owner-settings-qr-preview');
          if (qr && typeof saved.qrDataUrl === 'string' && saved.qrDataUrl.startsWith('data:image/')) { qr.src = saved.qrDataUrl; if (qrBox) qrBox.hidden = false; }
          const note = settingsForm.querySelector('.owner-settings-saved');
          if (note) note.textContent = 'Settings loaded from your private owner account.';
          return saved;
        } catch (error) {
          if (help) help.textContent = 'Settings could not load from Supabase: ' + error.message;
          return {};
        }
      };
      loadSettings().then(saved => {
        if (!paymentForm) return;
        const draft = saved.paymentSetup;
        if (draft && typeof draft === 'object') {
          paymentForm.elements.provider.value = typeof draft.provider === 'string' ? draft.provider : '';
          for (const method of (Array.isArray(draft.methods) ? draft.methods : [])) {
            const input = paymentForm.querySelector(`input[name="methods"][value="${CSS.escape(method)}"]`);
            if (input) input.checked = true;
          }
          const status = paymentForm.querySelector('.owner-payment-saved');
          if (status) status.textContent = draft.savedAt ? 'Preferences saved to this owner account.' : '';
        } else {
          const status = paymentForm.querySelector('.owner-payment-saved');
          if (status) status.textContent = 'No provider preferences are synced yet. Saving a selection will not turn on checkout.';
        }
      });
      settingsForm.onsubmit = async event => {
        event.preventDefault();
        const data = new FormData(settingsForm);
        const settings = { ...((await backend.getOwnerSettings().catch(() => null)) || {}), savedAt: new Date().toISOString() };
        for (const field of ['centerName','cscId','address','mobile','email','receiptNote','logoUrl','welcomeTemplate','completedTemplate','followupTemplate','paymentTemplate','upiId']) settings[field] = String(data.get(field) || '').trim();
        settings.rates = {};
        const names = [...settingsForm.querySelectorAll('.owner-settings-rates th[scope="row"]')].map(cell => cell.textContent);
        let baseNames = [];
        try { baseNames = JSON.parse(settingsForm.dataset.baseServiceNames || '[]'); } catch { baseNames = []; }
        settings.customServices = names.filter(name => !baseNames.some(base => String(base).toLowerCase() === name.toLowerCase()));
        settingsForm.querySelectorAll('.owner-settings-rates input').forEach(input => { settings.rates[input.name] = input.value.trim(); });
        const qr = settingsForm.querySelector('.owner-settings-qr-preview img');
        if (qr && qr.src.startsWith('data:image/')) settings.qrDataUrl = qr.src;
        if (settingsForm.querySelector('.owner-settings-qr-preview')?.hidden) settings.qrDataUrl = '';
        const button = settingsForm.querySelector('button[type="submit"]');
        const note = settingsForm.querySelector('.owner-settings-saved');
        button.disabled = true;
        try {
          await backend.saveOwnerSettings(settings);
          await backend.recordOwnerDashboardActivity('center_settings_updated', null, { fields_saved: Object.keys(settings).length });
          note.textContent = 'Settings saved securely to your owner account.';
        } catch (error) { note.textContent = error.message; }
        finally { button.disabled = false; }
      };
      settingsForm.querySelector('#owner-add-service')?.addEventListener('click', () => {
        window.setTimeout(() => {
          const note = settingsForm.querySelector('.owner-settings-saved');
          if (note?.textContent.includes('Service added')) note.textContent = 'Service draft added. Save settings to sync this service to your owner account.';
        }, 0);
      });
      if (paymentForm) paymentForm.onsubmit = async event => {
        event.preventDefault();
        const data = new FormData(paymentForm), provider = String(data.get('provider') || ''), methods = data.getAll('methods').map(String);
        const note = paymentForm.querySelector('.owner-payment-saved');
        if (!provider || !methods.length) { note.textContent = 'Choose a provider and at least one planned payment method.'; return; }
        const button = paymentForm.querySelector('button[type="submit"]'); button.disabled = true;
        try {
          const saved = (await backend.getOwnerSettings().catch(() => null)) || {};
          const settings = { ...saved, paymentSetup: { provider, methods, savedAt: new Date().toISOString() } };
          await backend.saveOwnerSettings(settings);
          await backend.recordOwnerDashboardActivity('payment_preferences_saved', null, { provider, method_count: methods.length });
          note.textContent = 'Preferences saved to your owner account. Gateway remains disconnected; no customer checkout is active.';
        } catch (error) { note.textContent = error.message; }
        finally { button.disabled = false; }
      };
    }

    async function loadAll() {
      connectSettings();
      await loadApplications();
      const tasks = [refreshFinance(), refreshInventory(), refreshReminders(), refreshPcSessions(), refreshActivity()];
      await Promise.allSettled(tasks);
    }
    loadAll().catch(error => rootPanel.append(el('p', 'owner-live-error', error.message)));
  }

  const observer = new MutationObserver(() => {
    const root = document.querySelector('#owner-content');
    if (!root) { stopPcTimer(); return; }
    if (!root.querySelector('#owner-live-integrations')) stopPcTimer();
    enhance(root);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
