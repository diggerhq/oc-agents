#!/usr/bin/env node

/**
 * Test if Qwen2.5-72B-Instruct is accessible via Hugging Face Inference API
 */

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;

if (!HUGGINGFACE_API_KEY) {
  console.error('❌ HUGGINGFACE_API_KEY not set');
  process.exit(1);
}

async function testQwen() {
  const model = 'Qwen/Qwen2.5-72B-Instruct';
  const url = `https://api-inference.huggingface.co/models/${model}`;

  console.log(`🔍 Testing: ${model}`);
  console.log(`📡 URL: ${url}`);
  console.log(`🔑 API Key: ${HUGGINGFACE_API_KEY.substring(0, 10)}...${HUGGINGFACE_API_KEY.slice(-4)}\n`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: 'You are an LLM. What model are you? Answer in one sentence.',
        parameters: {
          max_new_tokens: 100,
          return_full_text: false,
        }
      })
    });

    console.log(`📊 Status: ${response.status} ${response.statusText}\n`);

    if (response.status === 200) {
      const data = await response.json();
      console.log('✅ SUCCESS! Model is accessible.\n');
      console.log('Response:', JSON.stringify(data, null, 2));
    } else if (response.status === 503) {
      const data = await response.json().catch(() => null);
      console.log('⏳ Model is loading (cold start)');
      console.log('Response:', data);
      console.log('\n💡 Tip: Wait 30-60 seconds and try again');
    } else {
      const text = await response.text();
      console.log('❌ Error response:');
      console.log(text);

      if (response.status === 403) {
        console.log('\n💡 This might mean:');
        console.log('   - Your API token lacks "Inference API" permission');
        console.log('   - The model requires a paid plan');
        console.log('   - This model is not available via Serverless Inference API');
      }
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }
}

testQwen();
