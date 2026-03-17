import express from 'express';
import { db, auth } from '../config/firebase.js';

const router = express.Router();

// Middleware to verify Firebase token
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

// GET /api/projects
// ?owned=true returns only projects created by the user
router.get('/', verifyToken, async (req, res) => {
  try {
    const { owned } = req.query;
    const userId = req.user.uid;
    
    let query = db.collection('projects');
    
    if (owned === 'true') {
      query = query.where('ownerId', '==', userId);
    }
    
    // Note: If you face index errors when querying orderBy on top of where,
    // you may need to create a Firestore composite index.
    // We'll fetch all matching and sort in memory if needed or rely on no-sort for now
    const snap = await query.get();
    let projects = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Legacy migration: ensure all projects have a community chat
    for (const project of projects) {
      if (!project.communityChatId) {
        const communityChatId = `community_${db.collection('chats').doc().id}`;
        await db.collection('projects').doc(project.id).update({ communityChatId });
        project.communityChatId = communityChatId;
        
        const ownerUid = project.ownerId || 'admin';
        
        // Create the community chat if it doesn't exist
        await db.collection('chats').doc(communityChatId).set({
          id: communityChatId,
          name: `${project.name || 'Project'} Community`,
          isCommunity: true,
          members: [ownerUid],
          lastMessage: 'Project community initialized.',
          lastMessageTime: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ownerUid: ownerUid,
          projectId: project.id
        });
      }
    }
    
    // Sort descending by createdAt
    projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    return res.json({ success: true, projects });
  } catch (err) {
    console.error('Fetch projects error:', err);
    return res.status(500).json({ error: 'Failed to fetch projects', message: err.message });
  }
});

// POST /api/projects
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, details } = req.body;
    const ownerId = req.user.uid;

    if (!name || !details) {
      return res.status(400).json({ error: 'name and details are required' });
    }

    const communityChatId = `community_${db.collection('chats').doc().id}`;
    
    const projectDoc = {
      ownerId,
      name,
      details,
      applicants: [],
      createdAt: new Date().toISOString(),
      communityChatId
    };

    const docRef = await db.collection('projects').add(projectDoc);

    // Create the community chat entries
    await db.collection('chats').doc(communityChatId).set({
      id: communityChatId,
      name: `${name} Community`,
      isCommunity: true,
      members: [ownerId],
      lastMessage: 'Project community created! Recruitment in progress.',
      lastMessageTime: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ownerUid: ownerId,
      projectId: docRef.id
    });

    return res.json({ success: true, project: { id: docRef.id, ...projectDoc } });
  } catch (err) {
    console.error('Create project error:', err);
    return res.status(500).json({ error: 'Failed to create project', message: err.message });
  }
});

// GET /api/projects/applications
router.get('/applications', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snap = await db.collection('projects').where('ownerId', '==', userId).get();
    
    let applications = [];
    snap.docs.forEach(doc => {
      const projectData = doc.data();
      const applicants = projectData.applicants || [];
      
      applicants.forEach(app => {
        applications.push({
          id: `${doc.id}_${app.applicantId}`, // Unique application ID
          projectId: doc.id,
          projectName: projectData.name,
          applicantId: app.applicantId,
          freelancerName: app.freelancerName || app.applicantName, // handle legacy/new
          freelancerEmail: app.freelancerEmail || app.applicantEmail,
          status: app.status || 'pending',
          createdAt: app.appliedAt || projectData.createdAt,
          type: app.type || 'freelancer',
          investmentAmount: app.investmentAmount,
          equityWanted: app.equityWanted
        });
      });
    });

    // Sort descending by date
    applications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({ success: true, applications });
  } catch (err) {
    console.error('Fetch applications error:', err);
    return res.status(500).json({ error: 'Failed to fetch applications', message: err.message });
  }
});

