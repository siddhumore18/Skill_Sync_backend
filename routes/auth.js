import express from 'express';
import { auth, db } from '../config/firebase.js';
import { sendOTPEmail } from '../config/email.js';

const router = express.Router();

// Store OTP temporarily (in production, use Redis or similar)
const otpStore = new Map();

/**
 * Generate random OTP
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * POST /api/auth/register
 * Register a new user with email
 */
// Valid roles for the application
const ROLES = {
  ADMIN: 'admin',
  ENTREPRENEUR: 'entrepreneur',
  INVESTOR: 'investor',
  FREELANCER: 'freelancer'
};

router.post('/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;

    // Validate input
    if (!email || !password || !role) {
      return res.status(400).json({ 
        error: 'Email, password, and role are required' 
      });
    }

    // Validate role
    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Must be one of: ${Object.values(ROLES).join(', ')}`
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters' 
      });
    }

    // Check if user already exists
    try {
      const existingUser = await auth.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ 
          error: 'Email already registered' 
        });
      }
    } catch (error) {
      // User doesn't exist, which is good
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store OTP with user data
    otpStore.set(email, {
      otp,
      expiry: otpExpiry,
      password,
      name,
      role
    });

    // Send OTP email
    try {
      const emailResult = await sendOTPEmail(email, otp);

      // Config missing: allow dev fallback with OTP
      if (emailResult?.notConfigured && process.env.NODE_ENV === 'development') {
        console.warn('📧 Email not configured. Returning OTP in response (development mode).');
        return res.json({ 
          success: true, 
          message: 'OTP generated (email not configured - development mode)',
          email,
          otp: emailResult.otp,
          development: true
        });
      }

      // If send failed, respect failure (and optionally fallback in dev)
      if (!emailResult?.success) {
        console.error('❌ Failed to send OTP email:', emailResult?.error || 'Unknown error');
        if (process.env.NODE_ENV === 'development') {
          console.warn('⚠️ Email send failed but returning OTP in development mode.');
          return res.json({
            success: true,
            message: 'OTP generated (email send failed - development mode)',
            email,
            otp,
            development: true,
            debug: { details: emailResult?.details }
          });
        }
        return res.status(500).json({
          error: 'Failed to send OTP email',
          details: emailResult?.details
        });
      }

      // Email was sent successfully
      return res.json({ 
        success: true, 
        message: 'OTP sent to your email',
        email 
      });
    } catch (emailError) {
      console.error('Email error:', emailError);
      
      if (process.env.NODE_ENV !== 'development') {
        return res.status(500).json({ 
          error: 'Failed to send OTP email. Please check your email configuration.',
          message: emailError.message 
        });
      }
      
      // Development mode fallback: still return OTP even if send failed
      console.warn('⚠️  Email send failed but continuing in development mode.');
      return res.json({ 
        success: true, 
        message: 'OTP generated (email send failed - development mode)',
        email,
        otp,
        development: true
      });
    }
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ 
      error: 'Registration failed', 
      message: error.message 
    });
  }
});

/**
 * POST /api/auth/verify-otp
 * Verify OTP and create user account
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ 
        error: 'Email and OTP are required' 
      });
    }

    // Get stored OTP data
    const storedData = otpStore.get(email);

    if (!storedData) {
      return res.status(400).json({ 
        error: 'OTP not found or expired. Please register again.' 
      });
    }

    // Check if OTP expired
    if (Date.now() > storedData.expiry) {
      otpStore.delete(email);
      return res.status(400).json({ 
        error: 'OTP expired. Please register again.' 
      });
    }

    // Verify OTP
    if (storedData.otp !== otp) {
      return res.status(400).json({ 
        error: 'Invalid OTP' 
      });
    }

    // Note: User creation will be done on the frontend using Firebase Client SDK
    // This bypasses service account permission issues
    // We just verify the OTP here and return success
    
    // Clean up OTP
    otpStore.delete(email);

    // Return success with user info (user will be created on frontend)
    res.json({
      success: true,
      message: 'OTP verified successfully',
      user: {
        email: email,
        name: storedData.name || email.split('@')[0],
        role: storedData.role || ROLES.FREELANCER, // Default to freelancer if not set
      },
      // Note: User creation happens on frontend to avoid permission issues
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ 
      error: 'Verification failed', 
      message: error.message 
    });
  }
});

/**
 * POST /api/auth/login
 * Login with email and password
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      });
    }

    // Verify user exists in Firebase Auth
    try {
      const user = await auth.getUserByEmail(email);
      
      // Get user data from Firestore
      const userDoc = await db.collection('users').doc(user.uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};

      // Note: Password verification must be done client-side with Firebase Auth
      // We generate a custom token which the client will use to sign in
      // The client will verify the password using Firebase Auth SDK
      const customToken = await auth.createCustomToken(user.uid);

      res.json({
        success: true,
        message: 'Login successful',
        user: {
          uid: user.uid,
          email: user.email,
          name: user.displayName || userData.name || email.split('@')[0],
          role: userData.role || ROLES.FREELANCER,
        },
        customToken,
      });
    } catch (error) {
      console.error('Login error:', error);
      if (error.code === 'auth/user-not-found') {
        return res.status(401).json({ 
          error: 'Invalid email or password' 
        });
      }
      return res.status(401).json({ 
        error: 'Invalid email or password' 
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Login failed', 
      message: error.message 
    });
  }
});

/**
 * POST /api/auth/create-user-document
 * Create or update user document in Firestore
 */
router.post('/create-user-document', async (req, res) => {
  try {
    const { uid, email, name, role } = req.body;

    if (!uid || !email) {
      return res.status(400).json({ 
        error: 'UID and email are required' 
      });
    }

    // Create or update user document in Firestore
    const userData = {
      email: email,
      name: name || email.split('@')[0],
      role: role || ROLES.FREELANCER,
      updatedAt: new Date(),
    };

    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      userData.createdAt = new Date();
    }

    await db.collection('users').doc(uid).set(userData, { merge: true });

    res.json({
      success: true,
      user: {
        uid,
        email,
        name: userData.name,
        role: userData.role,
      },
    });
  } catch (error) {
    console.error('Create user document error:', error);
    res.status(500).json({ 
      error: 'Failed to create user document', 
      message: error.message 
    });
  }
});

/**
 * POST /api/auth/get-user
 * Get user data by UID
 */
router.post('/get-user', async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({ 
        error: 'UID is required' 
      });
    }

    // Rely on Firestore only to avoid Admin SDK permission issues in development
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ 
        error: 'User not found' 
      });
    }

    const userData = userDoc.data() || {};
    return res.json({
      success: true,
      user: {
        uid,
        email:     userData.email     || null,
        name:      userData.name      || (userData.email ? userData.email.split('@')[0] : 'User'),
        role:      userData.role      || ROLES.FREELANCER,
        bio:       userData.bio       || '',
        resume:    userData.resume    || '',
        skills:    Array.isArray(userData.skills) ? userData.skills : [],
        rate:      userData.rate      || '',
        phone:     userData.phone     || '',
        location:  userData.location  || '',
        linkedin:  userData.linkedin  || '',
        github:    userData.github    || '',
        portfolio: userData.portfolio || '',
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      error: 'Failed to get user', 
      message: error.message 
    });
  }
});

/**
 * POST /api/auth/resend-otp
 * Resend OTP to email
 */
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        error: 'Email is required' 
      });
    }

    // Get stored OTP data
    const storedData = otpStore.get(email);

    if (!storedData) {
      return res.status(400).json({ 
        error: 'No pending registration found. Please register again.' 
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Update stored OTP
    otpStore.set(email, {
      ...storedData,
      otp,
      expiry: otpExpiry,
    });

    // Send OTP email
    try {
      const emailResult = await sendOTPEmail(email, otp);
      
      // Check if OTP is returned (development mode)
      if (emailResult && emailResult.otp) {
        console.warn('📧 Email not configured. Returning OTP in response (development mode).');
        return res.json({ 
          success: true, 
          message: 'OTP regenerated (email not configured - development mode)',
          otp: emailResult.otp,
          development: true
        });
      }
      
      // Email was sent successfully
      res.json({ 
        success: true, 
        message: 'OTP resent to your email' 
      });
    } catch (emailError) {
      console.error('Email error:', emailError);
      
      // Development mode fallback
      if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️  Email send failed but returning OTP in development mode.');
        return res.json({ 
          success: true, 
          message: 'OTP regenerated (email send failed - development mode)',
          otp: otp,
          development: true
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to send OTP email' 
      });
    }
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ 
      error: 'Failed to resend OTP', 
      message: error.message 
    });
  }
});

/**
 * Test email endpoint (temporary, remove in production)
 */
router.get('/test-email', async (req, res) => {
  const testEmail = req.query.email || 'test@example.com';
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  console.log('\n=== Testing Email Sending ===');
  console.log(`Sending test email to: ${testEmail}`);
  
  try {
    const result = await sendOTPEmail(testEmail, otp);
    
    if (result.success) {
      console.log('✅ Email sent successfully!');
      return res.json({
        success: true,
        message: 'Test email sent successfully',
        email: testEmail,
        otp: process.env.NODE_ENV === 'development' ? otp : 'Check your email',
        debug: {
          brevoConfigured: !!(process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASSWORD),
          senderEmail: process.env.BREVO_SENDER_EMAIL
        }
      });
    } else {
      console.error('❌ Email sending failed:', result.error);
      return res.status(500).json({
        success: false,
        error: result.error,
        details: result.details || 'No additional details available',
        debug: {
          brevoConfigured: !!(process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASSWORD),
          senderEmail: process.env.BREVO_SENDER_EMAIL
        }
      });
    }
  } catch (error) {
    console.error('❌ Error in test endpoint:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send test email',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * PUT /api/auth/update-profile
 * Update profile fields (name, bio, skills, rate, etc.) for authenticated user
 */
router.put('/update-profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const allowedFields = ['name', 'bio', 'resume', 'skills', 'rate', 'phone', 'location', 'linkedin', 'github', 'portfolio', 'companyName', 'industry', 'registrationNo', 'businessAddress'];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.updatedAt = new Date();
    await db.collection('users').doc(uid).set(updates, { merge: true });

    res.json({ success: true, message: 'Profile updated', updates });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile', message: error.message });
  }
});

export default router;


