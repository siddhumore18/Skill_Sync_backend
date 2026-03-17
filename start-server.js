// Simple script to start server and check for errors
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Starting backend server...');

const server = spawn('node', ['server.js'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
});

server.on('error', (error) => {
  console.error('Failed to start server:', error);
});

server.on('exit', (code) => {
  if (code !== 0) {
    console.error(`Server exited with code ${code}`);
  }
});

process.on('SIGINT', () => {
  console.log('\nStopping server...');
  server.kill();
  process.exit(0);
});

