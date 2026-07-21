# Operação mínima de privacidade — piloto

Este procedimento operacionaliza a Política de Privacidade do Prestou durante o piloto. O canal de entrada é `privacidade@prestou.com.br`.

## Retenção de comprovantes

- Comprovantes de cobranças abertas ou em validação permanecem no bucket privado `receipts`.
- Comprovantes de cobranças pagas são eliminados 90 dias depois de `paid_at`.
- Execute diariamente `POST /api/internal/run-receipt-retention` com `Authorization: Bearer <CRON_SECRET>`.
- A rotina remove o arquivo pela API do Supabase Storage e depois limpa `payments.comprovante_path`. Não apague registros diretamente de `storage.objects`, pois isso deixa arquivos órfãos.
- Registre e investigue qualquer resposta diferente de `2xx`. O retorno informa quantos comprovantes foram examinados e eliminados.

## Solicitações de titulares

1. Registre a data, o pedido e os dados mínimos fornecidos. Nunca peça o comprovante por e-mail.
2. Confirme a identidade antes de responder:
   - prestador: solicitação enviada pelo e-mail da conta;
   - cliente: nome, WhatsApp e identificação da cobrança ou do prestador.
3. Localize somente os dados relacionados ao titular e responda pelo mesmo canal verificado.
4. Meta operacional: concluir em até 15 dias. Se algum dado precisar ser preservado por obrigação aplicável, documente o motivo e elimine o restante.

## Exclusão manual

Antes de apagar registros do banco, liste todos os `comprovante_path` relacionados ao titular e remova cada arquivo pela API de Storage. A exclusão SQL não remove o objeto físico.

### Cliente final

1. Localize o cliente pelo prestador e pelo WhatsApp, evitando homônimos.
2. Liste as cobranças, pagamentos, notificações e caminhos dos comprovantes relacionados.
3. Remova os comprovantes pela API de Storage.
4. Exclua as `notifications` ligadas aos pagamentos antes de excluir o cliente. Essa relação usa `ON DELETE SET NULL` e o corpo da notificação pode conter nome e dados da cobrança.
5. Exclua o registro de `clients`; as cobranças, pagamentos, transições e eventos relacionados são removidos pelas chaves estrangeiras em cascata.
6. Confirme que não restaram linhas ou objetos relacionados e registre a conclusão do pedido sem copiar os dados eliminados.

### Conta do prestador

1. Exporte os dados primeiro se o titular também tiver solicitado acesso ou portabilidade.
2. Liste e remova pela API de Storage todos os comprovantes cujo caminho começa pelo id do prestador.
3. Exclua o registro de `providers`; clientes, cobranças, pagamentos, transições, eventos e notificações relacionados são removidos em cascata.
4. Exclua o usuário correspondente no Supabase Auth e revogue as sessões ativas.
5. Confirme que não restaram linhas, objetos ou acesso à conta.

Toda exclusão é irreversível. Uma segunda pessoa deve conferir a identidade e os identificadores antes da execução no ambiente de produção.
