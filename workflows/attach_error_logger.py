"""Create an inactive private export attaching an explicit error workflow where absent."""
import argparse,copy,json,os,re
from pathlib import Path
from instrument_publishers import load_workflows

def attach(export,error_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,160}',error_id):raise ValueError('Exact imported error workflow ID required')
    workflows=copy.deepcopy(load_workflows(export));changed=0
    for w in workflows:
        if w['id']==error_id or any(n.get('type','').endswith('.errorTrigger') for n in w['nodes']):continue
        if not w.setdefault('settings',{}).get('errorWorkflow'):w['settings']['errorWorkflow']=error_id;changed+=1
        w['active']=False
    return workflows,changed
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('export');p.add_argument('error_workflow_id');p.add_argument('output');a=p.parse_args()
    result,count=attach(json.load(open(a.export,encoding='utf8')),a.error_workflow_id)
    fd=os.open(a.output,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w') as f:json.dump(result,f)
    print('Inactive review export created; newly attached workflows:',count)
