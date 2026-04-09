#!/usr/bin/env node

/**
 * Debug script to check which API keys are configured
 */

const keys = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'HUGGINGFACE_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'DEEPSEEK_API_KEY',
  'TOGETHER_API_KEY',
  'XAI_API_KEY',
  'OLLAMA_HOST',
  'E2B_API_KEY',
];

console.log('🔍 Checking configured API keys:\n');

let configured = 0;
let missing = 0;

keys.forEach(key => {
  const value = process.env[key];
  if (value) {
    console.log(`✅ ${key}: ${value.substring(0, 10)}...${value.slice(-4)}`);
    configured++;
  } else {
    console.log(`❌ ${key}: NOT SET`);
    missing++;
  }
});

console.log(`\n📊 Summary: ${configured} configured, ${missing} missing`);

if (!process.env.HUGGINGFACE_API_KEY) {
  console.log('\n⚠️  WARNING: HUGGINGFACE_API_KEY is not set!');
  console.log('   This is required to use Hugging Face models with OpenCode.');
  console.log('   Set it with: export HUGGINGFACE_API_KEY="hf_your_token_here"');
}
