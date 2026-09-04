import "server-only"

import ExcelJS from "exceljs"

/**
 * Streamed XLSX responses.
 *
 * Extracted so every export in the application streams the same way: rows are
 * written to the workbook as they arrive from the resolver and flushed to the
 * response, so a 200-row export and a 40 000-row export cost the same memory.
 *
 * Nothing here knows what a contract or an employee is. Callers pass columns
 * and an async generator of plain records; the scope has already been applied
 * by the resolver that produced them.
 */

export type XlsxColumn = {
  header: string
  key: string
  width?: number
}

export type XlsxCell = string | number | boolean | Date | null

export function streamXlsx({
  sheetName,
  fileName,
  columns,
  rows,
}: {
  sheetName: string
  /** Without extension; the date and `.xlsx` are appended. */
  fileName: string
  columns: XlsxColumn[]
  rows: () => AsyncGenerator<Record<string, XlsxCell>>
}): Response {
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()

  // ExcelJS writes to a Node-style sink; this adapts it to a web stream.
  const sink = {
    write(chunk: Uint8Array, _encoding: unknown, callback: () => void) {
      void writer.write(chunk).then(callback, callback)
      return true
    },
    end(callback?: () => void) {
      void writer.close().then(
        () => callback?.(),
        () => callback?.()
      )
    },
    on() {},
    once() {},
    emit() {},
    removeListener() {},
  }

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ExcelJS types its sink as a Node stream; this is the documented adapter shape.
    stream: sink as any,
    useStyles: true,
  })

  // The streaming writer exposes `views` as a getter only, so the frozen header
  // row has to be declared when the sheet is created.
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  })
  sheet.columns = columns
  sheet.getRow(1).font = { bold: true }

  void (async () => {
    try {
      for await (const row of rows()) {
        sheet.addRow(row).commit()
      }
      await workbook.commit()
    } catch (error) {
      console.error(`XLSX export failed (${sheetName})`, error)
      await writer.abort(error)
    }
  })()

  const stamp = new Date().toISOString().slice(0, 10)

  return new Response(stream.readable, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  })
}
