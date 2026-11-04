// The builder supplies rows and config. This node never fetches arbitrary URLs.
const seen = new Set();
if (rows.length > 25) throw new Error('Maximum 25 preview rows per invocation; select a smaller batch');
return rows.map((row, index) => {
  const platform = row.platform || config.platform;
  const permalink = row.permalink;
  const account = row.account_id === undefined ? config.account_id : row.account_id;
  if (!['facebook', 'instagram', 'tumblr'].includes(platform)) throw new Error('Each row requires a supported explicit platform');
  if (typeof permalink !== 'string' || /[\s\\]/.test(permalink)) throw new Error('Each row requires one HTTPS permalink');
  const m = permalink.match(/^https:\/\/([A-Za-z0-9.-]+)(\/[^?#]*)?(?:\?([^#]*))?(?:#.*)?$/);
  if (!m) throw new Error('Invalid permalink');
  const h = m[1].toLowerCase().replace(/^www\./, ''), path = m[2] || '/', query = m[3] || '';
  if (platform === 'instagram' && !(h === 'instagram.com' && /^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(path))) throw new Error('Unsupported Instagram permalink');
  if (platform === 'facebook' && !(['facebook.com', 'm.facebook.com', 'web.facebook.com'].includes(h) && (/\/(posts|videos)\//.test(path) || /^\/reel\//.test(path) || /(?:^|&)(story_fbid|v)=/.test(query)))) throw new Error('Unsupported Facebook permalink');
  if (platform === 'tumblr' && !((h.endsWith('.tumblr.com') && /^\/post\/\d+(?:\/|$)/.test(path)) || (h === 'tumblr.com' && /^\/[A-Za-z0-9_-]+\/\d+(?:\/|$)/.test(path)))) throw new Error('Unsupported Tumblr permalink');
  for (const pair of query.split('&')) if (/token|secret|password|api.?key|signature|authorization/i.test(decodeURIComponent(pair.split('=')[0]))) throw new Error('Secret-bearing permalink rejected');
  if (account !== null && account !== undefined && (typeof account !== 'string' || !/^[A-Za-z0-9_.:@-]{1,160}$/.test(account))) throw new Error('account_id must be a string identifier or omitted');
  const key = platform + ':' + (account || '') + ':' + permalink;
  if (seen.has(key)) throw new Error('Repeated target in the supplied batch');
  seen.add(key);
  const body = {platform, permalink, account_id: account || null, dry_run: true, confirmation: null};
  if (config.mode === 'execute') {
    if (config.source !== 'input' || rows.length !== 1 || typeof row.confirmation !== 'string' || !row.confirmation.startsWith('DELETE ' + platform + ':') || !/^DELETE (facebook|instagram|tumblr):[A-Za-z0-9_.:@-]+:[A-Za-z0-9_.:@-]+$/.test(row.confirmation)) throw new Error('Use the exact confirmation returned by the preview for this post');
    body.dry_run = false;
    body.confirmation = row.confirmation;
  }
  // Supplied targets share one envelope; sheet rows retain their source indexes.
  return {json: body, pairedItem: {item: config.source === 'sheet' ? row.__input_index : 0}};
});
