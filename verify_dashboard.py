"""Read-only acceptance evidence. No raw records, credentials, or signed URLs printed."""
import getpass,json,os
from read_only_client import ReadOnlyClient,VerificationError

def main():
    c=ReadOnlyClient(os.getenv('OPS_DASHBOARD_URL','https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev'),os.getenv('DASHBOARD_TOKEN') or getpass.getpass('Dashboard token (hidden): '))
    report={};failed=False
    for label,path in [('storage','/api/storage/status'),('content','/api/content/status'),('meta','/api/meta/status'),('coverage','/api/meta/coverage'),('library','/api/content?limit=1'),('sources','/api/producer-sources')]:
        try:d=c.get(path)
        except VerificationError as e:report[label]={'error':e.category,'http':e.status};failed=True;continue
        if label=='storage':report[label]={k:d.get(k) for k in ['ok','cutover_ready','revision']}
        elif label=='meta':report[label]={k:d.get(k) for k in ['status','enabled','last_attempt','last_success','error_code','discovery_completed_at','stale_capabilities']};report[label]['accounts']=len(d.get('accounts',[]));report[label]['history_exhausted_accounts']=sum(a['history_complete'] for a in d.get('accounts',[]))
        elif label=='coverage':report[label]={'total':d.get('total'),'sample_rows':len(d.get('rows',[])),'sample_unavailable':sum(r['status']=='unavailable' for r in d.get('rows',[]))}
        elif label=='library':report[label]={'returned':len(d.get('rows',[])),'more':d.get('has_more')}
        elif label=='sources':report[label]={'nodes':len(d.get('rows',[])),'live_observations':sum(bool(r.get('observation')) for r in d.get('rows',[]))}
        else:report[label]={k:d.get(k) for k in ['schema_ready','sheet_write_enabled','meta_sync_enabled','outbox']}
    report['acceptance']='endpoint_checks_failed' if failed else 'read_paths_verified_live_completeness_requires_review'
    print(json.dumps(report,indent=2));raise SystemExit(1 if failed else 0)
if __name__=='__main__':main()
