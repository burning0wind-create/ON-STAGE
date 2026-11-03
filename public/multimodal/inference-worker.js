import {FilesetResolver, HandLandmarker} from './vendor/vision_bundle.mjs';

let model;
self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    try {
      const vision = await FilesetResolver.forVisionTasks(new URL('./vendor/wasm', self.location.href).href);
      // A module worker must load the ESM WASM factory, not the classic script.
      // Use the matching loader/binary pair shipped in the same pinned package.
      if (vision.wasmLoaderPath.includes('nosimd')) throw new Error('当前浏览器缺少 WebAssembly SIMD 支持，请升级桌面版 Chrome 或 Edge。');
      vision.wasmLoaderPath = new URL('./vendor/wasm/vision_wasm_module_internal.js', self.location.href).href;
      vision.wasmBinaryPath = new URL('./vendor/wasm/vision_wasm_module_internal.wasm', self.location.href).href;
      model = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {modelAssetPath: new URL('./models/hand_landmarker.task', self.location.href).href, delegate: 'CPU'},
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5
      });
      postMessage({type: 'ready'});
    } catch (error) { postMessage({type: 'error', message: String(error.message || error)}); }
    return;
  }
  if (data.type === 'frame') {
    const start = performance.now();
    try {
      if (!model) throw new Error('模型尚未加载');
      const result = model.detectForVideo(data.bitmap, data.inferenceTimestamp);
      postMessage({type: 'result', token: data.token, sourceTime: data.sourceTime, capturePerf: data.capturePerf, width: data.width, height: data.height, latency: performance.now() - start,
        hands: result.landmarks.map((landmarks, i) => ({landmarks, label: result.handedness[i]?.[0]?.categoryName || 'Unknown', labelScore: result.handedness[i]?.[0]?.score ?? null}))});
    } catch (error) { postMessage({type: 'frameError', token: data.token, message: String(error.message || error)}); }
    finally { data.bitmap.close(); }
  }
};
