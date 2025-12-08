
import * as ort from 'onnxruntime-web';

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
                executionProviders: ['wasm', 'webgl'],
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
