import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Erro de indisponibilidade do assistente. Mapeado para 502 na borda HTTP: a
 * falha é do provedor de LLM, não do cliente.
 */
export class AssistantServiceError extends Error {
  statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = "AssistantServiceError";
  }
}

const openAiResponseSchema = z.object({
  output: z.array(z.object({
    type: z.string(),
    name: z.string().optional(),
    arguments: z.string().optional(),
  }).passthrough()),
}).passthrough();

/** Definição de uma ferramenta (function calling) exposta ao modelo. */
export interface LlmTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Ferramenta escolhida pelo modelo, com os argumentos já desserializados. */
export interface LlmToolCall {
  name: string;
  arguments: unknown;
}

export interface LlmInterpretRequest {
  apiKey: string;
  model: string;
  /** Identidade do prestador, usada apenas como `safety_identifier` (hash). */
  providerId: string;
  instructions: string;
  tools: LlmTool[];
  message: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Porta única para a OpenAI Responses API. Interpreta a intenção e extrai
 * argumentos; **nunca** recebe dados de cliente ou financeiros e **nunca**
 * executa ações — a API Fastify continua sendo a fonte da verdade.
 */
export interface LlmProvider {
  interpret(request: LlmInterpretRequest): Promise<LlmToolCall>;
}

async function interpret(request: LlmInterpretRequest): Promise<LlmToolCall> {
  const fetchImpl = request.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(request.timeoutMs ?? 15_000),
      body: JSON.stringify({
        model: request.model,
        store: false,
        parallel_tool_calls: false,
        tool_choice: "required",
        max_output_tokens: 300,
        reasoning: { effort: "low" },
        safety_identifier: createHash("sha256").update(request.providerId).digest("hex"),
        instructions: request.instructions,
        input: [{ role: "user", content: request.message }],
        tools: request.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          strict: true,
          parameters: tool.parameters,
        })),
      }),
    });
  } catch (error) {
    throw new AssistantServiceError(
      error instanceof Error && error.name === "TimeoutError"
        ? "O assistente demorou para responder"
        : "Não foi possível consultar o assistente",
    );
  }

  if (!response.ok) {
    throw new AssistantServiceError(`OpenAI respondeu com status ${response.status}`);
  }

  const payload = openAiResponseSchema.safeParse(await response.json());
  if (!payload.success) throw new AssistantServiceError("Resposta inválida do assistente");
  const call = payload.data.output.find((item) => item.type === "function_call");
  if (!call?.name || !call.arguments) {
    throw new AssistantServiceError("O assistente não escolheu uma ação");
  }

  let argumentsValue: unknown;
  try {
    argumentsValue = JSON.parse(call.arguments);
  } catch {
    throw new AssistantServiceError("Argumentos inválidos do assistente");
  }
  return { name: call.name, arguments: argumentsValue };
}

/** Adaptador padrão (OpenAI). Mantido atrás da interface para troca futura. */
export const openAiProvider: LlmProvider = { interpret };
