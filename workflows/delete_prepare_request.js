// One envelope per invocation. Sheet data can only produce previews.
const inputs = $input.all();
if (inputs.length !== 1) throw new Error('Pass exactly one request envelope');
const raw = inputs[0].json;
const source = raw.source === undefined ? 'input' : raw.source;
const mode = raw.mode === undefined ? 'preview' : raw.mode;
if (!['input', 'sheet'].includes(source)) throw new Error('source must be input or sheet');
if (!['preview', 'execute'].includes(mode)) throw new Error('mode must be preview or execute');
if (source === 'sheet' && mode !== 'preview') throw new Error('Sheet execution is preview-only. Submit one reviewed URL through source=input to execute');
if (Object.hasOwn(raw, 'dry_run') || Object.hasOwn(raw, 'confirmation')) throw new Error('Use mode and per-item confirmation; top-level deletion flags are rejected');
const config = {source, mode, platform: raw.platform || null,
  account_id: raw.account_id || null, document_id: raw.document_id || 'DOCUMENT_ID',
  sheet_name: raw.sheet_name || 'clickouts', items: raw.items || []};
if (source === 'sheet') {
  if (config.document_id === 'DOCUMENT_ID' || !/^[A-Za-z0-9_-]{20,200}$/.test(config.document_id)) throw new Error('Supply the existing workbook document_id; DOCUMENT_ID is a placeholder');
  if (typeof config.sheet_name !== 'string' || !config.sheet_name.trim()) throw new Error('Supply sheet_name');
} else if (!Array.isArray(config.items) || config.items.length === 0 || config.items.length > 25) {
  throw new Error('Supply 1 to 25 items');
}
if (mode === 'execute' && config.items.length !== 1) throw new Error('Execute accepts one reviewed post per invocation');
return [{json: config}];
