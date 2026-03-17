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

try {
  // Try to read the service account key file
  const serviceAccountPath = join(__dirname, '..', 'serviceAccountKey.json');
  const serviceAccountData = readFileSync(serviceAccountPath, 'utf8');
  serviceAccount = JSON.parse(serviceAccountData);
} catch (error) {
  console.error('Error loading service account key:', error.message);
  console.error('Please make sure serviceAccountKey.json exists in the backend folder');
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;

// Initialize Firebase Admin
const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: projectId,
});

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);

console.log('Firebase Admin initialized successfully');

