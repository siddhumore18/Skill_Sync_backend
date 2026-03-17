// Quick test script to verify backend is working
import fetch from 'node-fetch';

const testBackend = async () => {
  try {
    console.log('Testing backend connection...\n');
    
    // Test health endpoint
    const healthRes = await fetch('http://localhost:3001/health');
    const healthData = await healthRes.json();
    console.log('✅ Health check:', healthData);
    
    // Test auth endpoint (should return error but endpoint should work)
    try {
      const authRes = await fetch('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const authData = await authRes.json();
      console.log('✅ Auth endpoint accessible:', authData.error || 'OK');
    } catch (err) {
      console.log('❌ Auth endpoint error:', err.message);
    }
    
    console.log('\n✅ Backend is running and accessible!');
    console.log('🌐 Frontend should connect to: http://localhost:3001');
    
  } catch (error) {
    console.error('❌ Backend connection failed:', error.message);
    console.log('\nMake sure backend is running: cd backend && npm start');
  }
};

testBackend();

