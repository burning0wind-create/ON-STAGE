import fs from 'node:fs';
import path from 'node:path';
import { fail } from './domain.js';
export class Store {
  constructor(root = 'data') { this.root = path.resolve(root); fs.mkdirSync(this.root, {recursive:true}); }
  file(group, id) {
    if (!/^[a-z][a-z-]*$/.test(group) || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) fail('记录标识无效');
    return path.join(this.root, group, `${id}.json`);
  }
  get(group, id) { try {return JSON.parse(fs.readFileSync(this.file(group,id),'utf8'));} catch(e) {if(e.code==='ENOENT') return null; throw e;} }
  put(group,id,data) {
    const file=this.file(group,id); fs.mkdirSync(path.dirname(file),{recursive:true});
    const tmp=`${file}.${process.pid}.tmp`; fs.writeFileSync(tmp,JSON.stringify(data,null,2)); fs.renameSync(tmp,file); return data;
  }
  list(group) {
    const dir=path.dirname(this.file(group,'list'));
    if(!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(x=>x.endsWith('.json')).map(x=>this.get(group,x.slice(0,-5)));
  }
  saveUpload(id, bytes) { const file=this.file('uploads',id).replace(/\.json$/,'.bin'); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,bytes); }
}
