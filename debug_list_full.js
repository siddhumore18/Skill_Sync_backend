import dotenv from 'dotenv';
dotenv.config();

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (response.ok) {
      data.models.forEach(m => {
        if (m.supportedGenerationMethods.includes('generateContent')) {
          console.log(`${m.name} [SUPPORTED]`);
        } else {
          console.log(`${m.name} [NO GEN]`);
        }
      });
    }
  } catch (error) {
    console.error(error);
  }
}

listModels();
