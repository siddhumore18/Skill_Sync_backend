import { db } from './config/firebase.js';

/**
 * Initializes a cron-like interval that checks for meetings
 * that are scheduled to start right now.
 */
export function initMeetingCron(io) {
  if (!io) {
    console.warn("Meeting cron: No Socket.IO instance provided. Notifications won't be sent.");
    return;
  }

  // Check every minute
  setInterval(async () => {
    try {
      const now = new Date();
      // Add a 1 minute buffer so we catch meetings starting within the next minute
      const bufferTime = new Date(now.getTime() + 60000); 

      const meetingsRef = db.collection('meetings');
      
      // Since we can't easily query ISODates in Firestore without indexes, 
      // and 'scheduledTime' is a Date object (Timestamp in Firestore)
      const snapshot = await meetingsRef
        .where('status', '==', 'scheduled')
        .where('notified', '==', false)
        .where('scheduledTime', '<=', bufferTime)
        .get();

      if (snapshot.empty) {
        return;
      }

      snapshot.forEach(async (doc) => {
        const meeting = doc.data();
        
        // Ensure we don't notify for way-past meetings (older than 15 mins)
        // just in case they got stuck
        const meetTime = meeting.scheduledTime.toDate();
        if (now.getTime() - meetTime.getTime() > 15 * 60000) {
           await doc.ref.update({ notified: true, status: 'expired' });
           return;
        }

        // 1. Create a notification document for the participant
        if (meeting.participantId) {
          await db.collection('notifications').add({
            uid: meeting.participantId,
            title: `Meeting with ${meeting.hostName} is starting!`,
            message: `Your scheduled meeting is starting now. Click to join.`,
            type: 'meeting',
            link: meeting.hostLink, // We saved hostLink, but participant would need a guest link. 
            // We'll generate a proper guest join page route or use a clean link
            roomName: meeting.roomName,
            hostId: meeting.hostId,
            read: false,
            createdAt: new Date(),
          });

          // Emit real-time to participant
          io.to(meeting.participantId).emit('notification', {
            type: 'meeting',
            title: `Meeting with ${meeting.hostName} is starting!`,
            roomName: meeting.roomName
          });
        }

        // 2. Create a notification document for the host
        await db.collection('notifications').add({
          uid: meeting.hostId,
          title: `Your meeting is starting!`,
          message: `Your scheduled meeting with ${meeting.participantName} is starting now.`,
          type: 'meeting',
          link: meeting.hostLink,
          roomName: meeting.roomName,
          read: false,
          createdAt: new Date(),
        });

        // Emit real-time to host
        io.to(meeting.hostId).emit('notification', {
          type: 'meeting',
          title: `Your scheduled meeting is starting!`,
          roomName: meeting.roomName
        });

        // 3. Mark as notified
        await doc.ref.update({ notified: true });
        console.log(`Meeting cron: Fired notifications for room ${meeting.roomName}`);
      });
      
    } catch (error) {
      console.error('Meeting cron check failed:', error);
    }
  }, 60000); // 60,000 ms = 1 minute
}
