import { crc16ccitt } from "./crc16.js";
import { parsePixKey, type PixKeyInfo } from "./validate.js";

const GUI = "br.gov.bcb.pix";

export interface PixPayloadInput {
  /** Chave Pix do recebedor (prestador). Aceita CPF, telefone, e-mail ou aleatória. */
  key: string;
  /** Valor em reais. Ex.: 150.07. Deve ser > 0. */
  amount: number;
  /** Nome do recebedor (prestador). Máx. 25 chars após normalização. */
  merchantName: string;
  /** Cidade do recebedor. Máx. 15 chars após normalização. */
  merchantCity?: string;
  /**
   * Identificador da transação (txid). Alfanumérico, até 25 chars.
   * Para Pix estático o padrão é "***" (sem txid específico).
   */
  txid?: string;
}

export interface PixPayloadResult {
  /** String "copia e cola" pronta para colar no app do banco. */
  brCode: string;
  keyInfo: PixKeyInfo;
}

/** Remove acentos/diacríticos e caracteres fora do ASCII imprimível. */
export function sanitizeText(value: string, maxLength: number): string {
  const stripped = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacriticos combinantes
    .replace(/[^\x20-\x7E]/g, "") // não-ASCII imprimível
    .trim()
    .toUpperCase();
  return stripped.slice(0, maxLength);
}

/** Formata um campo TLV: id (2) + tamanho (2, zero-padded) + valor. */
export function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, "0");
  if (value.length > 99) {
    throw new Error(`Campo ${id} excede 99 caracteres (${value.length})`);
  }
  return `${id}${len}${value}`;
}

function formatAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Valor da cobrança deve ser maior que zero");
  }
  // Arredonda para 2 casas evitando erro de ponto flutuante (ex.: 0.1+0.2).
  const cents = Math.round(amount * 100);
  return (cents / 100).toFixed(2);
}

function sanitizeTxid(txid: string | undefined): string {
  if (!txid || txid === "***") return "***";
  const clean = txid.replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  return clean.length > 0 ? clean : "***";
}

/**
 * Gera o BR Code (Pix Copia e Cola) estático com valor definido.
 * Segue o padrão EMV®/Bacen: campos TLV + CRC16 no final.
 */
export function generatePixBrCode(input: PixPayloadInput): PixPayloadResult {
  const keyInfo = parsePixKey(input.key);

  const merchantName = sanitizeText(input.merchantName, 25);
  if (!merchantName) throw new Error("Nome do recebedor inválido após normalização");
  const merchantCity = sanitizeText(input.merchantCity ?? "BRASIL", 15) || "BRASIL";
  const amount = formatAmount(input.amount);
  const txid = sanitizeTxid(input.txid);

  // Campo 26: Merchant Account Information (Pix)
  const merchantAccountInfo =
    tlv("00", GUI) + tlv("01", keyInfo.normalized);

  // Campo 62: Additional Data Field Template (txid em 05)
  const additionalData = tlv("05", txid);

  const payloadWithoutCrc =
    tlv("00", "01") + // Payload Format Indicator
    tlv("01", "11") + // Point of Initiation Method: 11 = estático/reutilizável
    tlv("26", merchantAccountInfo) +
    tlv("52", "0000") + // Merchant Category Code
    tlv("53", "986") + // Moeda: BRL
    tlv("54", amount) + // Valor
    tlv("58", "BR") + // País
    tlv("59", merchantName) +
    tlv("60", merchantCity) +
    tlv("62", additionalData) +
    "6304"; // ID + tamanho do CRC, valor entra depois

  const crc = crc16ccitt(payloadWithoutCrc);
  return { brCode: payloadWithoutCrc + crc, keyInfo };
}
