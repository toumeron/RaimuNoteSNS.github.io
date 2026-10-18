"""Static development inputs only: Actions must never receive live user conversations."""
import json
import mlx.core as mx
from limeai_flash_mlx import Flash

mx.set_default_device(mx.cpu)
flash=Flash()
cases=[('identity','あなたのモデル名とサービス名を短く教えて。','LimeAI-Flash'),
       ('memory','最初の呼び名を答えて。','こはく')]
for name,prompt,expected in cases:
    history=([{'role':'user','content':'私の呼び名はこはく。'},{'role':'assistant','content':'こはくと呼ぶね。'}] if name=='memory' else [])
    answer=flash.respond([*history,{'role':'user','content':prompt}],temperature=0,max_tokens=128)
    if expected not in answer:raise AssertionError(name+' failed')
    print(json.dumps({'test':name,'passed':True}))
