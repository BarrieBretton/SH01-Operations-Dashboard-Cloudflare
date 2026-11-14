"""Offline backup validation and restore rehearsal in memory. Never calls a service."""
import argparse,json,zipfile
from migrate_d1_to_sheets import SCHEMA,digest

def verify(path):
    with zipfile.ZipFile(path) as z:
        if len(z.namelist())!=len(set(z.namelist())):raise ValueError('Duplicate archive member')
        if set(z.namelist())!={'manifest.json',*(t+'.json' for t in SCHEMA)}:raise ValueError('Backup table set mismatch')
        if sum(i.file_size for i in z.infolist())>500_000_000:raise ValueError('Backup too large for bounded rehearsal')
        manifest=json.loads(z.read('manifest.json'));restored={}
        if set(manifest['tables'])!=set(SCHEMA):raise ValueError('Manifest table set mismatch')
        for table,schema in SCHEMA.items():
            rows=json.loads(z.read(table+'.json'));expected=manifest['tables'][table];seen=set()
            if len(rows)!=expected['rows'] or digest(table,rows)!=expected['sha256']:raise ValueError('Backup count or digest mismatch: '+table)
            for row in rows:
                if not isinstance(row,dict) or set(row)-set(schema['columns']):raise ValueError('Unknown backup columns: '+table)
                key=tuple(row.get(k) for k in schema['keys'])
                if None in key or key in seen:raise ValueError('Invalid or duplicate backup key: '+table)
                seen.add(key)
            # Reconstruct the exact adapter row dictionary and compare its canonical digest.
            restored[table]={tuple(r[k] for k in schema['keys']):r for r in rows}
            if digest(table,list(restored[table].values()))!=expected['sha256']:raise ValueError('Restore rehearsal mismatch')
    return {'tables':len(restored),'rows':sum(map(len,restored.values())),'digest_verified':True,'rehearsal':'in_memory','live_restore_verified':False}
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('backup');a=p.parse_args()
    try:print(json.dumps(verify(a.backup)))
    except (ValueError,KeyError,zipfile.BadZipFile):raise SystemExit('Backup validation failed; no operational values printed.') from None
