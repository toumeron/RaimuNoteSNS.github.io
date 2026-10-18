"""Copy only public prompt/product source inputs for an isolated evaluation branch."""
import hashlib
import json
import shutil
from pathlib import Path
from flash_context import SECTIONS

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
OUT=HERE/'source_snapshot'
sources=['src/pages/ChatPage.tsx','supabase/functions/chat-gemma/index.ts',
         'package.json','AGENTS.md',*(section[0] for section in SECTIONS)]
manifest={}
for relative in sources:
    source=REPO/relative
    target=OUT/relative
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source,target)
    manifest[relative]=hashlib.sha256(source.read_bytes()).hexdigest()
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(f'Snapshotted {len(manifest)} allowlisted public source inputs; no model execution.')
