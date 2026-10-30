import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const files=['src','public','scripts','test'].flatMap(dir=>fs.readdirSync(dir,{recursive:true}).filter(x=>/\.(js|mjs)$/.test(x)).map(x=>`${dir}/${x}`));
let failed=false;
for(const file of files) {const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)failed=true;}
console.log(`Checked ${files.length} JavaScript files`);process.exitCode=failed?1:0;
