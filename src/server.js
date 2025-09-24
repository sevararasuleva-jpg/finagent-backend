import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { validate } from "@telegram-apps/init-data-node";
import OpenAI from "openai";
import Airtable from "airtable";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const {
  BOT_TOKEN,
  OPENAI_API_KEY,
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
} = process.env;

const TABLE_LOANS = "Loans";
const TABLE_DEPOSITS = "Deposits";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const airtable = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(
  AIRTABLE_BASE_ID
);

app.post("/offers", async (req, res) => {
  try {
    const { type, amount, term_months, max_monthly, down_payment_percent } =
      req.body || {};

    let table = type === "loan" ? TABLE_LOANS : TABLE_DEPOSITS;

    const records = await airtable(table).select({ maxRecords: 50 }).all();

    const products = records.map((rec) => ({
      id: rec.id,
      ...rec.fields,
    }));

    let offers = [];
    if (type === "loan") {
      offers = products
        .filter((p) => p.apr_percent)
        .map((p) => {
          const principal = amount - (down_payment_percent || 0) * amount;
          const monthly = Math.round(
            (principal * (1 + p.apr_percent / 100)) / term_months
          );
          return { bank: p.bank, product: p.product_name, monthly };
        });
    } else {
      offers = products.map((p) => ({
        bank: p.bank,
        product: p.product_name,
        rate: p.apy_percent,
      }));
    }

    // Подключаем OpenAI для объяснения (опционально)
    let explanation = "";
    if (OPENAI_API_KEY) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Ты финансовый помощник для Узбекистана.",
          },
          {
            role: "user",
            content: `Сумма: ${amount}, срок: ${term_months}, лимит: ${max_monthly}.
            Вот варианты: ${JSON.stringify(offers.slice(0, 3))}.`,
          },
        ],
      });
      explanation = completion.choices[0].message.content;
    }

    res.json({ offers: offers.slice(0, 3), explanation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Backend запущен на порту ${PORT}`);
});
