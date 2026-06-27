"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { switchActiveThesis } from "../../db/repository";
import { ingestThesis, IngestQualityError, type IngestInput } from "../../lib/ingest";
import { parseImportForm } from "../../lib/import/parse";
import { appContext } from "../../lib/server/context";

export type ImportState = { error: string | null };

const MAX_PDF_BYTES = 15 * 1024 * 1024; // intentionally below the 20 MB Server Action limit for multipart headroom

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function importThesisAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  let input: IngestInput;

  try {
    const title = formData.get("title");
    const sourceKind = formData.get("sourceKind");
    const content = formData.get("content");
    let pdfData: Uint8Array | undefined;
    const file = formData.get("file");

    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_PDF_BYTES) throw new Error("PDF is too large (max 15 MB). Try pasting the text instead.");
      if (file.type && file.type !== "application/pdf") throw new Error("Please upload a PDF file.");
      pdfData = new Uint8Array(await file.arrayBuffer());
    }

    input = parseImportForm({
      title: String(title ?? ""),
      sourceKind: String(sourceKind ?? ""),
      content: String(content ?? ""),
      data: pdfData,
    });
  } catch (error) {
    return { error: messageFor(error) };
  }

  try {
    const { db } = await appContext();
    await ingestThesis(db, input);
  } catch (error) {
    if (error instanceof IngestQualityError) {
      return {
        error:
          "Quality check failed: " +
          error.report.paragraphs +
          " paragraphs, " +
          error.report.chars +
          " chars",
      };
    }
    console.error("[importThesisAction] ingest failed:", error);
    return { error: "Could not import the thesis. Please try again." };
  }

  revalidatePath("/");
  redirect("/");
}

export async function switchThesisAction(formData: FormData): Promise<never> {
  const { db } = await appContext();
  const id = formData.get("thesisId") as string | null;
  try {
    if (id) switchActiveThesis(db, id);
  } catch {}
  revalidatePath("/", "layout");
  redirect("/library");
}
