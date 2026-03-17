import express from 'express';
import { db } from '../config/firebase.js';
import { auth } from '../config/firebase.js';

const router = express.Router();

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
 * POST /api/community/request
 * Send a community request
 */
router.post('/request', verifyToken, async (req, res) => {
  try {
    const { targetUid } = req.body;
    const senderUid = req.user.uid;

    if (!targetUid) {
      return res.status(400).json({ error: 'Target user ID is required' });
    }

    if (senderUid === targetUid) {
      return res.status(400).json({ error: 'Cannot send request to yourself' });
    }

    // Verify both are freelancers
    const [senderDoc, targetDoc] = await Promise.all([
      db.collection('users').doc(senderUid).get(),
      db.collection('users').doc(targetUid).get()
    ]);

    if (!senderDoc.exists || !targetDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const senderData = senderDoc.data();
    const targetData = targetDoc.data();

    if (senderData.role !== 'freelancer' || targetData.role !== 'freelancer') {
      return res.status(403).json({ error: 'Community is only for freelancers' });
    }

    // Check if request already exists
    const existingRequest = await db.collection('community_requests')
      .where('senderUid', '==', senderUid)
      .where('targetUid', '==', targetUid)
      .where('status', '==', 'pending')
      .get();

    if (!existingRequest.empty) {
      return res.status(400).json({ error: 'Request already pending' });
    }

    // Create request
    const requestRef = db.collection('community_requests').doc();
    await requestRef.set({
      senderUid,
      senderName: senderData.name || 'Freelancer',
      targetUid,
      targetName: targetData.name || 'Freelancer',
      status: 'pending',
      createdAt: new Date(),
      type: 'community_invite'
    });

    // Emit real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(targetUid).emit('notification', {
        type: 'community_invite',
        id: requestRef.id,
        senderUid,
        senderName: senderData.name || 'Freelancer',
        createdAt: new Date().toISOString()
      });
    }

    res.json({ success: true, message: 'Community request sent' });
  } catch (error) {
    console.error('Community request error:', error);
    res.status(500).json({ error: 'Failed to send request', message: error.message });
  }
});

/**
 * GET /api/community/notifications
 * Get pending community requests
 */
router.get('/notifications', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const [requestsSnapshot, generalSnapshot] = await Promise.all([
      db.collection('community_requests')
        .where('targetUid', '==', uid)
        .where('status', '==', 'pending')
        .get(),
      db.collection('notifications')
        .where('uid', '==', uid)
        .where('read', '==', false)
        .get()
    ]);

    const notifications = [];
    
    requestsSnapshot.forEach(doc => {
      notifications.push({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt.toDate().toISOString(),
        isRequest: true
      });
    });

    generalSnapshot.forEach(doc => {
      notifications.push({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt.toDate().toISOString(),
        isRequest: false
      });
    });

    // Sort by createdAt desc
    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, notifications });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications', message: error.message });
  }
});

/**
 * POST /api/community/mark-read
 * Mark a notification as read
 */