// POST /api/projects/applications/:id/respond
router.post('/applications/:id/respond', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    const ownerId = req.user.uid;

    const [projectId, applicantId] = id.split('_');
    if (!projectId || !applicantId) {
       return res.status(400).json({ error: 'Invalid application ID format' });
    }

    const projectRef = db.collection('projects').doc(projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const projectData = projectDoc.data();
    if (projectData.ownerId !== ownerId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const applicants = projectData.applicants || [];
    const appIndex = applicants.findIndex(a => a.applicantId === applicantId);

    if (appIndex === -1) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const applicantData = applicants[appIndex];
    applicantData.status = action; // 'accepted' or 'rejected'

    await projectRef.update({ applicants });

    // If accepted, add applicant to community chat and notify
    if (action === 'accepted') {
      if (projectData.communityChatId) {
        const chatRef = db.collection('chats').doc(projectData.communityChatId);
        const chatDoc = await chatRef.get();
        if (chatDoc.exists) {
          const chatData = chatDoc.data();
          const members = chatData.members || [];
          if (!members.includes(applicantId)) {
            members.push(applicantId);
            const applicantName = applicantData.freelancerName || 'A new member';
            await chatRef.update({ 
              members,
              updatedAt: new Date(),
              lastMessage: `${applicantName} joined the project community!`,
              lastMessageTime: new Date()
            });

            // Add system message to the chat
            await db.collection('messages').add({
              chatId: projectData.communityChatId,
              content: `${applicantName} was added to the project community.`,
              senderId: 'system',
              timestamp: new Date(),
              type: 'system'
            });
          }
        }
      }

      // Create an accepted notification for the applicant
      const notificationRef = db.collection('notifications').doc();
      await notificationRef.set({
        uid: applicantId,
        type: 'application_accepted',
        title: 'Application Accepted',
        message: `Your application to project "${projectData.name || 'Project'}" was accepted!`,
        relatedId: projectId,
        senderName: 'Entrepreneur',
        senderUid: ownerId,
        createdAt: new Date(),
        read: false
      });

      // Emit real-time socket notification to applicant
      const io = req.app.get('io');
      if (io) {
        io.to(applicantId).emit('notification', {
          type: 'application_accepted',
          id: notificationRef.id,
          senderUid: ownerId,
          createdAt: new Date().toISOString()
        });
      }
    } else if (action === 'rejected') {
      // Create a rejected notification
      const notificationRef = db.collection('notifications').doc();
      await notificationRef.set({
        uid: applicantId,
        type: 'application_rejected',
        title: 'Application Update',
        message: `Your application to project "${projectData.name || 'Project'}" was declined.`,
        relatedId: projectId,
        senderName: 'Entrepreneur',
        senderUid: ownerId,
        createdAt: new Date(),
        read: false
      });

      const io = req.app.get('io');
      if (io) {
        io.to(applicantId).emit('notification', {
          type: 'application_rejected',
          id: notificationRef.id,
          senderUid: ownerId,
          createdAt: new Date().toISOString()
        });
      }
    }

    return res.json({ success: true, message: `Application ${action}` });
  } catch (err) {
    console.error('Respond to application error:', err);
    return res.status(500).json({ error: 'Failed to respond', message: err.message });
  }
});

// GET /api/projects/my-investments
router.get('/my-investments', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    // As Firebase doesn't support array-contains for object properties easily,
    // we query all projects (or a reasonable limit) and filter in memory.
    const snap = await db.collection('projects').get();
    
    let investments = [];
    snap.docs.forEach(doc => {
      const projectData = doc.data();
      const applicants = projectData.applicants || [];
      
      const myApplication = applicants.find(app => app.applicantId === userId && app.type === 'investor');
      
      if (myApplication) {
        investments.push({
          projectId: doc.id,
          projectName: projectData.name,
          projectDetails: projectData.details,
          communityChatId: projectData.communityChatId,
          ownerId: projectData.ownerId,
          investmentAmount: myApplication.investmentAmount,
          equityWanted: myApplication.equityWanted,
          status: myApplication.status || 'pending',
          appliedAt: myApplication.appliedAt || projectData.createdAt
        });
      }
    });

    // Sort descending by applied date
    investments.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));

    return res.json({ success: true, investments });
  } catch (err) {
    console.error('Fetch my investments error:', err);
    return res.status(500).json({ error: 'Failed to fetch investments', message: err.message });
  }
});

