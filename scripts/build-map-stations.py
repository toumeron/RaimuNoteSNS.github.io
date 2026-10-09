"""Build actual station points from the official GeoNames JP.zip (CC BY 4.0).
Usage: python3 scripts/build-map-stations.py /path/to/JP.zip
No bare city aliases: Tokyo Station must not match a post saying only Tokyo.
"""
import json, re, sys, zipfile
from pathlib import Path
rows=[]
for line in zipfile.ZipFile(sys.argv[1]).read('JP.txt').decode('utf-8').splitlines():
    row=line.split('\t')
    if row[7]!='RSTN': continue
    aliases=sorted(set(a for a in row[3].split(',') if a.endswith('駅') or re.search(r'\bstation$|-eki$',a,re.I)))
    if not aliases: continue
    name=next((a for a in aliases if a.endswith('駅') and re.search('[一-龥]',a)),aliases[0])
    rows.append([name,float(row[4]),float(row[5]),aliases])
Path('supabase/functions/link-preview/data/mapStations.json').write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':'))+'\n')
print(f'{len(rows)} real station records')
