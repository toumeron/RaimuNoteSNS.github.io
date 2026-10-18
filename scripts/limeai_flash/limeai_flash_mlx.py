#!/usr/bin/env python3
"""LimeAI-Flash: local Japanese chat/coding on a pinned public Qwen foundation."""
import argparse
import json
import os
from pathlib import Path

from flash_context import build_messages, DEFAULT_SOURCE

ROOT = Path(__file__).resolve().parent
NAME = 'LimeAI-Flash'
BASE = Path(os.environ.get('LIMEAI_FLASH_MODEL', ROOT / 'models/qwen3-4b-instruct-2507-4bit'))
ADAPTER = ROOT / 'adapters/limeai-flash'


class Flash:
    def __init__(self, adapter=ADAPTER, source=DEFAULT_SOURCE):
        from mlx_lm import load
        self.source = Path(source)
        if not BASE.joinpath('model.safetensors').exists() and not list(BASE.glob('model-*.safetensors')):
            raise ValueError('土台モデルがありません。README_LimeAI_Flash.mdのダウンロード手順を確認してください。')
        adapter = Path(adapter) if adapter else None
        if adapter and not (adapter/'adapters.safetensors').exists():
            raise ValueError('追加学習済みアダプターがありません。比較用の土台モデルは --base で起動できます。')
        self.model, self.tokenizer = load(str(BASE), adapter_path=str(adapter) if adapter else None,
                                          tokenizer_config={'trust_remote_code': False})
        self.adapter = str(adapter) if adapter else None
        rendered=self.tokenizer.apply_chat_template([{'role':'user','content':'test'},{'role':'assistant','content':'answer'}],tokenize=False)
        if '<think>' in rendered:
            raise ValueError('非思考型モデルの公式会話テンプレートを適用してください。download_model.pyで修正できます。')

    def prompt(self, messages, instructions='', **settings):
        chat = build_messages(messages, instructions, source=self.source, **settings)
        # Keep the entire policy and last request. Remove complete old turns only.
        while True:
            tokens = self.tokenizer.apply_chat_template(chat, add_generation_prompt=True, tokenize=True, return_dict=False)
            if len(tokens) <= 7168:
                return tokens
            if len(chat) <= 2:
                raise ValueError('指示と最新の発話が端末内の会話上限を超えています。入力を短くしてください。')
            del chat[1:3]

    def respond(self, messages, instructions='', *, max_tokens=640, temperature=0.35, **settings):
        from mlx_lm import generate
        from mlx_lm.sample_utils import make_sampler
        from mlx_lm.sample_utils import make_logits_processors
        tokens = self.prompt(messages, instructions, **settings)
        return generate(self.model, self.tokenizer, prompt=tokens, max_tokens=max_tokens,
                        sampler=make_sampler(temp=temperature, top_p=0.9),
                        logits_processors=make_logits_processors(repetition_penalty=1.05),
                        verbose=False).strip()


def main():
    parser = argparse.ArgumentParser(description=NAME+' local Japanese chat and coding')
    parser.add_argument('command', choices=['chat','reply'], nargs='?', default='chat')
    parser.add_argument('--base', action='store_true', help='Compare the unadapted foundation')
    parser.add_argument('--adapter', type=Path, default=ADAPTER)
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--instructions', default='')
    parser.add_argument('--prompt')
    args = parser.parse_args()
    flash=Flash(None if args.base else args.adapter, args.source)
    if args.command=='reply':
        print(flash.respond([{'role':'user','content':args.prompt or input('あなた: ')}],args.instructions))
        return
    print(NAME+' / Qwen3-4B + local adaptation / 会話はメモリ内のみ。/newで新しい会話、/quitで終了。')
    history=[]
    while True:
        try:text=input('あなた: ').strip()
        except (EOFError,KeyboardInterrupt):break
        if text=='/quit':break
        if text=='/new':history=[];continue
        if not text:continue
        messages=[*history,{'role':'user','content':text}]
        try:answer=flash.respond(messages,args.instructions)
        except ValueError as error:print(error);continue
        print(NAME+': '+answer)
        history=[*messages,{'role':'assistant','content':answer}]

if __name__=='__main__':main()
