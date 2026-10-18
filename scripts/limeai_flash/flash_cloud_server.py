#!/usr/bin/env python3
"""Authenticated asynchronous inference. Keeps jobs in RAM, never logs chat content."""
import argparse
import hmac
import json
import os
from pathlib import Path
import queue
import re
import threading
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from limeai_flash_mlx import Flash

TTL=900
ID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',re.I)

def conversation(contents):
    if not isinstance(contents,list) or not 1<=len(contents)<=100:raise ValueError('Invalid contents')
    history=[];instructions='';chars=0
    for index,item in enumerate(contents):
        if not isinstance(item,dict) or item.get('role') not in ('user','model'):raise ValueError('Invalid role')
        parts=item.get('parts')
        if not isinstance(parts,list) or not parts:raise ValueError('Invalid parts')
        if any(not isinstance(p,dict) or set(p)!={'text'} or not isinstance(p['text'],str) for p in parts):raise ValueError('Text only')
        text='\n'.join(p['text'] for p in parts);chars+=len(text)
        if index==0 and text.startswith('【システム命令:'):
            instructions=text;continue
        if text.strip():history.append({'role':'assistant' if item['role']=='model' else 'user','content':text})
    if chars>50000:raise ValueError('Too much text')
    if not history or history[-1]['role']!='user':raise ValueError('No current question')
    return history,instructions


class Jobs:
    def __init__(self,infer,*,capacity=8,clock=time.monotonic):
        self.infer=infer;self.clock=clock;self.capacity=capacity;self.rows={};self.lock=threading.Lock();self.queue=queue.Queue()
        threading.Thread(target=self.work,daemon=True).start()

    def prune(self):
        now=self.clock()
        self.rows={i:r for i,r in self.rows.items() if r['expires']>now}

    def submit(self,job_id,contents):
        history,instructions=conversation(contents)
        with self.lock:
            self.prune()
            if job_id in self.rows:return self.public(self.rows[job_id])
            if sum(r['status'] in ('queued','running') for r in self.rows.values())>=self.capacity:raise OverflowError('Busy')
            if len(self.rows)>=128:raise OverflowError('Busy')
            self.rows[job_id]={'status':'queued','expires':self.clock()+TTL,'history':history,'instructions':instructions}
            self.queue.put(job_id)
            return {'status':'queued'}

    @staticmethod
    def public(row):
        return {'status':row['status'],**({'answer':row['answer']} if row['status']=='done' else {})}

    def status(self,job_id,cancel=False):
        with self.lock:
            self.prune();row=self.rows.get(job_id)
            if row is None:raise KeyError(job_id)
            if cancel:
                row.clear();row.update(status='cancelled',expires=self.clock()+TTL)
            return self.public(row)

    def work(self):
        while True:
            try:job_id=self.queue.get(timeout=30)
            except queue.Empty:
                with self.lock:self.prune()
                continue
            try:
                with self.lock:
                    self.prune();row=self.rows.get(job_id)
                    if row is None or row['status']!='queued':continue
                    row['status']='running';history=row.pop('history');instructions=row.pop('instructions')
                try:answer=self.infer(history,instructions)
                except Exception:answer=None
                with self.lock:
                    row=self.rows.get(job_id)
                    if row and row['status']=='running':
                        if isinstance(answer,str) and answer.strip() and len(answer)<=24000:row.update(status='done',answer=answer.strip())
                        else:row.update(status='failed')
            finally:self.queue.task_done()


def server_for(jobs,key,address):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def send(self,status,payload):
            data=json.dumps(payload,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers()
            try:self.wfile.write(data)
            except (BrokenPipeError,ConnectionResetError):pass
        def authorized(self):
            actual=self.headers.get('Authorization','')
            return hmac.compare_digest(actual.encode(),('Bearer '+key).encode())
        def do_POST(self):
            if not self.authorized():self.send(401,{'error':'Unauthorized'});return
            if self.path!='/v1/jobs':self.send(404,{'error':'Not found'});return
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=256*1024 or self.headers.get_content_type()!='application/json':raise ValueError('Invalid request')
                self.connection.settimeout(15)
                body=json.loads(self.rfile.read(length));job_id=body.get('id')
                if not isinstance(job_id,str) or not ID.fullmatch(job_id):raise ValueError('Invalid ID')
                result=jobs.submit(job_id,body.get('contents'));self.send(202,result)
            except OverflowError:self.send(429,{'error':'Queue full'})
            except (ValueError,TypeError,AttributeError,TimeoutError):self.send(400,{'error':'Invalid request'})
        def do_GET(self):
            if self.path=='/health':self.send(200,{'ready':True,'model':'LimeAI-Flash'});return
            self.job(False)
        def do_DELETE(self):self.job(True)
        def job(self,cancel):
            if not self.authorized():self.send(401,{'error':'Unauthorized'});return
            job_id=self.path.removeprefix('/v1/jobs/')
            if not self.path.startswith('/v1/jobs/') or not ID.fullmatch(job_id):self.send(404,{'error':'Not found'});return
            try:self.send(200,jobs.status(job_id,cancel))
            except KeyError:self.send(404,{'error':'Job expired'})
    return ThreadingHTTPServer(address,Handler)


def main():
    cli=argparse.ArgumentParser();cli.add_argument('--host',default='127.0.0.1');cli.add_argument('--port',type=int,default=8000);cli.add_argument('--cpu',action='store_true');args=cli.parse_args()
    from release_check import require_release
    require_release()
    key=os.environ.get('LIMEAI_FLASH_API_KEY','')
    if len(key)<32:raise SystemExit('Set a private LIMEAI_FLASH_API_KEY of at least 32 characters.')
    if args.cpu:
        import mlx.core as mx
        mx.set_default_device(mx.cpu)
    flash=Flash()
    jobs=Jobs(lambda history,instructions:flash.respond(history,instructions,execution='cloud',max_tokens=640))
    server=server_for(jobs,key,(args.host,args.port))
    print('LimeAI-Flash inference ready. No conversation logs.',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()

if __name__=='__main__':main()
