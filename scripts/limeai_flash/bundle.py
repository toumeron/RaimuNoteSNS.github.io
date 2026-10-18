"""Build a source-allowlisted deployment package. Never include .env or chat data."""
import hashlib,json,shutil
from pathlib import Path
from flash_context import SECTIONS,DEFAULT_SOURCE

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
OUT=REPO/'artifacts/limeai-flash-cloud'
OUT.mkdir(parents=True,exist_ok=True)
files=['flash_context.py','limeai_flash_mlx.py','flash_cloud_server.py','download_model.py','release_check.py',
       'requirements.txt','Dockerfile','compose.yaml','Caddyfile','model-source.json','model-validation.json','LICENSE-Qwen','qwen-instruct-chat-template.jinja',
       'adapters/limeai-flash/adapter_config.json','adapters/limeai-flash/adapters.safetensors']
for relative in files:
    target=OUT/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(HERE/relative,target)
sources=['src/pages/ChatPage.tsx','supabase/functions/chat-gemma/index.ts','package.json','AGENTS.md',*(s[0] for s in SECTIONS)]
manifest={}
for relative in sources:
    source=DEFAULT_SOURCE/relative;target=OUT/'source'/relative;target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source,target);manifest[relative]=hashlib.sha256(source.read_bytes()).hexdigest()
(OUT/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(OUT)
