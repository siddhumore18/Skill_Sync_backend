# Skill Sync Backend

Backend server for Skill Sync application with Firebase authentication, email OTP verification, and real-time chat functionality.

## Features

- 🔐 Firebase Authentication (Email/Password)
- 📧 Email OTP Verification
- 💬 Real-time Chat with Socket.IO
- 🗄️ Firestore Database for message storage
- 🔒 Secure API with token-based authentication

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Firebase Setup

Follow the complete guide in [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) to:
- Create Firebase project
- Enable Authentication
- Set up Firestore Database
- Get service account key

### 3. Environment Configuration

1. Copy `env.example` to `.env`:
   ```bash
   cp env.example .env
   ```

2. Fill in your environment variables in `.env`:
   ```env
   # Firebase Configuration
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_CLIENT_EMAIL=your-client-email
   FIREBASE_PRIVATE_KEY=your-private-key

   # Brevo Email Configuration
   BREVO_SMTP_SERVER=smtp-relay.brevo.com
   BREVO_SMTP_PORT=587
   BREVO_SMTP_USER=your-brevo-smtp-username
   BREVO_SMTP_PASSWORD=your-brevo-smtp-password
   BREVO_SENDER_EMAIL=your-verified-sender-email@domain.com
   BREVO_SENDER_NAME=SkillSync Team

   # Server Configuration
   PORT=3001
   NODE_ENV=development
   FRONTEND_URL=http://localhost:5174
   ```

   **3. Set up Brevo (formerly Sendinblue) for email:**
   - Create a free account at [brevo.com](https://www.brevo.com/)
   - Go to **SMTP & API** settings in your Brevo account
   - Create an SMTP key and copy the credentials
   - Add them to your `.env` file
   - Verify your sender email address in Brevo dashboard

4. Place your `serviceAccountKey.json` file in the `backend` folder (downloaded from Firebase Console)

### 5. Start Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

Server will run on `http://localhost:3001`

## API Endpoints

### Authentication

#### POST `/api/auth/register`
Register a new user (sends OTP email)
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe"
}
```

#### POST `/api/auth/verify-otp`
Verify OTP and create account
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

#### POST `/api/auth/login`
Login with email/password or Firebase token
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```
OR
```json
{
  "idToken": "firebase-id-token"
}
```

#### POST `/api/auth/resend-otp`
Resend OTP to email
```json
{
  "email": "user@example.com"
}
```

### Chat

#### POST `/api/chat/messages`
Send a message (requires authentication token)
```json
{
  "receiverId": "user-id",
  "content": "Hello!"
}
```
Headers: `Authorization: Bearer <firebase-id-token>`

#### GET `/api/chat/messages/:userId`
Get chat messages with a specific user
Headers: `Authorization: Bearer <firebase-id-token>`

#### GET `/api/chat/conversations`
Get all conversations for current user
Headers: `Authorization: Bearer <firebase-id-token>`

#### GET `/api/chat/users`
Get all users (for chat list)
Headers: `Authorization: Bearer <firebase-id-token>`

## Socket.IO Events

### Client → Server

- `message` - Send a message
  ```javascript
  socket.emit('message', {
    receiverId: 'user-id',
    content: 'Hello!'
  });
  ```

- `typing` - Send typing indicator
  ```javascript
  socket.emit('typing', {
    receiverId: 'user-id',
    isTyping: true
  });
  ```

### Server → Client

- `message` - Receive a new message
- `message-sent` - Confirm message was sent
- `typing` - Receive typing indicator from other user
- `error` - Error occurred

### Socket Connection

Connect to Socket.IO with authentication:
```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3001', {
  auth: {
    token: 'your-firebase-id-token'
  }
});
```

## Project Structure

```
backend/
├── config/
│   ├── firebase.js      # Firebase Admin SDK initialization
│   └── email.js         # Brevo email configuration for OTP
├── routes/
│   ├── auth.js          # Authentication routes
│   └── chat.js          # Chat API routes
├── server.js            # Main server file with Socket.IO
├── package.json
├── .env                 # Environment variables (not in git)
├── serviceAccountKey.json # Firebase service account (not in git)
├── FIREBASE_SETUP.md    # Complete Firebase setup guide
└── README.md
```

## Security Notes

1. **Never commit** `serviceAccountKey.json` or `.env` to git
2. Use environment variables for sensitive data
3. Firestore security rules are configured in Firebase Console
4. All API endpoints (except `/health`) require authentication

## Troubleshooting

See [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) for detailed troubleshooting guide.

