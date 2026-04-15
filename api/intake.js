// Vercel serverless function — handles website contact form submissions
// POST /api/intake

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, phone, email, matter_type, description } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const matterLabels = {
      trucking_pi: 'Trucking / Personal Injury',
      business_dispute: 'Business Dispute / Fraud',
      federal_criminal: 'Federal Criminal Defense',
      other: 'Other'
    };

    const matterLabel = matterLabels[matter_type] || matter_type || 'Not specified';
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

    // Send notification email via Microsoft Graph
    const emailBody = `New website inquiry received at ${timestamp}

Name: ${name}
Phone: ${phone}
Email: ${email || 'Not provided'}
Matter Type: ${matterLabel}

Description:
${description || 'Not provided'}

---
Submitted via jimmyardoinlaw.com`;

    // Notify via email using Graph API
    const refreshToken = process.env.OUTLOOK_REFRESH_TOKEN;
    const clientId = process.env.OUTLOOK_CLIENT_ID;
    const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
    const tenantId = process.env.OUTLOOK_TENANT_ID;

    if (refreshToken && clientId && clientSecret && tenantId) {
      // Get access token
      const tokenRes = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: 'https://graph.microsoft.com/Mail.Send offline_access'
          })
        }
      );

      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: {
              subject: `New Website Inquiry — ${name} (${matterLabel})`,
              body: { contentType: 'Text', content: emailBody },
              toRecipients: [{ emailAddress: { address: 'jimmy@jimmyardoinlaw.com' } }]
            }
          })
        });
      }
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
