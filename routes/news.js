import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const apiKey = process.env.NEWS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, message: 'News API key not configured' });
    }

    // Get yesterday's date to ensure we have content
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const fromDate = date.toISOString().split('T')[0];
    
    // Refined query for startup business, entrepreneurs, freelancers, and investment
    const query = '(startup AND (investment OR funding OR business)) OR (entrepreneur AND startup) OR (freelancer AND business) OR "venture capital"';
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=${fromDate}&sortBy=publishedAt&language=en&apiKey=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();



    if (data.status !== 'ok') {
      return res.status(500).json({ success: false, message: data.message || 'Failed to fetch news' });
    }

    // Map the articles to a simpler format
    const news = data.articles.map((article, index) => ({
      id: index,
      title: article.title,
      description: article.description,
      summary: article.description ? (article.description.length > 150 ? article.description.substring(0, 150) + '...' : article.description) : 'No description available',
      url: article.url,
      urlToImage: article.urlToImage,
      publishedAt: article.publishedAt,
      source: article.source.name
    }));

    res.json({ success: true, news });
  } catch (error) {
    console.error('News API Error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
