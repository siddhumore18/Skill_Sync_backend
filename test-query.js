import { db } from './config/firebase.js';

(async () => {
    try {
        const snap = await db.collection('projects').get();
        let projects = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        for (const project of projects) {
          if (!project.communityChatId) {
            const communityChatId = `community_${db.collection('chats').doc().id}`;
            await db.collection('projects').doc(project.id).update({ communityChatId });
            project.communityChatId = communityChatId;
            
            const ownerUid = project.ownerId || 'admin';
            
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
            console.log("Updated", project.id);
          }
        }
        
        projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        console.log("Success! Found", projects.length, "projects.");
    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
})();
