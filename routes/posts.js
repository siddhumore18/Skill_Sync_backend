import express from 'express';
import multer from 'multer';
import cloudinary from '../config/cloudinary.js';
import { db, auth } from '../config/firebase.js';

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

// Promisified upload_stream helper (do not mutate SDK object)
const uploadBufferToCloudinary = (fileBuffer, options) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
    if (error) return reject(error);
    resolve(result);
  });
  stream.end(fileBuffer);
});

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function extractYouTubeId(url) {
  if (!url) return null;
  const regex = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Create a post
// Accepts multipart/form-data for image uploads
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { authorId, authorName, role, title, description, mediaType, youtubeUrl } = req.body;

    if (!authorId || !authorName || !role || !title || !description) {
      return res.status(400).json({ error: 'authorId, authorName, role, title, description are required' });
    }

    let mediaUrl = null;
    let normalizedMediaType = null;

    if (mediaType === 'image') {
      if (!req.file) {
        return res.status(400).json({ error: 'Image file is required when mediaType is image' });
      }
      const uploadResult = await uploadBufferToCloudinary(req.file.buffer, { folder: 'skillsync_posts' });
      mediaUrl = uploadResult.secure_url;
      normalizedMediaType = 'image';
    } else if (mediaType === 'youtube') {
      const videoId = extractYouTubeId(youtubeUrl);
      if (!videoId) {
        return res.status(400).json({ error: 'Valid YouTube URL is required for mediaType youtube' });
      }
      mediaUrl = `https://www.youtube.com/watch?v=${videoId}`;
      normalizedMediaType = 'youtube';
    } else if (mediaType) {
      return res.status(400).json({ error: 'Invalid mediaType. Use image or youtube.' });
    }

    let summary = null;
    try {
      if (description && description.length > 50) {
        const { default: openai } = await import('../config/openai.js');
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini", // Using a cost-effective model
          messages: [
            {
              role: "system",
              content: "You are an expert venture capital analyst. Your task is to provide a highly professional, concise, and structured summary of a pitch deck or project description. Focus on the core value proposition, problem solved, and key traction/metrics. Keep the summary under 160 characters and use a professional, executive tone. No fluff."
            },
            {
              role: "user",
              content: description
            }
          ],
          max_tokens: 100,
        });
        summary = response.choices[0].message.content.trim();
      }
    } catch (aiErr) {
      console.error('AI Summarization error:', aiErr);
      // Fallback: don't fail the whole post creation if AI fails
    }

    const postDoc = {
      authorId,
      authorName,
      role,
      title,
      description,
      summary, // Added summary field
      mediaType: normalizedMediaType,
      mediaUrl,
      likes: [],
      comments: [],
      createdAt: new Date(),
    };

    const docRef = await db.collection('posts').add(postDoc);
    return res.json({ success: true, id: docRef.id, post: { id: docRef.id, ...postDoc } });
  } catch (err) {
    console.error('Create post error:', err);
    return res.status(500).json({ error: 'Failed to create post', message: err.message });
  }
});

// List posts (newest first)
router.get('/', async (req, res) => {
  try {
    const snap = await db.collection('posts').orderBy('createdAt', 'desc').limit(100).get();
    const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ success: true, posts });
  } catch (err) {
    console.error('List posts error:', err);
    return res.status(500).json({ error: 'Failed to fetch posts', message: err.message });
  }
});

// Like/Unlike a post
router.post('/:id/like', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;
    const postRef = db.collection('posts').doc(id);
    const post = await postRef.get();

    if (!post.exists) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const postData = post.data();
    const likes = postData.likes || [];
    const isLiked = likes.includes(userId);

    if (isLiked) {
      // Unlike
      await postRef.update({
        likes: likes.filter(uid => uid !== userId)
      });
    } else {
      // Like
      await postRef.update({
        likes: [...likes, userId]
      });
    }

    return res.json({ success: true, isLiked: !isLiked });
  } catch (err) {
    console.error('Like post error:', err);
    return res.status(500).json({ error: 'Failed to like post' });
  }
});

// Comment on a post
router.post('/:id/comment', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, authorName } = req.body;
    const userId = req.user.uid;

    if (!content) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    const postRef = db.collection('posts').doc(id);
    const post = await postRef.get();

    if (!post.exists) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const comment = {
      id: db.collection('dummy').doc().id,
      userId,
      authorName: authorName || 'User',
      content,
      createdAt: new Date()
    };

    const postData = post.data();
    const comments = postData.comments || [];

    await postRef.update({
      comments: [...comments, comment]
    });

    return res.json({ success: true, comment });
  } catch (err) {
    console.error('Comment post error:', err);
    return res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Get AI Recommended Posts
router.post('/recommend', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    // Fetch User Profile
    const userSnap = await db.collection('users').doc(userId).get();
    let userData = {};
    if (userSnap.exists) {
      userData = userSnap.data();
    }
    
    // Fetch Recent Posts
    const snap = await db.collection('posts').orderBy('createdAt', 'desc').limit(50).get();
    const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Prepare prompt
    const prompt = `
    You are an AI recommendation engine for a professional networking platform (Entrepreneur, Freelancer, Investor).
    User Profile:
    - Role: ${userData.role || 'Unknown'}
    - Skills/Interests: ${(userData.skills || []).join(', ')}
    - Bio: ${userData.bio || 'None'}

    Recent Posts:
    ${posts.map(p => `[ID: ${p.id}] Role: ${p.role} | Title: ${p.title} | Summary: ${p.summary || p.description?.substring(0, 100)}`).join('\n')}

    Select the top 5 to 10 most relevant post IDs for this user based on their profile. Return ONLY a valid JSON array of strings containing the IDs. No markdown formatting, no explanation.
    `;

    try {
      const { default: openai } = await import('../config/openai.js');
      const aiRes = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.3
      });

      const rawContent = aiRes.choices[0].message.content.trim();
      let recommendedIds = [];
      try {
        recommendedIds = JSON.parse(rawContent.replace(/```json/g, '').replace(/```/g, ''));
      } catch (parseErr) {
        console.error("Failed to parse AI response:", rawContent);
        // Fallback: Just return recent 10
        recommendedIds = posts.slice(0, 10).map(p => p.id);
      }

      const recommendedPosts = posts.filter(p => recommendedIds.includes(p.id));
      
      // If AI returned fewer valid posts, backfill with recent posts
      if (recommendedPosts.length < 5) {
        const existingIds = new Set(recommendedPosts.map(p => p.id));
        for (const p of posts) {
          if (!existingIds.has(p.id)) {
            recommendedPosts.push(p);
            existingIds.add(p.id);
            if (recommendedPosts.length >= 10) break;
          }
        }
      }

      return res.json({ success: true, posts: recommendedPosts });

    } catch (aiError) {
      console.error('AI Recommendation error (quota/network):', aiError.message);
      // Mock Fallback: Return a subset of recent posts randomly sorted or just recent
      const fallbackPosts = posts.slice(0, 10).sort(() => 0.5 - Math.random());
      return res.json({ success: true, posts: fallbackPosts, fallback: true });
    }

  } catch (err) {
    console.error('Recommend posts error:', err);
    return res.status(500).json({ error: 'Failed to generate recommendations', message: err.message });
  }
});

export default router;


