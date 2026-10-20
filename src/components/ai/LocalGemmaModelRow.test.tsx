import {cleanup,fireEvent,render} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import { LocalGemmaModelRow } from "@/components/ai/PageCompanion";
afterEach(cleanup);
it('changes download into delete only when the model is cached, and keeps the actions separate from model selection',()=>{
 const onSelect=vi.fn(),onDownload=vi.fn(),onDelete=vi.fn();
 const props={selected:false,disabled:false,onSelect,onDownload,onDelete};
 const view=render(<LocalGemmaModelRow {...props} state={{status:'missing',downloaded:false,progress:0}}/>);
 fireEvent.click(view.getByRole('button',{name:'Gemma 3 270Mをダウンロード'}));expect(onDownload).toHaveBeenCalledTimes(1);expect(onSelect).not.toHaveBeenCalled();
 view.rerender(<LocalGemmaModelRow {...props} state={{status:'downloading',downloaded:false,progress:42}}/>);
 expect(view.getByText('ダウンロード中 42%')).toBeInTheDocument();expect(view.getByRole('button',{name:'Gemma 3 270Mをダウンロード'})).toBeDisabled();
 view.rerender(<LocalGemmaModelRow {...props} state={{status:'ready',downloaded:true,progress:100}}/>);
 expect(view.queryByRole('button',{name:'Gemma 3 270Mをダウンロード'})).not.toBeInTheDocument();
 fireEvent.click(view.getByRole('button',{name:'Gemma 3 270Mを端末から削除'}));expect(onDelete).toHaveBeenCalledTimes(1);expect(onSelect).not.toHaveBeenCalled();
});
