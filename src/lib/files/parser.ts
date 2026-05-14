import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

/**
 * Extract text content from uploaded file based on MIME type.
 */
export async function extractFileContent(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string> {
  try {
    // PDF
    if (mimeType === "application/pdf") {
      const pdf = new PDFParse({ data: buffer });
      try {
        const result = await pdf.getText();
        if (!result.text?.trim()) {
          return `[PDF "${filename}" - nie udało się wyodrębnić tekstu. Plik może być zeskanowany lub zabezpieczony hasłem.]`;
        }
        return result.text.trim();
      } finally {
        await pdf.destroy();
      }
    }

    // DOCX
    if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      filename.endsWith(".docx")
    ) {
      const result = await mammoth.extractRawText({ buffer });
      if (!result.value?.trim()) {
        return `[DOCX "${filename}" - pusty dokument lub brak tekstu.]`;
      }
      return result.value.trim();
    }

    // XLSX
    if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel" ||
      filename.endsWith(".xlsx") ||
      filename.endsWith(".xls")
    ) {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const parts: string[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const csv = XLSX.utils.sheet_to_csv(sheet);
        if (csv.trim()) {
          parts.push(`--- Arkusz: ${sheetName} ---\n${csv.trim()}`);
        }
      }

      if (parts.length === 0) {
        return `[XLSX "${filename}" - pusty arkusz.]`;
      }
      return parts.join("\n\n");
    }

    // Images
    if (mimeType.startsWith("image/")) {
      return `[Obraz "${filename}" - typ: ${mimeType}. Analiza obrazu wymaga OCR, który nie jest dostępny w wersji MVP. Plik został zapisany.]`;
    }

    // Plain text / CSV
    if (
      mimeType === "text/plain" ||
      mimeType === "text/csv" ||
      filename.endsWith(".txt") ||
      filename.endsWith(".csv")
    ) {
      return buffer.toString("utf-8").trim() || `[Plik "${filename}" jest pusty.]`;
    }

    return `[Nieobsługiwany format pliku: ${mimeType}]`;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Nieznany błąd";
    return `[Błąd przetwarzania pliku "${filename}": ${message}]`;
  }
}
