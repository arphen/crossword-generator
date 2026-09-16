import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

// Nested engine worker (ADR 0002): WebLLM's CreateWebWorkerMLCEngine takes a
// Worker handle, so the broker worker spawns this script (co-located with the
// adapter so the relative import-meta URL resolves) and the engine protocol
// runs here — inference never touches the main thread or any server.
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (message: MessageEvent) => {
  handler.onmessage(message);
};
