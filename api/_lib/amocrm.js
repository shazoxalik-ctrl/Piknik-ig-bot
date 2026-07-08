const AMO_SUBDOMAIN = "piknikuz";

export async function createAmoLead({ name, phone, leadName, price, sourceName }) {
  const amoToken = process.env.AMO_ACCESS_TOKEN;
  if (!amoToken) return { ok: false, reason: "no_token" };

  const ts = Math.floor(Date.now() / 1000);
  const unsortedRes = await fetch(`https://${AMO_SUBDOMAIN}.amocrm.ru/api/v4/leads/unsorted/forms`, {
    method: "POST",
    headers: { Authorization: `Bearer ${amoToken}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      {
        source_name: sourceName || "Piknic sayt",
        source_uid: `lead_${ts}_${Math.random().toString(36).slice(2)}`,
        metadata: { form_name: leadName, form_id: 1, form_page: sourceName || "piknic", form_sent_at: ts },
        _embedded: {
          leads: [{ name: leadName, price: parseInt((price || "").replace(/\D/g, "")) || 0 }],
          contacts: [
            {
              name: name || "Instagram mijoz",
              custom_fields_values: [{ field_code: "PHONE", values: [{ value: phone, enum_code: "WORK" }] }],
            },
          ],
        },
      },
    ]),
  });
  const unsortedData = await unsortedRes.json();
  const uid = unsortedData?._embedded?.unsorted?.[0]?.uid;
  if (!uid) return { ok: false, reason: "no_uid", raw: unsortedData };

  await fetch(`https://${AMO_SUBDOMAIN}.amocrm.ru/api/v4/leads/unsorted/${uid}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${amoToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status_id: 84285386 }),
  });
  return { ok: true, uid };
}

export async function notifyTelegram(text) {
  const token = process.env.TG_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}
