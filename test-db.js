import { db } from './config/firebase.js';

async function test() {
  const snap = await db.collection('messages').orderBy('timestamp', 'desc').limit(5).get();
  snap.docs.forEach(doc => console.log(doc.id, doc.data()));
  process.exit(0);
}

test();
