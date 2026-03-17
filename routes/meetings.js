import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { auth, db } from '../config/firebase.js';
import dotenv from 'dotenv';

dotenv.config();

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
 * POST /api/meetings/schedule
 * Generate a meeting room and host token
 */
router.post('/schedule', verifyToken, async (req, res) => {
  try {
    const { participantId, participantName, scheduledTime } = req.body;
    const hostId = req.user.uid;
    const hostName = req.user.name || req.user.email || 'Host';

    // Generate a unique room name
    const roomName = `meeting_${hostId.slice(0, 5)}_${Date.now()}`;

    // Create Access Token for the host
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: hostId,
        name: hostName,
      }
    );
    at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

    const hostJwt = await at.toJwt();

    // Generate host link
    // Use request origin to ensure the port matches the current frontend
    const origin = req.headers.origin || req.headers.referer || process.env.FRONTEND_URL || 'http://localhost:5174';
    // Remove trailing slash if present in origin
    const baseUrl = origin.replace(/\/$/, '');
    const hostLink = `${baseUrl}/meeting/${roomName}?token=${hostJwt}`;

    // Persist meeting to Firestore
    await db.collection('meetings').add({
      hostId,
      hostName,
      participantId,
      participantName: participantName || 'Guest',
      roomName,
      hostLink,
      timestamp: new Date(),
      scheduledTime: scheduledTime ? new Date(scheduledTime) : null,
      status: scheduledTime ? 'scheduled' : 'active',
      notified: false // flag for cron job
    });

    res.json({
      success: true,
      roomName,
      token: hostJwt,
      links: {
        host: hostLink,
      }
    });
  } catch (error) {
    console.error('Schedule meeting error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to schedule meeting', 
      message: error.message 
    });
  }
});

/**
 * POST /api/meetings/join
 * Join an existing meeting room
 */
router.post('/join', verifyToken, async (req, res) => {
  try {
    const { roomName } = req.body;
    const userId = req.user.uid;
    const userName = req.user.name || req.user.email || 'Participant';

    if (!roomName) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    // Create Access Token for the participant
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: userId,
        name: userName,
      }
    );
    at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

    const token = await at.toJwt();

    res.json({
      success: true,
      token,
      roomName
    });
  } catch (error) {
    console.error('Join meeting error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to join meeting', 
      message: error.message 
    });
  }
});

export default router;