router.post('/mark-read', verifyToken, async (req, res) => {
  try {
    const { notificationId } = req.body;
    const uid = req.user.uid;

    if (!notificationId) {
      return res.status(400).json({ error: 'Notification ID is required' });
    }

    const notificationRef = db.collection('notifications').doc(notificationId);
    const notificationDoc = await notificationRef.get();

    if (!notificationDoc.exists) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notificationDoc.data().uid !== uid) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await notificationRef.update({ read: true });
    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

/**
 * POST /api/community/respond
 * Accept or decline a community request
 */
router.post('/respond', verifyToken, async (req, res) => {
  try {
    const { requestId, action } = req.body; // action: 'accept' or 'decline'
    const uid = req.user.uid;

    if (!requestId || !['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Request ID and valid action are required' });
    }

    const requestRef = db.collection('community_requests').doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const requestData = requestDoc.data();

    if (requestData.targetUid !== uid) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (requestData.status !== 'pending') {
      return res.status(400).json({ error: 'Request already processed' });
    }

    if (action === 'decline') {
      await requestRef.update({ status: 'declined', respondedAt: new Date() });
      return res.json({ success: true, message: 'Request declined' });
    }

    // Action is 'accept'
    const batch = db.batch();
    
    // Update request status
    batch.update(requestRef, { status: 'accepted', respondedAt: new Date() });

    // Create a notification for the sender
    const notificationRef = db.collection('notifications').doc();
    batch.set(notificationRef, {
      uid: requestData.senderUid,
      type: 'community_accepted',
      title: 'Request Accepted',
      message: `${requestData.targetName} accepted your community request!`,
      relatedId: requestId,
      senderName: requestData.targetName,
      senderUid: uid,
      createdAt: new Date(),
      read: false
    });

    // Create a unique community chat ID
    const chatId = `community_${db.collection('chats').doc().id}`;
    const chatRef = db.collection('chats').doc(chatId);
    
    batch.set(chatRef, {
      id: chatId,
      members: [requestData.senderUid, uid],
      name: 'Freelancer Community',
      isCommunity: true,
      lastMessage: 'Community created! Say hello.',
      lastMessageTime: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ownerUid: requestData.senderUid // Initial requester is owner
    });

    // We also need to keep the participants fields for existing query logic if needed,
    // but the array 'members' is more flexible for scaling.

    await batch.commit();

    // Emit real-time notification to the sender
    const io = req.app.get('io');
    if (io) {
      io.to(requestData.senderUid).emit('notification', {
        type: 'community_accepted',
        targetUid: uid,
        targetName: requestData.targetName || 'Freelancer',
        createdAt: new Date().toISOString()
      });
    }

    res.json({ success: true, message: 'Community request accepted' });
  } catch (error) {
    console.error('Respond to request error:', error);
    res.status(500).json({ error: 'Failed to respond to request', message: error.message });
  }
});

/**
 * GET /api/community/:chatId/members
 * Fetch all members of a community
 */
router.get('/:chatId/members', verifyToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const uid = req.user.uid;

    const chatDoc = await db.collection('chats').doc(chatId).get();
    if (!chatDoc.exists) return res.status(404).json({ error: 'Community not found' });

    const chatData = chatDoc.data();
    let membersArr = chatData.members;

    // Check authorization: Must be either in members array OR one of the participants
    const isParticipant = (chatData.participant1 === uid || chatData.participant2 === uid);
    const inMembers = membersArr?.includes(uid);

    if (!inMembers && !isParticipant) return res.status(403).json({ error: 'Access denied' });

    // Legacy migration: If members array is missing or empty but it's a community chat, create it
    if ((!membersArr || membersArr.length === 0) && chatData.isCommunity) {
      membersArr = [chatData.participant1, chatData.participant2].filter(Boolean);
      await db.collection('chats').doc(chatId).update({ members: membersArr });
    }

    const membersInfo = [];
    const memberDocs = await Promise.all(
      membersArr.map(memberId => db.collection('users').doc(memberId).get())
    );

    memberDocs.forEach(doc => {
      if (doc.exists) {
        const data = doc.data();
        membersInfo.push({
          uid: doc.id,
          name: data.name || 'Freelancer',
          email: data.email,
          role: data.role
        });
      }
    });

    res.json({ success: true, members: membersInfo });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

/**
 * POST /api/community/:chatId/name
 * Edit community name
 */
router.post('/:chatId/name', verifyToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { name } = req.body;
    const uid = req.user.uid;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) return res.status(404).json({ error: 'Community not found' });
    
    const chatData = chatDoc.data();
    const isParticipant = (chatData.participant1 === uid || chatData.participant2 === uid);
    const inMembers = chatData.members?.includes(uid);
    
    if (!inMembers && !isParticipant) return res.status(403).json({ error: 'Access denied' });

    const updateData = { name: name.trim(), updatedAt: new Date() };
    if (!chatData.members || chatData.members.length === 0) {
      updateData.members = [chatData.participant1, chatData.participant2].filter(Boolean);
    }

    await chatRef.update(updateData);

    res.json({ success: true, message: 'Community name updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update name' });
  }
});

