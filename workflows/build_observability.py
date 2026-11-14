"""Credential-free inactive failure logger and bounded social scan workflow templates."""
import json
from pathlib import Path
from build_workflows import node,code,edge,workflow
ROOT=Path(__file__).resolve().parent

def build():
    start=node('Workflow failure','errorTrigger',1,{},[0,0])
    normalize=code('Safe failure metadata',"""const x=$input.first().json;const safe=v=>String(v||'').replace(/[^A-Za-z0-9_.:@-]/g,'').slice(0,120);
const workflow=safe(x.workflow?.id),execution=safe(x.execution?.id);
return [{json:{source:'n8n',event_id:workflow+':'+(execution||String(Date.now())),happened_at:new Date().toISOString(),workflow_name:workflow,workflow_url:workflow?'https://n8n-prod-1.vivojaymail.workers.dev/workflow/'+encodeURIComponent(workflow):'',severity:'error',service:'n8n',message:'workflow_execution_failed'}}];""",[300,0])
    send=node('Record failure','httpRequest',4.2,{'method':'POST','url':'https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev/api/ingest/event','authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth','sendBody':True,'specifyBody':'json','jsonBody':'={{ $json }}','options':{'timeout':30000}},[600,0],'Bind X-INGEST-KEY credential. Set this imported workflow as the error workflow on intended workflows. Raw errors and execution data are omitted.')
    send.update(retryOnFail=True,maxTries=3,waitBetweenTries=5000)
    fail=workflow('SH01 safe failure logger',[start,normalize,send],{start['name']:{'main':[[edge(normalize['name'])]]},normalize['name']:{'main':[[edge(send['name'])]]}})
    trigger=node('Scan input','executeWorkflowTrigger',1.1,{'inputSource':'passthrough'},[0,0])
    validate=code('Validate scan scope',"""const x=$input.first().json;if(!['facebook','instagram','tumblr'].includes(x.platform)||!String(x.account_id||'').match(/^[A-Za-z0-9_.:@-]{1,160}$/))throw Error('Explicit configured account required');return [{json:{platform:x.platform,account_id:String(x.account_id),max_posts:Math.max(1,Math.min(20,Number(x.max_posts)||20)),cursor:typeof x.cursor==='string'?x.cursor:null}}];""",[300,0])
    scan=node('Scan bounded batch','httpRequest',4.2,{'method':'POST','url':'https://sh01.vivojaymail.workers.dev/social/inventory/scan','authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth','sendBody':True,'specifyBody':'json','jsonBody':'={{ $json }}','options':{'timeout':360000}},[600,0],'Bind social X-API-KEY. Persist resume_cursor privately; pass it on the next batch. No automatic retry or loop. Use run_social_scan.py for atomic checkpoint persistence.')
    scan['retryOnFail']=False
    inv=workflow('SH01 bounded social inventory',[trigger,validate,scan],{trigger['name']:{'main':[[edge(validate['name'])]]},validate['name']:{'main':[[edge(scan['name'])]]}})
    for filename,value in [('failure-logger.n8n.json',fail),('social-inventory.n8n.json',inv)]:
        # Failure payloads may contain secrets before normalization: never save execution bodies.
        value['settings']['saveDataErrorExecution']='none'
        (ROOT/filename).write_text(json.dumps(value,indent=2)+'\n')
if __name__=='__main__':build()
