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

// Option 1: Load from full JSON string (e.g., for Render/Vercel)
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (error) {
    console.error('Error parsing FIREBASE_SERVICE_ACCOUNT env var:', error.message);
  }
} 

// Option 2: Load from individual environment variables (Robust fallback)
if (!serviceAccount && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
  serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
  console.log('📝 Using individual Firebase environment variables');
}

// Option 3: Load from local file (Development)
if (!serviceAccount) {
  try {
    const serviceAccountPath = join(__dirname, '..', 'serviceAccountKey.json');
    const serviceAccountData = readFileSync(serviceAccountPath, 'utf8');
    serviceAccount = JSON.parse(serviceAccountData);
  } catch (error) {
    console.error('Error loading serviceAccountKey.json:', error.message);
    console.warn('💡 Tip: For production, set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY environment variables.');
  }
}

// source of truth for Project ID
const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id || serviceAccount?.projectId;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;

export let auth;
export let db;

// Initialize Firebase Admin
try {
  if (serviceAccount) {
    console.log(`🚀 Connecting to Firebase Project: ${projectId}`);
    
    // Ensure the private key is formatted correctly for the SDK
    const formattedServiceAccount = {
      projectId: projectId,
      clientEmail: serviceAccount.client_email || serviceAccount.clientEmail,
      privateKey: (serviceAccount.private_key || serviceAccount.privateKey || '').replace(/\\n/g, '\n'),
    };

    if (!formattedServiceAccount.privateKey.includes('BEGIN PRIVATE KEY')) {
      console.error('❌ Invalid FIREBASE_PRIVATE_KEY format. It must include BEGIN/END headers.');
    }

    const app = initializeApp({
      credential: cert(formattedServiceAccount),
      projectId: projectId,
    });

    // Initialize Firebase services
    auth = getAuth(app);
    db = getFirestore(app);

    console.log('✅ Firebase Admin initialized successfully');
  } else {
    throw new Error('No service account credentials provided.');
  }
} catch (error) {
  console.error('❌ Firebase Admin NOT initialized:', error.message);
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    console.error('CRITICAL: Firebase initialization failed. Please check your FIREBASE_PROJECT_ID and SERVICE_ACCOUNT credentials.');
    process.exit(1);
  }
}

