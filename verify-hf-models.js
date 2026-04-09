#!/usr/bin/env node

/**
 * Verify which Hugging Face models are accessible with your API key
 * Usage: node verify-hf-models.js [model-id]
 */

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;

if (!HUGGINGFACE_API_KEY) {
  console.error('❌ Error: HUGGINGFACE_API_KEY environment variable not set');
  console.error('Set it with: export HUGGINGFACE_API_KEY="hf_your_token_here"');
  process.exit(1);
}

// Popular models to test (or use command line arg)
const DEFAULT_MODELS = [
  'meta-llama/Llama-3.3-70B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'mistralai/Mixtral-8x22B-Instruct-v0.1',
  'mistralai/Mistral-7B-Instruct-v0.2',
  'TroyDoesAI/BlackSheep-24B',
];

async function testModel(modelId) {
  const url = `https://api-inference.huggingface.co/models/${modelId}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: 'Hello, which model are you?',
        parameters: {
          max_new_tokens: 50,
          return_full_text: false,
        }
      })
    });

    const result = {
      model: modelId,
      status: response.status,
      accessible: false,
      message: '',
    };

    if (response.status === 200) {
      const data = await response.json();
      result.accessible = true;
      result.message = '✅ Model is accessible and working!';
      result.response = data[0]?.generated_text?.substring(0, 100);
    } else if (response.status === 503) {
      result.message = '⏳ Model is loading (cold start). Retry in 30 seconds.';
    } else if (response.status === 401) {
      result.message = '❌ Authentication failed. Check your API key.';
    } else if (response.status === 403) {
      result.message = '❌ Access forbidden. May need to request access for gated model.';
    } else if (response.status === 404) {
      result.message = '❌ Model not found or not accessible.';
    } else {
      const text = await response.text();
      result.message = `❌ Error ${response.status}: ${text.substring(0, 100)}`;
    }

    return result;
  } catch (error) {
    return {
      model: modelId,
      status: 'error',
      accessible: false,
      message: `❌ Network error: ${error.message}`,
    };
  }
}

async function main() {
  const modelsToTest = process.argv.slice(2);
  const models = modelsToTest.length > 0 ? modelsToTest : DEFAULT_MODELS;

  console.log('🔍 Testing Hugging Face Inference API access...\n');
  console.log(`Using API key: ${HUGGINGFACE_API_KEY.substring(0, 10)}...${HUGGINGFACE_API_KEY.slice(-4)}\n`);

  for (const model of models) {
    console.log(`Testing: ${model}`);
    const result = await testModel(model);
    console.log(`  Status: ${result.status}`);
    console.log(`  ${result.message}`);
    if (result.response) {
      console.log(`  Response preview: "${result.response}..."`);
    }
    console.log('');
  }

  console.log('\n💡 Tips:');
  console.log('  - 503 errors are normal for first request (cold start)');
  console.log('  - For gated models (Llama), request access on HuggingFace.co');
  console.log('  - Use format: huggingface/org/model in OpenCode');
  console.log('\nTo test a specific model:');
  console.log('  node verify-hf-models.js meta-llama/Llama-3.3-70B-Instruct');
}

main().catch(console.error);
