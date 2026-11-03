// Outline the supplied PingFang SC face into a reusable, theme-colored wordmark.
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.resolve('pdfjs-dist/package.json'));
const {GlobalFonts,convertSVGTextToPath}=require('@napi-rs/canvas');
const assets=new URL('../public/assets/',import.meta.url);
if(!GlobalFonts.registerFromPath(fileURLToPath(new URL('fonts/PingFangSC-Semibold.otf',assets)),'OnStageSlogan'))throw Error('Title font unavailable');
const source=`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="400" viewBox="0 0 1100 400">
<title>下一场面试，准备更充分。</title>
<g transform="translate(8 8) skewX(-8)" font-family="OnStageSlogan" font-size="144" font-weight="600" letter-spacing="-3">
<text x="100" y="156" fill="white">下一场面试，</text>
<text x="165" y="326" fill="white">准备</text>
<text x="447" y="326" fill="none" stroke="white" stroke-width="2.4" stroke-linejoin="round">更充分</text>
<text x="870" y="326" fill="white">。</text>
</g></svg>`;
const outlined=convertSVGTextToPath(source).toString();
if(/<text\b/.test(outlined)||!outlined.includes('<path'))throw Error('Slogan conversion failed');
writeFileSync(new URL('home-slogan.svg',assets),outlined);
console.log(JSON.stringify({file:'public/assets/home-slogan.svg',bytes:Buffer.byteLength(outlined),editableSource:'scripts/export-home-slogan.mjs'}));
