"""Offline coverage audit of a private n8n export against explicit publisher mappings.

Prints IDs/counts only, never node parameters, credentials or expressions.
"""
import argparse,json
from instrument_publishers import load_workflows,mapping_list,MARKER

def audit(export,mappings):
    workflows=load_workflows(export);mapped={(m['workflow_id'],m['node_id']) for m in mapping_list(mappings)};rows=[]
    for w in workflows:
        nodes=w['nodes'];candidates=[]
        for n in nodes:
            # Heuristic candidates are explicitly unverified; custom Code nodes need manual review.
            t=n.get('type','').lower();params=n.get('parameters',{});verb=str(params.get('method',params.get('requestMethod',''))).upper()
            if any(x in t for x in ('facebook','instagram','tumblr','twitter','youtube','pinterest')) or ('httprequest' in t and verb in ('POST','PUT')) or t.endswith('.code'):
                candidates.append({'node_id':n.get('id'),'mapped':(w['id'],n.get('id')) in mapped,'review_required':True})
        rows.append({'workflow_id':w['id'],'active':bool(w.get('active')),'error_workflow_configured':bool(w.get('settings',{}).get('errorWorkflow')),'registration_hooks':sum(MARKER in n.get('notes','') and n.get('type','').endswith('.httpRequest') for n in nodes),'candidates':candidates})
    return {'workflows':rows,'full_live_coverage_verified':False,'unmapped_candidates':sum(not n['mapped'] for w in rows for n in w['candidates']),'missing_error_workflows':sum(w['active'] and not w['error_workflow_configured'] for w in rows)}
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('export');p.add_argument('mappings');a=p.parse_args();print(json.dumps(audit(json.load(open(a.export,encoding='utf8')),json.load(open(a.mappings,encoding='utf8'))),indent=2))
