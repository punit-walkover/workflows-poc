import { one, q } from '../db';
import { WorkflowNode } from '../types';
import { createWorkflow, publishWorkflow, saveWorkflow, patchWorkflow } from '../workflows/workflows.service';
import { listOptions, runAppAction } from './viasocket';

// Google Sheets action ids from the viaSocket catalogue (service rowqm5xi2).
export const SHEETS = {
  serviceId: 'rowqm5xi2',
  createSpreadsheet: 'rowwy37z95y1',
  batchUpdate: 'row2eh6do90m',
  lookupRows: 'rowc6kvx92xf',
  updateRow: 'rowvmy1uc9yo',
};

const HEADERS = ['order_id', 'customer_email', 'customer_name', 'item', 'price_minor', 'delivered_on', 'days_since_delivery', 'refunded_minor', 'refund_status', 'refund_reason'];
const day = (ago: number) => new Date(Date.now() - ago * 864e5).toISOString().slice(0, 10);
const ROWS = [
  ['5001', 'alex@example.com', 'Alex Kim', 'Wireless headphones', 7999, day(6)],
  ['5002', 'alex@example.com', 'Alex Kim', 'Mechanical keyboard', 12999, day(45)],
  ['5003', 'sam@example.com', 'Sam Rivera', 'Pro blender', 15999, day(3)],
  ['5004', 'jo@example.com', 'Jo Patel', 'Kettle', 4500, day(10)],
];

// Wraps each stage so a failure says exactly which viaSocket call and shape broke.
async function stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e: any) { throw new Error(`${name}: ${e.message}${e.body ? ` ${JSON.stringify(e.body).slice(0, 300)}` : ''}`); }
}

async function firstOption(actionVersionId: string, fieldKeys: string[], existing: Record<string, unknown>) {
  for (const k of fieldKeys) {
    const r = await listOptions(SHEETS.serviceId, actionVersionId, k, existing).catch(() => null);
    if (r?.options?.length) return r.options;
  }
  return [];
}

// Creates an Orders spreadsheet, two sheet-backed actions and a refund workflow that uses them.
export async function setupSheetsDemo() {
  const created: any = await stage('create spreadsheet', () =>
    runAppAction(SHEETS.serviceId, SHEETS.createSpreadsheet, { spreadsheet_title: `Ticket0 Workflows POC — Orders (${new Date().toISOString().slice(0, 16)})` }));
  const spreadsheetId = created?.spreadsheetId ?? created?.data?.spreadsheetId;
  const url = created?.spreadsheetUrl ?? created?.data?.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  if (!spreadsheetId) throw new Error(`create spreadsheet: no spreadsheetId in ${JSON.stringify(created).slice(0, 200)}`);

  const sheets = await stage('find sheet', () => firstOption(SHEETS.batchUpdate, ['sheet_id'], { spreadSheet_id: spreadsheetId }));
  const sheetId = String(sheets[0]?.value ?? '0');

  // Header + rows in one write; days_since_delivery is a live formula.
  const values = [HEADERS, ...ROWS.map((r, i) => [...r, `=TODAY()-F${i + 2}`, 0, '', ''])];
  const range = `A1:J${values.length}`;
  const base = { spreadSheet_id: spreadsheetId, sheet_id: sheetId, value_input_option: 'USER_ENTERED' };
  await stage('write rows', async () => {
    try {
      return await runAppAction(SHEETS.serviceId, SHEETS.batchUpdate, { ...base, updates: { range, values: JSON.stringify(values), major_dimension: 'ROWS' } });
    } catch {
      return runAppAction(SHEETS.serviceId, SHEETS.batchUpdate, { ...base, updates: [{ range, values: JSON.stringify(values), major_dimension: 'ROWS' }] });
    }
  });

  // Column option values (what the app expects in lookupColumn / column_selected), falling back to header names.
  const lookupCols = await firstOption(SHEETS.lookupRows, ['search_filter.lookupColumn', 'lookupColumn'],
    { spreadsheet_Id: spreadsheetId, sheet_Id: sheetId, search_filter: { column_key: true }, 'search_filter.column_key': true });
  const updateCols = await firstOption(SHEETS.updateRow, ['column_selected'], { spreadsheet_Id: spreadsheetId, grid_Id: sheetId, column_key: true });
  const col = (opts: any[], name: string) => String(opts.find((o) => o.label === name || o.value === name)?.value ?? name);

  const common = { via_service_id: SHEETS.serviceId, via_app_name: 'Google Sheets', source: 'viasocket' };
  await upsertAction({
    ...common, key: 'sheet_lookup_order', name: 'Lookup order (Google Sheets)', kind: 'read',
    description: 'Find an order in the Orders Google Sheet by order ID. Returns the matching row with order_id, customer_email, item, price_minor (cents), delivered_on, days_since_delivery, refunded_minor, refund_status and _rowNumber (the sheet row number).',
    input_schema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] },
    subject_field: 'order_id', amount_field: null, requires_approval: false,
    via_action_version_id: SHEETS.lookupRows, via_action_name: 'Lookup Spreadsheet Rows',
    input_template: { spreadsheet_Id: spreadsheetId, sheet_Id: sheetId,
      search_filter: { column_key: true, type_search_filter: 'basic', lookupColumn: col(lookupCols, 'order_id'), lookupValue: '{{args.order_id}}' },
      sorting: { is_last_row: false, row_count: 1 } },
  });
  const [refunded, status, reason] = ['refunded_minor', 'refund_status', 'refund_reason'].map((n) => col(updateCols, n));
  await upsertAction({
    ...common, key: 'sheet_refund_order', name: 'Refund order (Google Sheets)', kind: 'write',
    description: 'Record a refund on the order row in the Orders Google Sheet. row_number is the _rowNumber from the lookup result; amount_minor is the price_minor from that row.',
    input_schema: { type: 'object', properties: { order_id: { type: 'string' }, row_number: { type: 'integer' }, amount_minor: { type: 'integer' }, reason: { type: 'string' } },
                    required: ['order_id', 'row_number', 'amount_minor', 'reason'] },
    subject_field: 'order_id', amount_field: 'amount_minor', requires_approval: true,
    via_action_version_id: SHEETS.updateRow, via_action_name: 'Update Spreadsheet Row',
    input_template: { spreadsheet_Id: spreadsheetId, grid_Id: sheetId, record: '{{args.row_number}}', column_key: true, valueInputOption: 'USER_ENTERED',
      column_selected: [refunded, status, reason], column_name: { [refunded]: '{{args.amount_minor}}', [status]: 'refunded', [reason]: '{{args.reason}}' } },
  });

  const workflowId = await ensureSheetsWorkflow();
  await q(`insert into app_setting (key, value) values ('sheets_demo', $1) on conflict (key) do update set value = $1`,
    [JSON.stringify({ spreadsheetId, sheetId, url, orders: ROWS.map((r) => ({ order_id: r[0], customer_email: r[1], item: r[3], price_minor: r[4] })) })]);
  return { spreadsheetId, url, workflowId, lookupColumns: lookupCols.length, updateColumns: updateCols.length };
}

