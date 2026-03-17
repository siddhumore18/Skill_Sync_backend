import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (error) {
    console.error('Error parsing FIREBASE_SERVICE_ACCOUNT env var:', error.message);
    process.exit(1);
  }
} else {
  try {
    // Try to read the service account key file
    const serviceAccountPath = join(__dirname, '..', 'serviceAccountKey.json');
    const serviceAccountData = readFileSync(serviceAccountPath, 'utf8');
    serviceAccount = JSON.parse(serviceAccountData);
  } catch (error) {
    console.error('Error loading service account key:', error.message);
    console.warn('Deployment Tip: On Render, set the FIREBASE_SERVICE_ACCOUNT environment variable with the content of your serviceAccountKey.json');
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}

const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;

export let auth;
export let db;

// Initialize Firebase Admin
if (serviceAccount) {
  const app = initializeApp({
    credential: cert(serviceAccount),
    projectId: projectId,
  });

  // Initialize Firebase services
  auth = getAuth(app);
  db = getFirestore(app);

  console.log('Firebase Admin initialized successfully');
} else {
  console.error('Firebase Admin NOT initialized - missing credentials');
}