// GET /api/projects/my-active-projects
router.get('/my-active-projects', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snap = await db.collection('projects').get();
    
    let projects = [];
    snap.docs.forEach(doc => {
      const projectData = doc.data();
      const applicants = projectData.applicants || [];
      
      const myApplication = applicants.find(app => 
        app.applicantId === userId && 
        (app.type || 'freelancer') === 'freelancer' && 
        app.status === 'accepted'
      );
      
      if (myApplication) {
        projects.push({
          id: doc.id,
          name: projectData.name,
          details: projectData.details,
          communityChatId: projectData.communityChatId,
          ownerId: projectData.ownerId,
          status: myApplication.status,
          appliedAt: myApplication.appliedAt || projectData.createdAt
        });
      }
    });

    // Sort by applied date
    projects.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));

    return res.json({ success: true, projects });
  } catch (err) {
    console.error('Fetch my active projects error:', err);
    return res.status(500).json({ error: 'Failed to fetch active projects', message: err.message });
  }
});

// POST /api/projects/:id/apply
router.post('/:id/apply', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { freelancerName, freelancerEmail, applicantName, applicantEmail, type, investmentAmount, equityWanted } = req.body;
    const applicantId = req.user.uid;

    const nameToSave = applicantName || freelancerName;
    const emailToSave = applicantEmail || freelancerEmail;

    if (!nameToSave || !emailToSave) {
      return res.status(400).json({ error: 'Applicant name and email are required' });
    }

    const projectRef = db.collection('projects').doc(id);
    const project = await projectRef.get();

    if (!project.exists) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const application = {
      applicantId,
      applicantName: nameToSave, // Save modern names
      applicantEmail: emailToSave,
      freelancerName: nameToSave, // Keep legacy names for compatibility in UI if any
      freelancerEmail: emailToSave,
      status: 'pending',
      appliedAt: new Date().toISOString(),
      type: type || 'freelancer',
    };

    if (type === 'investor' && investmentAmount && equityWanted) {
      application.investmentAmount = investmentAmount;
      application.equityWanted = equityWanted;
    }

    const projectData = project.data();
    const applicants = projectData.applicants || [];
    
    // Check if already applied
    if (applicants.some(a => a.applicantId === applicantId)) {
      return res.status(400).json({ error: 'You have already applied to this project' });
    }

    await projectRef.update({
      applicants: [...applicants, application]
    });

    // Create a notification for the project owner (entrepreneur)
    if (projectData.ownerId) {
      await db.collection('notifications').add({
        uid: projectData.ownerId, // The person receiving the notification
        type: 'project_application',
        title: 'New Project Application',
        message: `${nameToSave} applied to your project "${projectData.name || 'Project'}"`,
        relatedId: id,
        senderName: nameToSave,
        senderUid: applicantId,
        createdAt: new Date(),
        read: false
      });

      // Emit real-time socket notification
      const io = req.app.get('io');
      if (io) {
        io.to(projectData.ownerId).emit('notification', {
          type: 'project_application',
          id: id,
          senderUid: applicantId,
          senderName: nameToSave,
          createdAt: new Date().toISOString()
        });
      }
    }

    return res.json({ success: true, message: 'Application submitted', application });
  } catch (err) {
    console.error('Apply to project error:', err);
    return res.status(500).json({ error: 'Failed to apply to project', message: err.message });
  }
});

// PUT /api/projects/:id
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const ownerId = req.user.uid;

    const projectRef = db.collection('projects').doc(id);
    const project = await projectRef.get();

    if (!project.exists) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.data().ownerId !== ownerId) {
      return res.status(403).json({ error: 'Unauthorized to update this project' });
    }

    // Sanitize updateData - don't allow changing sensitive fields if any
    delete updateData.id;
    delete updateData.ownerId;
    delete updateData.createdAt;

    await projectRef.update({
      ...updateData,
      updatedAt: new Date().toISOString()
    });

    return res.json({ success: true, message: 'Project updated successfully' });
  } catch (err) {
    console.error('Update project error:', err);
    return res.status(500).json({ error: 'Failed to update project', message: err.message });
  }
});

export default router;
