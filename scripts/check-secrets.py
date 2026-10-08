#!/usr/bin/env python3
"""Scan tracked files/history without printing secret values. Public anon JWTs are allowed."""
import argparse, base64, json, re, subprocess, sys
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--history',action='store_true');args=parser.parse_args()
patterns=[('private key',re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
 ('GitHub token',re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b')),
 ('AWS access key',re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b')),
 ('Google API key',re.compile(rb'\bAIza[0-9A-Za-z_-]{35}\b')),
 ('Supabase secret key',re.compile(rb'\bsb_secret_[A-Za-z0-9_-]{20,}\b'))]
jwt=re.compile(rb'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}\b')
findings=set();checked=0
def scan(label,data):
 global checked
 checked+=1
 for kind,pattern in patterns:
  for match in pattern.finditer(data):
   # Ignore literal parsers/examples of key delimiters, never actual key material.
   if kind=='private key' and not re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/]{30,}',data): continue
   findings.add((label,kind))
 for match in jwt.finditer(data):
  try:
   part=match.group().split(b'.')[1];claims=json.loads(base64.urlsafe_b64decode(part+b'='*((-len(part))%4)))
   if claims.get('role')=='service_role': findings.add((label,'Supabase service-role JWT'))
  except (ValueError,TypeError): pass
paths=subprocess.check_output(['git','ls-files','-z']).split(b'\0')
for raw in paths:
 if not raw: continue
 path=Path(raw.decode());
 if path.is_file(): scan(str(path),path.read_bytes())
 if re.search(r'(^|/)\.env(?:\..*)?$',str(path)) and path.name!='.env.example':findings.add((str(path),'tracked environment file'))
if args.history:
 objects=subprocess.check_output(['git','rev-list','--objects','--all']).decode().splitlines()
 labels={line.partition(' ')[0]:line.partition(' ')[2] for line in objects if ' ' in line}
 inventory=subprocess.run(['git','cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],input=('\n'.join(labels)+'\n').encode(),capture_output=True,check=True).stdout.decode().splitlines()
 candidates=[]
 for line in inventory:
  oid,kind,size=line.split()
  name=labels[oid]
  if kind=='blob' and int(size)<=2_000_000 and not re.search(r'\.(?:png|jpe?g|gif|webp|avif|mp4|mp3|wav|wasm|vrm|glb|zip|pdf|woff2?|ttf|ico)$',name,re.I):candidates.append(oid)
 for start in range(0,len(candidates),100):
  batch=candidates[start:start+100]
  data=subprocess.run(['git','cat-file','--batch'],input=('\n'.join(batch)+'\n').encode(),capture_output=True,check=True).stdout
  cursor=0
  for oid in batch:
   boundary=data.index(b'\n',cursor);header=data[cursor:boundary].decode();size=int(header.split()[2]);cursor=boundary+1
   blob=data[cursor:cursor+size];cursor+=size+1
   if b'\0' not in blob[:1024]:scan(f'{oid[:12]}:{labels[oid]}',blob)
 print(f'History inventory: {len(labels)} objects; text/code blobs up to 2MB scanned; media binaries excluded.')
for label,kind in sorted(findings):print(f'{kind}: {label}')
print(f'Scanned {checked} files/blobs; {len(findings)} candidate secrets. Secret values are never printed.')
sys.exit(bool(findings))
