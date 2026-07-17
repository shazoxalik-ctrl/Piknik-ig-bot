const AMO_BASE = () => `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru`; // redeploy to pick up AMO_* env vars

const COMMUNITY_PIPELINE_ID = 10696658;
const STATUS_UNSORTED = 84285170;
const STATUS_NEW_MESSAGE = 85307774;
const STATUS_REPLIED = 84285174;
const STATUS_NUMBER_RECEIVED = 142;
const STATUS_CLOSED = 143;

async function amoFetch(path, options = {}) {
  if (!process.env.AMO_SUBDOMAIN || !process.env.AMO_ACCESS_TOKEN) {
    console.error('amoCRM skipped: AMO_SUBDOMAIN or AMO_ACCESS_TOKEN not set');
    return null;
  }
  const r = await fetch(`${AMO_BASE()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.AMO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!r.ok) {
    const text = await r.text();
    console.error('amoCRM error', r.status, text);
    return null;
  }
  if (r.status === 204) return {};
  return r.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wazzup takes a few seconds to create the amoCRM contact after a comment
// comes in, so we may beat it there. Retry a few times before giving up.
async function findCommunityLeadsForUsername(username) {
  if (!username) return [];

  for (let attempt = 1; attempt <= 4; attempt++) {
    const data = await amoFetch(`/api/v4/contacts?query=${encodeURIComponent(username)}&with=leads`);
    const contacts = data?._embedded?.contacts || [];
    const contact = contacts.find((c) => c.name === username) || contacts[0];
    if (contact) {
      const leadRefs = contact._embedded?.leads || [];
      const leads = [];
      for (const ref of leadRefs) {
        const lead = await amoFetch(`/api/v4/leads/${ref.id}`);
        if (lead && lead.pipeline_id === COMMUNITY_PIPELINE_ID) leads.push(lead);
      }
      return leads;
    }
    if (attempt < 4) await sleep(4000);
  }
  console.log('amoCRM: no contact found for', username, 'after retries');
  return [];
}

async function moveLeadToStatus(leadId, statusId) {
  const result = await amoFetch(`/api/v4/leads/${leadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ pipeline_id: COMMUNITY_PIPELINE_ID, status_id: statusId }),
  });
  console.log('amoCRM: moved lead', leadId, 'to status', statusId, result ? 'OK' : 'FAILED');
}

// Called once we've publicly replied to someone's comment. Moves their
// Community-pipeline deal from "unsorted"/"new message" to "Javob berildi".
export async function markCrmReplied(username) {
  try {
    const leads = await findCommunityLeadsForUsername(username);
    for (const lead of leads) {
      if (lead.status_id === STATUS_UNSORTED || lead.status_id === STATUS_NEW_MESSAGE) {
        await moveLeadToStatus(lead.id, STATUS_REPLIED);
      }
    }
  } catch (e) {
    console.error('markCrmReplied error', e);
  }
}

// Called once a phone number has been captured from this user. Moves their
// deal to "Raqam olindi" regardless of current stage (unless already closed).
export async function markCrmNumberReceived(username) {
  try {
    const leads = await findCommunityLeadsForUsername(username);
    for (const lead of leads) {
      if (lead.status_id !== STATUS_NUMBER_RECEIVED && lead.status_id !== STATUS_CLOSED) {
        await moveLeadToStatus(lead.id, STATUS_NUMBER_RECEIVED);
      }
    }
  } catch (e) {
    console.error('markCrmNumberReceived error', e);
  }
}

// amoCRM reuses status_id 142/143 as universal "won"/"lost" markers across every
// pipeline (only the display label differs per pipeline). So checking these two
// IDs tells us a lead's outcome regardless of which pipeline it's currently in.
const STATUS_WON = 142;
const STATUS_LOST = 143;

async function getLeadsForUsernameAnyPipeline(username) {
  if (!username) return [];
  const data = await amoFetch(`/api/v4/contacts?query=${encodeURIComponent(username)}&with=leads`);
  const contacts = data?._embedded?.contacts || [];
  const contact = contacts.find((c) => c.name === username) || contacts[0];
  if (!contact) return [];
  const leadRefs = contact._embedded?.leads || [];
  const leads = [];
  for (const ref of leadRefs) {
    const lead = await amoFetch(`/api/v4/leads/${ref.id}`);
    if (lead) leads.push(lead);
  }
  return leads;
}

// Returns 'sotib_oldi' | 'jarayonda' | 'yopilgan' | null (no CRM lead found at all).
export async function getLeadOutcomeForUsername(username) {
  const leads = await getLeadsForUsernameAnyPipeline(username);
  if (leads.length === 0) return null;
  if (leads.some((l) => l.status_id === STATUS_WON)) return 'sotib_oldi';
  if (leads.some((l) => l.status_id !== STATUS_LOST)) return 'jarayonda';
  return 'yopilgan';
}
