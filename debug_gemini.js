import { GoogleAIFileManager } from '@google/generative-ai/server';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

async function testUpload() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('Testing with API Key:', apiKey ? apiKey.substring(0, 5) + '...' : 'MISSING');
  
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
    console.error('ERROR: GEMINI_API_KEY is not set correctly in .env');
    return;
  }

  const fileManager = new GoogleAIFileManager(apiKey);
  
  // Create a dummy text file to test upload
  const testFilePath = 'test_upload.txt';
  fs.writeFileSync(testFilePath, 'This is a test file for Gemini upload.');

  try {
    console.log('Attempting to upload test file...');
    const uploadResult = await fileManager.uploadFile(testFilePath, {
      mimeType: 'text/plain',
      displayName: 'Test Upload',
    });
    console.log('Upload successful!');
    console.log('File Name:', uploadResult.file.name);
    
    console.log('Deleting test file from Gemini...');
    await fileManager.deleteFile(uploadResult.file.name);
    console.log('Delete successful!');
  } catch (error) {
    console.error('Gemini Test Failed:');
    if (error.status) console.error('Status:', error.status);
    if (error.statusText) console.error('Status Text:', error.statusText);
    console.error(error);
  } finally {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  }
}

testUpload();
