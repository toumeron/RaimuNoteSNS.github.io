"""Fetch only pinned safetensors/tokenizer files, without executing remote code."""
import hashlib,json
from pathlib import Path
from huggingface_hub import snapshot_download

ROOT=Path(__file__).resolve().parent
source=json.loads((ROOT/'model-source.json').read_text())
target=ROOT/'models/qwen3-4b-instruct-2507-4bit'
snapshot_download(source['repository'],revision=source['revision'],local_dir=str(target),
                  allow_patterns=['*.json','*.safetensors','*.txt','*.jinja','*.model','README.md'])
weights=target/'model.safetensors'
with weights.open('rb') as file:
    if hashlib.file_digest(file,'sha256').hexdigest()!='2a73c6c248601ab904e035548abd8e6abb65ea27dcb5f342fb0a8910eb44173f':
        raise ValueError('Model checksum mismatch')
print('Pinned model checksum verified.')
# The community conversion ships an older thinking-model template. Restore the
# non-thinking template from the pinned official Qwen Instruct tokenizer config.
template=(ROOT/'qwen-instruct-chat-template.jinja').read_text()
if hashlib.sha256(template.encode()).hexdigest()!='64f85b198065d0fba2a81f37e10ed68161ce2c19a754c7100e67e0ca2ee9c326':
    raise ValueError('Official conversation template checksum mismatch')
(target/'chat_template.jinja').write_text(template)
config=json.loads((target/'tokenizer_config.json').read_text());config['chat_template']=template
(target/'tokenizer_config.json').write_text(json.dumps(config,ensure_ascii=False,indent=2))