/**
 * POST /api/community/:chatId/leave
 * Leave community
 */
router.post('/:chatId/leave', verifyToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const uid = req.user.uid;

    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) return res.status(404).json({ error: 'Community not found' });
    
    const chatData = chatDoc.data();
    if (!chatData.members?.includes(uid)) return res.status(403).json({ error: 'Access denied' });

    const updatedMembers = chatData.members.filter(m => m !== uid);
    
    const userDoc = await db.collection('users').doc(uid).get();
    const userName = userDoc.data()?.name || 'Someone';

    const batch = db.batch();
    
    if (updatedMembers.length === 0) {
      // Delete empty community?
      batch.delete(chatRef);
    } else {
      batch.update(chatRef, { 
        members: updatedMembers, 
        updatedAt: new Date(),
        lastMessage: `${userName} left the community.`,
        lastMessageTime: new Date()
      });

      // Add a system message to history
      const messageRef = db.collection('messages').doc();
      batch.set(messageRef, {
        chatId,
        content: `${userName} has left the community.`,
        senderId: 'system',
        timestamp: new Date(),
        type: 'system'
      });
    }

    await batch.commit();

    res.json({ success: true, message: 'You left the community' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave community' });
  }
});

/**
 * POST /api/community/:chatId/invite
 * Invite more members
 */
/**
 * POST /api/community/:chatId/remove
 * Remove a member from community
 */
router.post('/:chatId/remove', verifyToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { targetUid } = req.body;
    const uid = req.user.uid;

    if (!targetUid) return res.status(400).json({ error: 'Target UID is required' });
    if (targetUid === uid) return res.status(400).json({ error: 'You cannot remove yourself. Use leave instead.' });

    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) return res.status(404).json({ error: 'Community not found' });
    
    const chatData = chatDoc.data();
    if (!chatData.members?.includes(uid)) return res.status(403).json({ error: 'Access denied' });
    if (!chatData.members?.includes(targetUid)) return res.status(400).json({ error: 'User is not a member' });

    const updatedMembers = chatData.members.filter(m => m !== targetUid);
    
    const targetDoc = await db.collection('users').doc(targetUid).get();
    const targetName = targetDoc.data()?.name || 'Freelancer';

    await chatRef.update({
      members: updatedMembers,
      updatedAt: new Date(),
      lastMessage: `${targetName} was removed from the community.`,
      lastMessageTime: new Date()
    });

    // Add system message
    await db.collection('messages').add({
      chatId,
      content: `${targetName} was removed from the community.`,
      senderId: 'system',
      timestamp: new Date(),
      type: 'system'
    });

    res.json({ success: true, message: 'Member removed from community' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

router.post('/:chatId/invite', verifyToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { targetUid } = req.body;
    const uid = req.user.uid;

    if (!targetUid) return res.status(400).json({ error: 'Target UID is required' });

    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) return res.status(404).json({ error: 'Community not found' });
    if (!chatDoc.data().members?.includes(uid)) return res.status(403).json({ error: 'Access denied' });

    if (chatDoc.data().members.includes(targetUid)) {
      return res.status(400).json({ error: 'User is already a member' });
    }

    // Since we are adding members directly for now as requested (or invitation based?)
    // User said "give there a option add more members".
    // I'll implement it as a direct add for simplicity if they are freelancers.
    
    const targetDoc = await db.collection('users').doc(targetUid).get();
    if (!targetDoc.exists || targetDoc.data().role !== 'freelancer') {
      return res.status(400).json({ error: 'Only freelancers can be added to community' });
    }

    const userName = targetDoc.data().name || 'Freelancer';

    await chatRef.update({
      members: [...chatDoc.data().members, targetUid],
      updatedAt: new Date(),
      lastMessage: `${userName} joined the community!`,
      lastMessageTime: new Date()
    });

    // Add system message
    await db.collection('messages').add({
      chatId,
      content: `${userName} was added to the community.`,
      senderId: 'system',
      timestamp: new Date(),
      type: 'system'
    });

    res.json({ success: true, message: 'Member added to community' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add member' });
  }
});

export default router;
