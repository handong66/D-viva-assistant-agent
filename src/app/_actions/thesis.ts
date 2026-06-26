"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ingestThesis, IngestQualityError, type IngestInput } from "../../lib/ingest";
import { parseImportForm } from "../../lib/import/parse";
import { appContext } from "../../lib/server/context";

export type ImportState = { error: string | null };

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
    return { error: messageFor(error) };
  }

  revalidatePath("/");
  redirect("/");
}
