import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Brevo SMTP configuration from environment variables
const BREVO_SMTP_SERVER = process.env.BREVO_SMTP_SERVER || 'smtp-relay.brevo.com';
const BREVO_SMTP_PORT = process.env.BREVO_SMTP_PORT || 587;
const BREVO_SMTP_USER = process.env.BREVO_SMTP_USER || '';
const BREVO_SMTP_PASSWORD = process.env.BREVO_SMTP_PASSWORD || '';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'srmore125125@gmail.com';
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'SkillSync Team';

/**
 * Check if email is properly configured
 * @returns {boolean}
 */
const isEmailConfigured = () => {
  return !!(BREVO_SMTP_USER && BREVO_SMTP_PASSWORD && SENDER_EMAIL);
};

/**
 * Create and configure nodemailer transporter for Brevo
 * @returns {Object}
 */
const createTransporter = () => {
  return nodemailer.createTransport({
    host: BREVO_SMTP_SERVER,
    port: BREVO_SMTP_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
      user: BREVO_SMTP_USER,
      pass: BREVO_SMTP_PASSWORD
    },
    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development'
  });
};

/**
 * Send OTP email with a professional template using Brevo
 * @param {string} email - Recipient email
 * @param {string} otp - OTP code
 * @returns {Promise<{success: boolean, otp?: string, error?: any}>}
 */
export const sendOTPEmail = async (email, otp) => {
  console.log('🔍 Email configuration check:');
  console.log('- BREVO_SMTP_USER:', BREVO_SMTP_USER ? '✅ Set' : '❌ Missing');
  console.log('- BREVO_SMTP_PASSWORD:', BREVO_SMTP_PASSWORD ? '✅ Set' : '❌ Missing');
  console.log('- SENDER_EMAIL:', SENDER_EMAIL || '❌ Not set');
  
  if (!isEmailConfigured()) {
    const errorMsg = 'Email not properly configured. Check your environment variables.';
    console.error('❌', errorMsg);
    return { 
      success: false, 
      error: errorMsg,
      // Signal to the caller that config is missing so it can decide
      notConfigured: true,
      otp: process.env.NODE_ENV === 'development' ? otp : undefined 
    };
  }

  const mailOptions = {
    from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
    to: email,
    subject: '🔐 Your SkillSync Verification Code',
    text: `Your SkillSync verification code is: ${otp}\n\nThis code will expire in 10 minutes.`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Verify Your Email - SkillSync</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px; border: 1px solid #e0e0e0;">
          <div style="text-align: center; margin-bottom: 25px;">
            <h1 style="color: #4a6cf7; margin: 0;">SkillSync</h1>
            <h2 style="color: #2d3748; margin: 10px 0 0 0;">Verify Your Email</h2>
          </div>
          
          <p>Hello,</p>
          <p>Thank you for registering with SkillSync. Please use the following verification code to complete your registration:</p>
          
          <div style="background-color: #ffffff; padding: 20px; border-radius: 6px; text-align: center; margin: 25px 0; border: 1px dashed #cbd5e0;">
            <div style="font-size: 28px; font-weight: bold; letter-spacing: 3px; color: #2d3748;">${otp}</div>
            <div style="font-size: 12px; color: #718096; margin-top: 8px;">(This code is valid for 10 minutes)</div>
          </div>
          
          <p>If you didn't request this code, you can safely ignore this email. Someone else might have entered your email by mistake.</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #718096;">
            <p>This email was sent to ${email} as part of your SkillSync account registration.</p>
            <p>© ${new Date().getFullYear()} SkillSync. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    const transporter = createTransporter();
    await transporter.sendMail(mailOptions);
    console.log(`✅ Verification email sent to ${email} via Brevo`);
    return { success: true, otp };
  } catch (error) {
    console.error('❌ Brevo SMTP Error:', error);

    // In development mode, log details but DO NOT include OTP here.
    // We only include OTP when notConfigured above.
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️ Email send failed (see logs). No OTP auto-fill since email is configured.');
      console.error('Error details:', error.message || error);
    }

    return { 
      success: false, 
      error: 'Failed to send verification email. Please try again later.',
      details: error.message
    };
  }
};

