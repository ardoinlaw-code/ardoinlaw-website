// Vercel serverless function — handles Vapi call-ended webhooks
// POST /api/vapi-webhook

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const msgType = body?.message?.type;

    if (msgType === 'end-of-call-report') {
      const summary = body.message?.summary || 'No summary available';
      const caller = body.message?.customer?.number || 'Unknown';
      const duration = Math.round(body.message?.durationSeconds || 0);
      const transcript = body.message?.transcript || '';

      // Determine call type
      let callType = 'CALL';
      if (transcript.includes('[LEGAL_CALL]')) callType = 'LEGAL CALL';
      else if (transcript.includes('[EXISTING_CLIENT]')) callType = 'EXISTING CLIENT';
      else if (transcript.includes('[COMPLETE]')) callType = 'NEW INTAKE';
      else if (transcript.includes('[TRANSFER]')) callType = 'URGENT - TRANSFERRED';
      else if (transcript.includes('[OTHER_CALL]')) callType = 'OTHER';

      // Send notification email
      const refreshToken = process.env.OUTLOOK_REFRESH_TOKEN;
      const clientId = process.env.OUTLOOK_CLIENT_ID;
      const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
      const tenantId = process.env.OUTLOOK_TENANT_ID;

      if (refreshToken && clientId && clientSecret && tenantId) {
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
          const emailBody = `Call Type: ${callType}
Caller: ${caller}
Duration: ${duration} seconds

Summary:
${summary}

Full Transcript:
${transcript.slice(0, 3000)}`;

          await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: {
                subject: `📞 ${callType} — ${caller} (${duration}s)`,
                body: { contentType: 'Text', content: emailBody },
                toRecipients: [{ emailAddress: { address: 'jimmy@jimmyardoinlaw.com' } }]
              }
            })
          });
        }
      }
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
