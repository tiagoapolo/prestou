export const INTERNAL_ERROR_MESSAGE =
  "Ocorreu um erro inesperado. Tente novamente em alguns instantes.";

export function publicErrorMessage(statusCode: number): string {
  if (statusCode === 401) return "Sua sessão expirou. Entre novamente para continuar.";
  if (statusCode === 403) return "Você não tem permissão para realizar esta ação.";
  if (statusCode === 404) return "O conteúdo solicitado não foi encontrado.";
  if (statusCode === 413) return "O arquivo é muito grande. Envie um arquivo de até 10 MB.";
  if (statusCode === 415) return "O formato do arquivo não é compatível.";
  if (statusCode === 429) return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  if (statusCode >= 500) return INTERNAL_ERROR_MESSAGE;
  return "Não foi possível processar a solicitação. Revise os dados e tente novamente.";
}
