import express from 'express';
import { db } from '../config/firebase.js';
import { auth } from '../config/firebase.js';

const router = express.Router();

// Helper to convert Firestore timestamps to ISO strings
const convertTimestamps = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  // Check if it's a Firestore Timestamp (has toDate method)
  if (obj.toDate && typeof obj.toDate === 'function') {
    try {
      return obj.toDate().toISOString();
    } catch (e) {
      // If toDate fails, try toMillis
      if (obj.toMillis && typeof obj.toMillis === 'function') {
        return new Date(obj.toMillis()).toISOString();
      }
      return obj;
    }
  }
  if (obj.toMillis && typeof obj.toMillis === 'function') {
    return new Date(obj.toMillis()).toISOString();
  }
  if (Array.isArray(obj)) {
    return obj.map(convertTimestamps);
  }
  const converted = {};
  for (const key in obj) {
    converted[key] = convertTimestamps(obj[key]);
  }
  return converted;
};

/**
 * Middleware to verify Firebase token
 */
const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token', message: error.message });
  }
};

/**
 * POST /api/chat/messages
 * Send a message
 */
router.post('/messages', verifyToken, async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    const senderId = req.user.uid;

    if (!receiverId || !content) {
      return res.status(400).json({ 
        error: 'Receiver ID and content are required' 
      });
    }

    // Fetch sender info
    const senderDoc = await db.collection('users').doc(senderId).get();
    const senderName = senderDoc.exists ? (senderDoc.data().name || 'Freelancer') : 'Freelancer';

    // Determine chatId
    let chatId;
    let isCommunity = false;
    
    if (receiverId.startsWith('community_')) {
      chatId = receiverId;
      isCommunity = true;
    } else {
      chatId = [senderId, receiverId].sort().join('_');
    }

    // Update chat list
    const chatRef = db.collection('chats').doc(chatId);
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

    await chatRef.set(chatUpdate, { merge: true });

    // Store message
    const messageRef = db.collection('messages').doc();
    const messageData = {
      senderId,
      senderName,
      receiverId: isCommunity ? null : receiverId,
      chatId,
      content: content.trim(),
      timestamp: new Date(),
      read: false,
      isCommunity,
    };

    await messageRef.set(messageData);

    const messageResponse = convertTimestamps({
      id: messageRef.id,
      ...messageData,
    });

    // Broadcast via Socket.IO
    const io = req.app.get('io');
    if (io) {
      if (isCommunity) {
        // Fetch community members to emit to
        const chatDoc = await chatRef.get();
        if (chatDoc.exists) {
          const members = chatDoc.data().members || [];
          members.forEach(memberId => {
            if (memberId !== senderId) {
              io.to(memberId).emit('message', messageResponse);
            }
          });
        }
      } else {
        io.to(receiverId).emit('message', messageResponse);
      }
    }

    res.json({
      success: true,
      message: messageResponse,
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ 
      error: 'Failed to send message', 
      message: error.message 
    });
  }
});

/**
 * GET /api/chat/messages/:userId
 * Get chat messages with a specific user
 */
router.get('/messages/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.uid;
    const unreadMessageDocs = [];

    // Get messages where current user is sender or receiver
    const messagesRef = db.collection('messages');
    
    let allMessages = [];

    if (userId.startsWith('community_')) {
      const snapshot = await messagesRef
        .where('chatId', '==', userId)
        .get();
      
      snapshot.forEach(doc => {
        allMessages.push({ id: doc.id, ...doc.data() });
      });
    } else {
      const sentMessages = await messagesRef
        .where('senderId', '==', currentUserId)
        .where('receiverId', '==', userId)
        .get();

      const receivedMessages = await messagesRef
        .where('senderId', '==', userId)
        .where('receiverId', '==', currentUserId)
        .get();

      sentMessages.forEach(doc => {
        allMessages.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      receivedMessages.forEach(doc => {
        allMessages.push({
          id: doc.id,
          ...doc.data(),
        });

        // Track unread received messages to mark as read later
        if (!doc.data().read) {
          unreadMessageDocs.push(doc);
        }
      });
    }

    // Sort by timestamp
    allMessages.sort((a, b) => {
      const timeA = a.timestamp?.toMillis?.() || new Date(a.timestamp).getTime();
      const timeB = b.timestamp?.toMillis?.() || new Date(b.timestamp).getTime();
      return timeA - timeB;
    });

    // Mark messages as read
    if (unreadMessageDocs.length > 0) {
      const batch = db.batch();
      unreadMessageDocs.forEach(doc => {
        batch.update(doc.ref, { read: true });
      });
      await batch.commit();
    }

    const convertedMessages = allMessages.map(msg => convertTimestamps(msg));
    res.json({
      success: true,
      messages: convertedMessages,
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ 
      error: 'Failed to get messages', 
      message: error.message 
    });
  }
});

