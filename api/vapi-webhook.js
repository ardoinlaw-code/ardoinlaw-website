// Vercel serverless function — handles Vapi call-ended webhooks
// POST /api/vapi-webhook

// Extract intake data from transcript
function parseIntake(transcript, summary) {
  const data = { firstName: '', lastName: '', phone: '', caseType: '', message: summary || '' };

  // Try to extract name from transcript
  const nameMatch = transcript.match(/(?:my name is|I'm|I am|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (nameMatch) {
    const parts = nameMatch[1].trim().split(' ');
    data.firstName = parts[0] || '';
    data.lastName = parts.slice(1).join(' ') || '';
  }

  // Try to extract phone
  const phoneMatch = transcript.match(/(\d{3}[-.]?\d{3}[-.]?\d{4}|\(\d{3}\)\s*\d{3}[-.]?\d{4})/);
  if (phoneMatch) data.phone = phoneMatch[1].replace(/\D/g, '');

  // Determine case type
  const t = transcript.toLowerCase();
  if (t.includes('truck') || t.includes('accident') || t.includes('injury') || t.includes('crash')) data.caseType = 'PI/Trucking';
  else if (t.includes('federal') || t.includes('indicted') || t.includes('arrested') || t.includes('criminal') || t.includes('fraud')) data.caseType = 'Federal Criminal';
  else if (t.includes('business') || t.includes('partner') || t.includes('contract') || t.includes('dispute')) data.caseType = 'Business Dispute';

  return data;
}

async function getEmailToken(tenantId, clientId, clientSecret, refreshToken) {
  const res = await fetch(
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
  const data = await res.json();
  return data.access_token || null;
}

async function sendEmail(token, subject, body) {
  await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'Text', content: body },
        toRecipients: [{ emailAddress: { address: 'jimmy@jimmyardoinlaw.com' } }]
      }
    })
  });
}

async function createClioGrowLead(intake, caller, summary, callType) {
  const token = process.env.CLIO_GROW_TOKEN;
  if (!token) return null;

  const firstName = intake.firstName || 'Unknown';
  const lastName = intake.lastName || 'Caller';
  const message = `${callType} — ${intake.caseType || 'General'}\n\n${summary}\n\nCaller number: ${caller}`;

  const res = await fetch('https://grow.clio.com/inbox_leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      inbox_lead: {
        from_first: firstName,
        from_last: lastName,
        from_phone: intake.phone || caller.replace('+1', ''),
        from_message: message.slice(0, 1000),
        referring_url: 'https://jimmyardoinlaw.com',
        from_source: 'Phone Intake - Alex'
      },
      inbox_lead_token: token
    })
  });

  const data = await res.json();
  return data?.inbox_lead?.id || null;
}

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

      // Parse intake data from transcript
      const intake = parseIntake(transcript, summary);

      // Create Clio Grow lead for new client intakes
      let clioLeadId = null;
      if (callType === 'NEW INTAKE' || callType === 'URGENT - TRANSFERRED') {
        clioLeadId = await createClioGrowLead(intake, caller, summary, callType);
      }

      // Send notification email
      const refreshToken = process.env.OUTLOOK_REFRESH_TOKEN;
      const clientId = process.env.OUTLOOK_CLIENT_ID;
      const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
      const tenantId = process.env.OUTLOOK_TENANT_ID;

      if (refreshToken && clientId && clientSecret && tenantId) {
        const token = await getEmailToken(tenantId, clientId, clientSecret, refreshToken);
        if (token) {
          const clioNote = clioLeadId ? `\nClio Grow Lead created: #${clioLeadId}` : '';
          const emailBody = `Call Type: ${callType}
Caller: ${caller}
Duration: ${duration} seconds${clioNote}

Summary:
${summary}

Full Transcript:
${transcript.slice(0, 3000)}`;

          await sendEmail(token, `📞 ${callType} — ${caller} (${duration}s)`, emailBody);
        }
      }
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
