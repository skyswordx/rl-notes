import * as ort from 'onnxruntime-web';
import { withBase } from 'vitepress';

// Use CDN for ONNX Runtime WASM files.
// Vite does not allow dynamic imports from /public, so we use jsDelivr CDN.
const ORT_VERSION = '1.23.2';
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

// Disable multi-threading and SIMD for maximum browser compatibility
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = false;
ort.env.wasm.proxy = false;

export class RobotController {
    constructor(modelPath) {
        this.modelPath = modelPath;
        this.session = null;
        this.isLoading = false;
        this.error = null;
    }

    async init() {
        if (this.session) return;
        this.isLoading = true;
        try {
            // Create an inference session
            // Set execution providers to wasm for browser compatibility
            this.session = await ort.InferenceSession.create(this.modelPath, {
                executionProviders: ['wasm'],
            });
            console.log('ONNX Session created');
        } catch (e) {
            console.error('Failed to load ONNX model', e);
            this.error = e;
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Run inference
     * @param {number[]} observation - Flattened array of observation values
     * @returns {Promise<number[]>} - Action values
     */
    async predict(observation) {
        if (!this.session) {
            console.warn('Session not initialized');
            return null;
        }

        try {
            // Create tensor from observation
            // Assuming input name is "input", check export script for exact name
            const tensor = new ort.Tensor('float32', Float32Array.from(observation), [1, observation.length]);

            // Run inference
            const feeds = { input: tensor };
            const results = await this.session.run(feeds);

            // Get output
            // Assuming output name is "output"
            const output = results.output.data;
            return Array.from(output);
        } catch (e) {
            console.error('Inference error', e);
            return null;
        }
    }
}
