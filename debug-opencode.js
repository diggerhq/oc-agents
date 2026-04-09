#!/usr/bin/env node

/**
 * Debug script to test OpenCode configuration
 * This simulates what happens in the E2B sandbox
 */

const fs = require('fs');
const { execSync } = require('child_process');

// Simulate the config file creation
const opencodeModel = 'huggingface/Qwen/Qwen2.5-72B-Instruct';
const configJson = JSON.stringify({ model: opencodeModel });

console.log('🔧 Creating OpenCode config file...');
console.log(`Model: ${opencodeModel}`);
console.log(`Config: ${configJson}\n`);

// Create the config directory and file
try {
  execSync('mkdir -p ~/.opencode');
  fs.writeFileSync(`${process.env.HOME}/.opencode/config.json`, configJson);
  console.log('✅ Config file created\n');
} catch (error) {
  console.error('❌ Failed to create config:', error.message);
  process.exit(1);
}

// Read it back to verify
const savedConfig = fs.readFileSync(`${process.env.HOME}/.opencode/config.json`, 'utf8');
console.log('📄 Saved config content:');
console.log(savedConfig);
console.log('');

// Check if OpenCode is installed
console.log('🔍 Checking OpenCode installation...');
try {
  const version = execSync('opencode --version', { encoding: 'utf8' }).trim();
  console.log(`✅ OpenCode installed: ${version}\n`);
} catch (error) {
  console.log('❌ OpenCode not found in PATH\n');
}

// Check environment variables
console.log('🔑 Environment variables:');
const relevantEnvVars = [
  'ANTHROPIC_API_KEY',
  'HUGGINGFACE_API_KEY',
  'OPENAI_API_KEY',
];

relevantEnvVars.forEach(key => {
  const value = process.env[key];
  if (value) {
    console.log(`  ✅ ${key}: ${value.substring(0, 10)}...${value.slice(-4)}`);
  } else {
    console.log(`  ❌ ${key}: NOT SET`);
  }
});

console.log('\n💡 To test OpenCode manually:');
console.log(`   export HUGGINGFACE_API_KEY="${process.env.HUGGINGFACE_API_KEY || 'your-key-here'}"`);
console.log(`   opencode -p "You are an LLM. What model are you?" -q`);
console.log('\n💡 To check which model OpenCode is using:');
console.log('   cat ~/.opencode/config.json');
