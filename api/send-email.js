// Simple in-memory rate limiter (resets on cold start, which is fine for Vercel)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 3; // max 3 submissions per minute per IP
const MIN_SUBMIT_TIME = 3000; // minimum 3 seconds between page load and submit

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimit.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return true;
  }

  return false;
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting by IP
  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const body = req.body || {};
  const { name, email, phone, service, message, website, timestamp } = body;

  // Honeypot check - if the hidden field is filled, it's a bot
  if (website) {
    // Return 200 so bots think it worked, but do nothing
    return res.status(200).json({ success: true });
  }

  // Timestamp check - reject if form was submitted too fast (bot behavior)
  if (timestamp) {
    const submitTime = Date.now() - parseInt(timestamp, 10);
    if (submitTime < MIN_SUBMIT_TIME) {
      // Too fast, likely a bot - silently accept
      return res.status(200).json({ success: true });
    }
  }

  // Validate required fields
  if (!name || !email || !message) {
    console.error('Missing fields:', { name: !!name, email: !!email, message: !!message, body: req.body });
    return res.status(400).json({
      error: 'Missing required fields',
      details: { name: !!name, email: !!email, message: !!message }
    });
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Top Gun Maintenance <Julian@topgunmaintenance.com>',
        to: ['Julian@topgunmaintenance.com'],
        subject: `New Contact: ${service || 'General Inquiry'} - ${name}`,
        reply_to: email,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
          <p><strong>Service:</strong> ${service || 'Not specified'}</p>
          <hr>
          <p><strong>Message:</strong></p>
          <p>${message.replace(/\n/g, '<br>')}</p>
        `
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}
