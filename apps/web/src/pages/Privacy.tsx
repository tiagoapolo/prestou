import { Link } from "react-router-dom";

export function PrivacyPage() {
  return (
    <main className="legal-page">
      <article>
        <Link to="/" className="brand">prestou<span>.</span></Link>
        <p className="eyebrow">Privacidade</p>
        <h1>Como cuidamos dos seus dados</h1>
        <p>Última atualização: 21 de julho de 2026.</p>

        <h2>Quais dados usamos</h2>
        <p>Do prestador, usamos dados de identificação e contato, profissão, chave Pix e informações necessárias para manter a conta. Dos clientes, usamos somente nome e WhatsApp, além dos dados da cobrança. O comprovante é opcional e só pode ser consultado pelo prestador responsável.</p>

        <h2>Para que usamos</h2>
        <p>Usamos os dados para criar e acompanhar cobranças, gerar o Pix, preparar mensagens, enviar notificações ao prestador, proteger o acesso e medir se o piloto funciona. Não vendemos dados pessoais.</p>

        <h2>Com quem compartilhamos</h2>
        <p>Usamos fornecedores de infraestrutura estritamente para operar o serviço: Supabase para autenticação, banco e armazenamento; Railway para hospedar a aplicação; e Meta/WhatsApp para notificações quando essa integração estiver ativa.</p>

        <h2>Por quanto tempo guardamos</h2>
        <p>Comprovantes são apagados 90 dias depois que a cobrança é marcada como paga. Enquanto a cobrança estiver aberta ou em validação, o arquivo é mantido para cumprir sua finalidade. Os demais dados permanecem enquanto a conta estiver ativa ou pelo tempo necessário para atender obrigações aplicáveis.</p>

        <h2>Seus direitos</h2>
        <p>Você pode pedir confirmação do tratamento, acesso, correção ou exclusão dos seus dados. Quando houver obrigação legal de preservar alguma informação, explicaremos o motivo e eliminaremos o restante.</p>

        <h2>Como falar conosco</h2>
        <p>Envie sua solicitação para <a href="mailto:privacidade@prestou.com.br">privacidade@prestou.com.br</a>. Podemos pedir informações adicionais somente para confirmar sua identidade e localizar os dados corretos.</p>
      </article>
    </main>
  );
}