/**
 * GET /api/chat/conversations
 * Get all conversations for current user
 */
router.get('/conversations', verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;

    // Get all chats where user is a participant
    const chatsRef = db.collection('chats');
    
    const chatsQuery1 = await chatsRef
      .where('participant1', '==', currentUserId)
      .get();

    const chatsQuery2 = await chatsRef
      .where('participant2', '==', currentUserId)
      .get();

    const communityQuery = await chatsRef
      .where('members', 'array-contains', currentUserId)
      .get();

    const conversationsMap = new Map();

    // Process participant1 chats
    chatsQuery1.forEach(doc => {
      const chatData = doc.data();
      const isComm = !!chatData.isCommunity;
      conversationsMap.set(doc.id, {
        chatId: doc.id,
        otherUserId: isComm ? doc.id : chatData.participant2,
        name: chatData.name || null,
        lastMessage: chatData.lastMessage,
        lastMessageTime: chatData.lastMessageTime,
        isCommunity: isComm,
        members: chatData.members || [chatData.participant1, chatData.participant2].filter(Boolean),
        memberCount: chatData.members ? chatData.members.length : (isComm ? 2 : 0)
      });
    });

    // Process participant2 chats
    chatsQuery2.forEach(doc => {
      if (!conversationsMap.has(doc.id)) {
        const chatData = doc.data();
        const isComm = !!chatData.isCommunity;
        conversationsMap.set(doc.id, {
          chatId: doc.id,
          otherUserId: isComm ? doc.id : chatData.participant1,
          name: chatData.name || null,
          lastMessage: chatData.lastMessage,
          lastMessageTime: chatData.lastMessageTime,
          isCommunity: isComm,
          members: chatData.members || [chatData.participant1, chatData.participant2].filter(Boolean),
          memberCount: chatData.members ? chatData.members.length : (isComm ? 2 : 0)
        });
      }
    });

    // Process community chats (Explicit members search)
    communityQuery.forEach(doc => {
      if (!conversationsMap.has(doc.id)) {
        const chatData = doc.data();
        conversationsMap.set(doc.id, {
          chatId: doc.id,
          otherUserId: doc.id,
          name: chatData.name || 'Freelancer Community',
          lastMessage: chatData.lastMessage,
          lastMessageTime: chatData.lastMessageTime,
          isCommunity: true,
          memberCount: chatData.members?.length || 0,
          members: chatData.members || []
        });
      }
    });

    const conversations = Array.from(conversationsMap.values());

    // Get unread counts and user info for each conversation
    const conversationsWithDetails = await Promise.all(
      conversations.map(async (conv) => {
        if (conv.isCommunity) {
          return {
            ...conv,
            unreadCount: 0,
            otherUser: {
              id: conv.chatId,
              name: conv.name || 'Freelancer Community',
              avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${conv.chatId}`,
              role: 'community',
              isCommunity: true,
              memberCount: conv.members?.length || 2
            }
          };
        }

        // Get unread count
        const unreadQuery = await db.collection('messages')
          .where('senderId', '==', conv.otherUserId)
          .where('receiverId', '==', currentUserId)
          .where('read', '==', false)
          .get();

        // Get other user info
        let otherUser = null;
        try {
          const userDoc = await db.collection('users').doc(conv.otherUserId).get();
          if (userDoc.exists) {
            otherUser = {
              id: userDoc.id,
              ...userDoc.data(),
            };
          }
        } catch (error) {
          console.error('Error getting user:', error);
        }

        return {
          ...conv,
          unreadCount: unreadQuery.size,
          otherUser,
        };
      })
    );

    // Sort by lastMessageTime desc without requiring Firestore composite index
    const sorted = conversationsWithDetails.sort((a, b) => {
      const aTime = a.lastMessageTime?.toMillis?.() || new Date(a.lastMessageTime).getTime() || 0;
      const bTime = b.lastMessageTime?.toMillis?.() || new Date(b.lastMessageTime).getTime() || 0;
      return bTime - aTime;
    });

    const convertedConversations = sorted.map(conv => convertTimestamps(conv));
    res.json({
      success: true,
      conversations: convertedConversations,
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ 
      error: 'Failed to get conversations', 
      message: error.message 
    });
  }
});

/**
 * GET /api/chat/users
 * Get all users (for chat list)
 */
router.get('/users', verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.uid;
    
    const usersRef = db.collection('users');
    const usersSnapshot = await usersRef.get();
    
    const users = [];
    usersSnapshot.forEach(doc => {
      if (doc.id !== currentUserId) {
        const data = doc.data();
        users.push({
          id: doc.id,
          ...data,
          // Always guarantee skills is a proper array
          skills: Array.isArray(data.skills) ? data.skills : [],
        });
      }
    });

    res.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ 
      error: 'Failed to get users', 
      message: error.message 
    });
  }
});

export default router;

