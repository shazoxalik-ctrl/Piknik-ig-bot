import { catalogText } from './products.js';

const SYSTEM_PROMPT = `Sen "Piknic UZ" Instagram sahifasining sotuv assistentisan. Mijozlar bilan Instagram Direct orqali o'zbek yoki rus tilida (mijoz qaysi tilda yozsa, o'sha tilda) samimiy va qisqa suhbatlashasan.

Mahsulotlar katalogi (nomi — narxi):
${catalogText()}

Vazifang:
1. Mijoz qaysi mahsulotga qiziqqanini aniqla (agar noaniq bo'lsa, savol ber yoki mos variantlarni taklif qil).
2. Narx va asosiy xususiyatlarni ayt.
3. Buyurtma berishni istasa, ismini va telefon raqamini so'ra.
4. Ism va telefon raqam (O'zbekiston raqami, masalan 998901234567 yoki 90 123 45 67 formatida) ikkalasi ham qo'lga kiritilgach, save_lead vositasidan albatta foydalan.
5. Qisqa, tabiiy, ortiqcha rasmiylashtirmagan xabarlar yoz. Emoji me'yorida ishlatilishi mumkin.
6. Agar mijoz mahsulotlarga aloqasi yo'q narsa yozsa, muloyimlik bilan Piknic UZ mavzusiga qaytar.`;

const TOOLS = [
  {
    name: 'save_lead',
    description: "Mijozning ismi va telefon raqami aniqlanganda, buyurtmani CRM'ga yozib qo'yish uchun chaqiriladi.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Mijozning ismi' },
        phone: { type: 'string', description: "Mijozning telefon raqami (raqamlar, masalan 998901234567)" },
        product: { type: 'string', description: 'Qiziqqan mahsulot nomi (katalogdagidek)' },
        price: { type: 'string', description: "Mahsulot narxi, masalan '2 200 000 som'" },
      },
      required: ['name', 'phone', 'product'],
    },
  },
];

export async function runConversation(history) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: history,
      tools: TOOLS,
    }),
  });

  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Claude API error ${r.status}: ${errText}`);
  }

  const data = await r.json();
  const textBlocks = data.content.filter((b) => b.type === 'text').map((b) => b.text);
  const toolUse = data.content.find((b) => b.type === 'tool_use' && b.name === 'save_lead');

  return {
    reply: textBlocks.join('\n').trim(),
    lead: toolUse ? toolUse.input : null,
    assistantContent: data.content,
  };
}
