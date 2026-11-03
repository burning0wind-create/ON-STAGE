import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.resolve('pdfjs-dist/package.json'));
const {createCanvas,loadImage}=require('@napi-rs/canvas');
for(const [name,width] of [['mark',1024],['mark-inverse',1024],['mark-mono',1024],['logo-lockup',1200]]){
  const height=name==='logo-lockup'?336:width;
  const source=readFileSync(`public/assets/${name}.svg`,'utf8').replace(/width="\d+"/,`width="${width}"`).replace(/height="\d+"/,`height="${height}"`);
  const img=await loadImage(Buffer.from(source)),canvas=createCanvas(width,height);
  canvas.getContext('2d').drawImage(img,0,0);
  writeFileSync(`public/assets/${name}.png`,canvas.toBuffer('image/png'));
}
console.log('Brand PNG exports ready.');
