import express from 'express';
import multer from 'multer';
import cloudinary from '../config/cloudinary.js';

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

/**
 * POST /api/upload/resume
 * Upload a PDF resume to Cloudinary
 */
router.post('/resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`Uploading resume to Cloudinary: ${req.file.originalname} (${req.file.size} bytes)`);

    // Convert buffer to base64 data URI
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;

    // Upload to Cloudinary
    // Use 'auto' to let Cloudinary handle the MIME type correctly for PDFs
    const uniqueFileName = `resume-${Date.now()}-${Math.round(Math.random() * 1E9)}.pdf`;
    
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: 'resumes',
      resource_type: 'auto',
      access_mode: 'public',
      public_id: uniqueFileName
    });

    console.log(`Cloudinary Success: ${result.secure_url}`);

    res.json({
      success: true,
      url: result.secure_url,
      public_id: result.public_id
    });
  } catch (error) {
    console.error('Cloudinary Resume upload error:', error);
    res.status(500).json({ 
      error: 'Failed to upload resume to Cloudinary', 
      message: error.message,
      details: error.details || 'Check backend logs'
    });
  }
});

export default router;
