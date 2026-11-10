// Brain factory. Pick the implementation with BRAIN=ollama (default) or BRAIN=placeholder,
// and the model with OLLAMA_MODEL, so models can be compared by restarting with another value.

import { config } from '../config.ts';
import { PlaceholderBrain, type Brain } from '../decider.ts';
import { OllamaBrain } from './ollama.ts';

export function createBrain(): Brain {
  switch (config.brain) {
    case 'placeholder': return new PlaceholderBrain();
    case 'ollama':
    default:
      return new OllamaBrain({ url: config.ollamaUrl, model: config.ollamaModel, temperature: config.temperature });
  }
}
