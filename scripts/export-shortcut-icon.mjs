import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.resolve('pdfjs-dist/package.json'));
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const assets=new URL('../public/assets/',import.meta.url);
const source=readFileSync(new URL('mark.svg',assets),'utf8');
const sizes=[16,24,32,48,64,128,256],images=[];
for(const size of sizes){
  const svg=source.replace(/width="\d+"/,`width="${size}"`).replace(/height="\d+"/,`height="${size}"`);
  const canvas=createCanvas(size,size),image=await loadImage(Buffer.from(svg));
  canvas.getContext('2d').drawImage(image,0,0);
  const png=canvas.toBuffer('image/png');images.push(png);
  if(size===256)writeFileSync(new URL('on-stage-icon-preview.png',assets),png);
}
const header=Buffer.alloc(6+sizes.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
for(const [i,size] of sizes.entries()){
  const at=6+i*16;header[at]=size===256?0:size;header[at+1]=header[at];
  header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);
  header.writeUInt32LE(images[i].length,at+8);header.writeUInt32LE(offset,at+12);offset+=images[i].length;
}
const icon=Buffer.concat([header,...images]),output=new URL('on-stage.ico',assets);writeFileSync(output,icon);
if(icon.readUInt16LE(2)!==1||icon.readUInt16LE(4)!==sizes.length)throw Error('Invalid icon directory');
for(let i=0;i<sizes.length;i++){const at=6+i*16,start=icon.readUInt32LE(at+12),length=icon.readUInt32LE(at+8);if(start+length>icon.length||icon.subarray(start,start+8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid icon image');}
console.log(JSON.stringify({icon:fileURLToPath(output),sizes,bytes:icon.length}));
