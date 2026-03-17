import dotenv from 'dotenv';
dotenv.config();

async function testManualFetch() {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [{
      parts: [{ text: "Hello!" }]
    }]
  };

  try {
    console.log('Testing manual fetch to v1...');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (response.ok) {
      console.log('Success!', data.candidates[0].content.parts[0].text);
    } else {
      console.error('Failed:', response.status, data);
    }
  } catch (error) {
    console.error('Fetch Error:', error);
  }
}

testManualFetch();