async function upsertAction(a: Record<string, any>) {
  const cols = ['key', 'name', 'description', 'kind', 'input_schema', 'subject_field', 'amount_field', 'requires_approval',
    'via_service_id', 'via_app_name', 'via_action_version_id', 'via_action_name', 'input_template', 'source'];
  const vals = cols.map((c) => (['input_schema', 'input_template'].includes(c) ? JSON.stringify(a[c]) : a[c]));
  await q(`insert into action (${cols.join(', ')}, builtin, enabled) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}, false, true)
           on conflict (key) do update set ${cols.slice(1).map((c, i) => `${c} = $${i + 2}`).join(', ')}, enabled = true`, vals);
}

const t = (v: string) => ({ t: 'text' as const, v });
const act = (key: string) => ({ t: 'action' as const, key });
const step = (id: string, ...content: any[]): WorkflowNode => ({ id, type: 'step', content });

// "Order refund (Google Sheets)": the refund template wired to the sheet actions; the mock one is turned off.
async function ensureSheetsWorkflow(): Promise<string> {
  const name = 'Order refund (Google Sheets)';
  const steps: WorkflowNode[] = [
    step('s1', t('Ask the customer for the order ID and the email or phone number on the order.')),
    step('s2', t('Use '), act('sheet_lookup_order'), t(' to find the order in the orders sheet.')),
    { id: 'b1', type: 'branch', cases: [
      { id: 'c1', kind: 'if', condition: [t('The order was found, its refund_status is not "refunded", and days_since_delivery is 30 or less')], steps: [
        step('s3', t('Confirm the item on the order and ask the customer why they want a refund.')),
        step('s4', t('Use '), act('sheet_refund_order'), t(" to refund the item's price_minor for that order row.")),
        step('s5', t('Confirm the refunded amount and let the customer know it can take 5-10 business days to appear.')),
      ] },
      { id: 'c2', kind: 'else_if', condition: [t('The order was found but it was already refunded or delivered more than 30 days ago')], steps: [
        step('s6', t('Explain why it cannot be refunded automatically, then use '), act('escalate_to_human'), t(' so an agent can review it.')),
      ] },
      { id: 'c3', kind: 'else', condition: [], steps: [
        step('s7', t('Tell the customer no order was found and ask them to double-check the order ID.')),
      ] },
    ] },
  ];
  const existing = await one<{ id: string; row_version: number }>('select id, row_version from workflow where name = $1 and archived_at is null', [name]);
  const w = existing ?? (await createWorkflow({ name }));
  const fresh = await one<{ row_version: number }>('select row_version from workflow where id = $1', [w.id]);
  await saveWorkflow(w.id, { name, when_to_use: 'Use when the customer wants their money back for an order they already paid for.', steps, row_version: fresh!.row_version });
  await publishWorkflow(w.id);
  const mock = await one<{ id: string }>(`select id from workflow where name = 'Order refund' and archived_at is null`);
  if (mock) await patchWorkflow(mock.id, { enabled: false });
  return w.id;
}
