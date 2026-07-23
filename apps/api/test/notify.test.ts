import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.DATABASE_SSL = "false";
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const { buildWhatsAppTemplatePayload } = await import("../src/notify.ts");

test("monta template de pagamento confirmado com três campos e botão de URL", () => {
  const payload = buildWhatsAppTemplatePayload({
    to: "5511988887777",
    name: "pagamento_confirmado_cliente",
    language: "pt_BR",
    bodyParams: ["Maria Cliente", "R$ 150,00", "Serviço de pintura"],
    urlButtonParam: "charge-123",
  });

  assert.deepEqual(payload, {
    messaging_product: "whatsapp",
    to: "5511988887777",
    type: "template",
    template: {
      name: "pagamento_confirmado_cliente",
      language: { code: "pt_BR" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Maria Cliente" },
            { type: "text", text: "R$ 150,00" },
            { type: "text", text: "Serviço de pintura" },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: "charge-123" }],
        },
      ],
    },
  });
});

test("mantém templates sem botão compatíveis", () => {
  const payload = buildWhatsAppTemplatePayload({
    to: "5511988887777",
    name: "lembrete_cobranca_prestador",
    language: "pt_BR",
    bodyParams: ["Maria Cliente", "R$ 150,00", "vence hoje"],
  });

  assert.equal(payload.template.components?.length, 1);
  assert.equal(payload.template.components?.[0]?.type, "body");
});
