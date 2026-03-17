import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

async function testBasicGen() {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  try {
    console.log('Testing basic text generation...');
    const result = await model.generateContent('Hello code!');
    console.log('Response:', result.response.text());
  } catch (error) {
    console.error('Basic Test Failed:');
    if (error.status) console.error('Status:', error.status);
    console.error(error);
  }
}

testBasicGen();
