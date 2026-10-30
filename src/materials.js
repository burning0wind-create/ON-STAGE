import path from 'node:path';
import { id, hash, fail } from './domain.js';
export async function parseMaterial({name, bytes, kind, suppliedText=''}) {
  if (!['resume','portfolio','rules','rubric'].includes(kind)) fail('材料类型无效');
  if (!bytes?.length || bytes.length > 20*1024*1024) fail('每份材料需大于 0 且不超过 20 MB');
  const ext=path.extname(name).toLowerCase();
  if(!['.txt','.md','.json','.pdf','.png','.jpg','.jpeg','.webp'].includes(ext)) fail('支持 PDF、TXT、MD、JSON 与作品图片');
  let text='', pages=[], status='parsed';
  if(['.txt','.md','.json'].includes(ext)) text=Buffer.from(bytes).toString('utf8');
  else if(ext==='.pdf') {
    try {
      const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true,verbosity:0});
      const pdf=await task.promise;
      try {
        for(let n=1;n<=Math.min(pdf.numPages,120);n++) {
          const page=await pdf.getPage(n); const content=await page.getTextContent();
          pages.push({page:n,text:content.items.map(x=>x.str??'').join(' ')}); page.cleanup();
        }
        if(pdf.numPages>120) status='partial';
        text=pages.map(p=>`[第 ${p.page} 页]\n${p.text}`).join('\n');
        if(pages.every(p=>p.text.trim().length<10)) status='needs_text';
      } finally {await pdf.destroy();}
    } catch {status='needs_text';}
  } else status='needs_text';
  if(suppliedText.trim()) {text+=`\n[用户补充说明]\n${suppliedText.trim()}`; if(status==='needs_text') status='user_described';}
  return {id:id(),kind,name:path.basename(name),extension:ext,size:bytes.length,hash:hash(Buffer.from(bytes)),text:text.slice(0,120000),pages,status,createdAt:new Date().toISOString()};
}
