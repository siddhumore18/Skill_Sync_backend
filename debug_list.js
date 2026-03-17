import dotenv from 'dotenv';
dotenv.config();

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
  
  try {
    console.log('Listing models via manual fetch...');
    const response = await fetch(url);
    const data = await response.json();
    if (response.ok) {
      console.log('Available models:');
      data.models.forEach(m => console.log(m.name));
    } else {
      console.error('Failed:', response.status, data);
    }
  } catch (error) {
    console.error('Fetch Error:', error);
  }
}

listModels();
