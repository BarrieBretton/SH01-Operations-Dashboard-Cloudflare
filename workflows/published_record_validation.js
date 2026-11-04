// n8n Code node, Run Once for All Items. Output contains only registry metadata.
// A numeric ID cannot reveal whether it is a published object or an upload container.
// The caller must attach this hook to verified final publish success, never upload.
const fields = ['platform', 'account_id', 'account_handle', 'post_id', 'permalink',
  'media_type', 'published_at', 'workflow_id', 'workflow_url'];
const mediaTypes = new Set(['IMAGE', 'VIDEO', 'REELS', 'STORY', 'CAROUSEL', 'CAROUSEL_ALBUM', 'POST']);
function parts(value) {
  if (/[\s\\]/.test(value)) throw new Error('Invalid URL');
  const m = value.match(/^https:\/\/([A-Za-z0-9.-]+)(\/[^?#]*)?(?:\?([^#]*))?(?:#(.*))?$/);
  if (!m) throw new Error('Expected an HTTPS URL without credentials or a port');
  return {host: m[1].toLowerCase().replace(/^www\./, ''), path: m[2] || '/', query: m[3] || '', hash: m[4] || ''};
}
return $input.all().flatMap((item, index) => {
  const input = item.json;
  // Instrumented branches carry an explicitly configured publish-success predicate.
  if (Object.hasOwn(input, '__sh01_publish_success') && input.__sh01_publish_success !== true) return [];
  const out = {};
  for (const key of fields) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error('Missing or invalid published-post field: ' + key);
    out[key] = input[key].trim();
  }
  if (!['facebook', 'instagram', 'tumblr'].includes(out.platform)) throw new Error('Unsupported platform');
  for (const key of ['account_id', 'post_id', 'workflow_id']) {
    if (!/^[A-Za-z0-9_.:@-]{1,160}$/.test(out[key])) throw new Error('Invalid identifier: ' + key);
  }
  if (out.account_handle.length > 150 || !mediaTypes.has(out.media_type)) throw new Error('Invalid handle or media type');
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(out.published_at) || !Number.isFinite(Date.parse(out.published_at))) throw new Error('published_at must be a timestamp with timezone');
  out.published_at = new Date(out.published_at).toISOString();
  const u = parts(out.permalink), h = u.host;
  if (out.platform === 'instagram' && !(h === 'instagram.com' && /^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(u.path))) throw new Error('Unsupported Instagram permalink');
  if (out.platform === 'facebook' && !(['facebook.com', 'm.facebook.com', 'web.facebook.com'].includes(h) && (/\/(posts|videos)\//.test(u.path) || /^\/reel\//.test(u.path) || /(?:^|&)(story_fbid|v)=/.test(u.query)))) throw new Error('Unsupported Facebook permalink');
  if (out.platform === 'tumblr' && !((h.endsWith('.tumblr.com') && /^\/post\/\d+(?:\/|$)/.test(u.path)) || (h === 'tumblr.com' && /^\/[A-Za-z0-9_-]+\/\d+(?:\/|$)/.test(u.path)))) throw new Error('Unsupported Tumblr permalink');
  for (const pair of u.query.split('&')) if (/token|secret|password|api.?key|signature|authorization/i.test(decodeURIComponent(pair.split('=')[0]))) throw new Error('Secret-bearing permalink rejected');
  const workflow = parts(out.workflow_url);
  if (workflow.query || workflow.hash || !workflow.path.endsWith('/workflow/' + out.workflow_id)) throw new Error('workflow_url must identify the supplied workflow_id');
  return [{json: out, pairedItem: {item: index}}];
});
