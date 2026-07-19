/**
 * CRC16-CCITT (FALSE) — polinômio 0x1021, valor inicial 0xFFFF.
 * É o CRC exigido pelo padrão de BR Code do Banco Central (campo 63).
 * Calculado sobre todo o payload já incluindo o identificador e o tamanho
 * do campo do CRC ("6304"), mas antes do valor do próprio CRC.
 */
export function crc16ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
