-- A entrega do link deixa de ser inferida. Antes, o token era gravado antes de
-- chamar a Meta: um envio que falhasse (ou uma queda entre o commit e a chamada)
-- deixava um token vivo indistinguível de um entregue, e o gate anti-spam
-- silenciava o número até o token expirar. Com a marca explícita, token não
-- entregue é rotacionado na mensagem seguinte, sem depender de compensação.
alter table private.whatsapp_onboarding_tokens
  add column delivered_at timestamptz;

-- Linhas anteriores vêm do fluxo antigo, em que só existia token depois de um
-- envio bem-sucedido. Todas já estão expiradas, então a marca é apenas para não
-- deixar histórico ambíguo em consultas de funil.
update private.whatsapp_onboarding_tokens
   set delivered_at = created_at
 where delivered_at is null;

-- O gate de reenvio consulta token vivo e entregue por sessão.
create index idx_whatsapp_onboarding_tokens_delivered
  on private.whatsapp_onboarding_tokens (session_id, expires_at)
  where consumed_at is null and delivered_at is not null;
