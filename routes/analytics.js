import express from 'express';
import { db, auth } from '../config/firebase.js';

const router = express.Router();

// Middleware to verify Firebase token
const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

/**
 * POST /api/analytics/track-view
 * Log a profile view (Investor views Entrepreneur)
 */
router.post('/track-view', verifyToken, async (req, res) => {
  try {
    const { targetUid } = req.body;
    if (!targetUid) return res.status(400).json({ error: 'targetUid is required' });

    const userRef = db.collection('users').doc(targetUid);
    await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);
      if (!doc.exists) throw new Error('User not found');
      const currentViews = doc.data().viewCount || 0;
      t.update(userRef, { viewCount: currentViews + 1 });
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/interest
 * Toggle investor interest in a startup
 */
router.post('/interest', verifyToken, async (req, res) => {
  try {
    const { targetUid } = req.body;
    const investorUid = req.user.uid;

    const userRef = db.collection('users').doc(targetUid);
    let isInterested = false;

    await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);
      if (!doc.exists) throw new Error('User not found');
      let interested = doc.data().interestedInvestors || [];
      
      if (interested.includes(investorUid)) {
        interested = interested.filter(uid => uid !== investorUid);
        isInterested = false;
      } else {
        interested.push(investorUid);
        isInterested = true;
      }
      t.update(userRef, { interestedInvestors: interested });
    });

    res.json({ success: true, isInterested });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/entrepreneur
 * Fetch real-time analytics for the entrepreneur dashboard
 */
router.get('/entrepreneur', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    
    // 1. Fetch Projects owned by user
    const projectsSnapshot = await db.collection('projects')
      .where('ownerId', '==', uid)
      .get();
    
    const activeProjects = projectsSnapshot.size;
    
    // 2. Fetch User data for view counts
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data() || {};
    const pitchViews = userData.viewCount || 0;

    // 3. Calculate Financials (Burn/Runway) - Placeholder logic or derived from accepted applications
    // We'll iterate through projects and sum up accepted freelancer "rates" if they exist
    let monthlyBurn = 0;
    projectsSnapshot.forEach(doc => {
      const p = doc.data();
      (p.applicants || []).forEach(app => {
        const type = app.type || 'freelancer';
        if (app.status === 'accepted' && type === 'freelancer') {
          monthlyBurn += (Number(app.hourlyRate) * 160) || Number(app.bidAmount) || 0;
        }
      });
    });

    // Dummy runway logic
    const totalCapital = userData.capital || 100000;
    const runway = monthlyBurn > 0 ? Math.floor(totalCapital / monthlyBurn) : 12;

    res.json({
      success: true,
      data: {
        activeProjects,
        pitchViews,
        monthlyBurn,
        runway,
        investorInterest: (userData.interestedInvestors || []).length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/investor
 */
router.get('/investor', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    
    // Fetch all projects and filter for accepted investments
    const snap = await db.collection('projects').get();
    let portfolioStartups = 0;
    let investedAmount = 0;
    const domains = {};

    snap.forEach(doc => {
      const p = doc.data();
      const myApp = (p.applicants || []).find(a => 
        a.applicantId === uid && 
        a.type === 'investor' && 
        a.status === 'accepted'
      );
      if (myApp) {
        portfolioStartups++;
        investedAmount += Number(myApp.investmentAmount || 0);
        const domain = p.industry || 'Tech';
        domains[domain] = (domains[domain] || 0) + 1;
      }
    });

    const roiDomain = Object.entries(domains).sort((a,b) => b[1]-a[1])[0]?.[0] || 'N/A';

    res.json({
      success: true,
      data: {
        portfolioStartups,
        investedAmount,
        roiDomain
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/freelancer
 */
router.get('/freelancer', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snap = await db.collection('projects').get();
    
    let activeContracts = 0;
    let thisMonthIncome = 0;
    let hoursTracked = 0;

    snap.forEach(doc => {
      const p = doc.data();
      const myApp = (p.applicants || []).find(a => 
        a.applicantId === uid && 
        (a.type || 'freelancer') === 'freelancer' && 
        a.status === 'accepted'
      );
      if (myApp) {
        activeContracts++;
        thisMonthIncome += Number(myApp.bidAmount || 0) || (Number(myApp.hourlyRate || 0) * 40); // estimate
        hoursTracked += 40; // placeholder for a week
      }
    });

    res.json({
      success: true,
      data: {
        activeContracts,
        thisMonthIncome,
        hoursTracked
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
