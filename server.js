import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import postsRoutes from './routes/posts.js';
import meetingsRoutes from './routes/meetings.js';
import communityRoutes from './routes/community.js';
import newsRoutes from './routes/news.js';
import pitchPracticeRoutes from './routes/pitchPractice.js';
import projectsRoutes from './routes/projects.js';
import analyticsRoutes from './routes/analytics.js';
import uploadRoutes from './routes/upload.js';
import { initMeetingCron } from './cron.js';
import { auth, db } from './config/firebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const httpServer = createServer(app);
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176'];

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isAllowed = allowedOrigins.includes(origin) || allowedOrigins.some(allowed => origin.includes(allowed));
      const isDevelopment = process.env.NODE_ENV === 'development' || origin.includes('localhost');
      
      if (isAllowed || isDevelopment) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.set('io', io);

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.includes(origin) || allowedOrigins.some(allowed => origin.includes(allowed));
    const isDevelopment = process.env.NODE_ENV === 'development' || origin.includes('localhost');
    
    if (isAllowed || isDevelopment) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/pitch-practice', pitchPracticeRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/meetings', meetingsRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Socket.IO for real-time chat
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }
    
    const decodedToken = await auth.verifyIdToken(token);
    socket.userId = decodedToken.uid;
    next();
  } catch (error) {
    next(new Error('Authentication error: Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.userId);

  // Join user's room
  socket.join(socket.userId);

  // Handle sending message
  socket.on('message', async (data) => {
    try {
      const { receiverId, content } = data;
      const senderId = socket.userId;

      if (!receiverId || !content) {
        socket.emit('error', { message: 'Receiver ID and content are required' });
        return;
      }

      // Determine chatId and isCommunity
      let chatId;
      let isCommunity = false;
      let members = [];
      let communityName = '';
      let senderName = 'Freelancer';

      // Fetch sender info
      const senderDoc = await db.collection('users').doc(senderId).get();
      if (senderDoc.exists) {
        senderName = senderDoc.data().name || 'Freelancer';
      }

      if (receiverId.startsWith('community_')) {
        chatId = receiverId;
        isCommunity = true;
        const chatDoc = await db.collection('chats').doc(chatId).get();
        if (chatDoc.exists) {
          members = chatDoc.data().members || [];
          communityName = chatDoc.data().name || 'Community';
        }
      } else {
        chatId = [senderId, receiverId].sort().join('_');
      }

      // Create message in Firestore
      const messageRef = db.collection('messages').doc();
      const messageData = {
        senderId,
        senderName, // Ensure this is saved correctly
        receiverId: isCommunity ? null : receiverId,
        chatId,
        content: content.trim(),
        timestamp: new Date(),
        read: false,
        isCommunity
      };

      await messageRef.set(messageData);

      // Update chat list
      const chatUpdate = {
        lastMessage: content,
        lastMessageTime: new Date(),
        updatedAt: new Date(),
      };

      if (!isCommunity) {
        const [p1, p2] = [senderId, receiverId].sort();
        chatUpdate.participant1 = p1;
        chatUpdate.participant2 = p2;
      }

      await db.collection('chats').doc(chatId).set(chatUpdate, { merge: true });

      // Send message to receiver(s) if online
      const message = {
        id: messageRef.id,
        ...messageData,
      };

      if (isCommunity) {
        members.forEach(memberId => {
          if (memberId !== senderId) {
            io.to(memberId).emit('message', message);
          }
        });
      } else {
        io.to(receiverId).emit('message', message);
      }
      
      socket.emit('message-sent', message);

      // Mark message as read if receiver is online (for 1-to-1)
      if (!isCommunity) {
        const receiverSockets = await io.in(receiverId).fetchSockets();
        if (receiverSockets.length > 0) {
          await messageRef.update({ read: true });
        }
      }
    } catch (error) {
      console.error('Socket message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle typing indicator
  socket.on('typing', (data) => {
    const { receiverId, isTyping } = data;
    if (receiverId) {
      socket.to(receiverId).emit('typing', {
        userId: socket.userId,
        isTyping,
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.userId);
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Socket.IO server ready`);
  console.log(`CORS enabled for: ${allowedOrigins.join(', ')}`);
}).on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please stop the existing server or use a different port.`);
  } else {
    console.error('Server error:', error);
  }
  process.exit(1);
});

