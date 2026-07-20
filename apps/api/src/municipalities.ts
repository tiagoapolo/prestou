export interface Municipality {
  name: string;
  state: string;
  ibgeCode: string;
}

interface IbgeMunicipality {
  "municipio-id"?: unknown;
  "municipio-nome"?: unknown;
  "UF-sigla"?: unknown;
}

const IBGE_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado&orderBy=nome";
let municipalityCache: Municipality[] | undefined;
let loadingMunicipalities: Promise<Municipality[]> | undefined;

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function parseIbgeMunicipalities(payload: unknown, minimumSize = 5_000): Municipality[] {
  if (!Array.isArray(payload)) throw new Error("Resposta inválida do IBGE");
  const municipalities = payload.flatMap((raw: IbgeMunicipality) => {
    const name = raw["municipio-nome"];
    const state = raw["UF-sigla"];
    const ibgeCode = String(raw["municipio-id"] ?? "");
    if (typeof name !== "string" || typeof state !== "string" || !/^\d{7}$/.test(ibgeCode)) return [];
    return [{ name, state, ibgeCode }];
  });
  if (municipalities.length < minimumSize) throw new Error("Lista de municípios incompleta");
  return municipalities;
}

export async function loadMunicipalities(): Promise<Municipality[]> {
  if (municipalityCache) return municipalityCache;
  if (!loadingMunicipalities) {
    loadingMunicipalities = fetch(IBGE_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`IBGE respondeu com status ${response.status}`);
      const municipalities = parseIbgeMunicipalities(await response.json());
      municipalityCache = municipalities;
      return municipalities;
    }).finally(() => { loadingMunicipalities = undefined; });
  }
  return loadingMunicipalities;
}

export function searchMunicipalities(query: string, municipalities: Municipality[], limit = 10): Municipality[] {
  const normalizedQuery = normalizeSearch(query.trim());
  if (normalizedQuery.length < 2) return [];
  const startsWith: Municipality[] = [];
  const includes: Municipality[] = [];
  for (const municipality of municipalities) {
    const normalizedName = normalizeSearch(municipality.name);
    if (normalizedName.startsWith(normalizedQuery)) startsWith.push(municipality);
    else if (normalizedName.includes(normalizedQuery)) includes.push(municipality);
  }
  return [...startsWith, ...includes].slice(0, limit);
}

export function municipalityExists(candidate: Municipality, municipalities: Municipality[]): boolean {
  return municipalities.some((municipality) => municipality.ibgeCode === candidate.ibgeCode
    && municipality.name === candidate.name
    && municipality.state === candidate.state);
}
