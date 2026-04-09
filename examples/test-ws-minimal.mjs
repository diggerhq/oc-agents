#!/usr/bin/env node

/**
 * Minimal WebSocket test to debug the connection
 */

import WebSocket from 'ws';

const API_KEY = 'flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2';
const WS_URL = `ws://localhost:3000/ws/v1/tasks?apiKey=${API_KEY}`;

console.log('🔌 Testing WebSocket connection directly...');
console.log('URL:', WS_URL);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ WebSocket connected');
  
  // Send ping
  console.log('📤 Sending ping...');
  ws.send(JSON.stringify({ type: 'ping' }));
});

ws.on('message', (data) => {
  console.log('📨 Received:', data.toString());
  
  // Try sending a submit message
  console.log('📤 Sending submit message...');
  ws.send(JSON.stringify({
    type: 'submit',
    agentId: '53512233-3f2b-4971-b724-ddfbcc433b78',
    prompt: 'Hello world'
  }));
});

ws.on('close', (code, reason) => {
  console.log(`🔌 WebSocket closed: ${code} ${reason}`);
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
});

// Close after 10 seconds
setTimeout(() => {
  console.log('🔌 Closing connection...');
  ws.close();
}, 10000);