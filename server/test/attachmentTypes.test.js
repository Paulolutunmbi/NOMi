const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAttachment } = require("../src/services/attachments/attachmentValidator");

const pad = (head, total = 64) => Buffer.concat([head, Buffer.alloc(Math.max(0, total - head.length), 0x20)]);
const pdf = pad(Buffer.from("%PDF-1.7\n"));
const zipWith = (...names) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(names.join("\n"))]);
const mp4 = pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42")]));
const mov = pad(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  ")]));
const webm = pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
const ole = pad(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));

test("PDFs are accepted and stored as raw files", () => {
  const result = validateAttachment({ filename: "CV.pdf", mimeType: "application/pdf", data: pdf });
  assert.equal(result.valid, true);
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.kind, "raw");
});

test("Word, Excel and PowerPoint files are accepted when the package really is that format", () => {
  const docx = validateAttachment({ filename: "Report.docx", mimeType: "", data: zipWith("[Content_Types].xml", "word/document.xml") });
  assert.equal(docx.valid, true);
  assert.equal(docx.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(validateAttachment({ filename: "Sheet.xlsx", mimeType: "application/octet-stream", data: zipWith("[Content_Types].xml", "xl/workbook.xml") }).valid, true);
  assert.equal(validateAttachment({ filename: "Deck.pptx", mimeType: "", data: zipWith("[Content_Types].xml", "ppt/presentation.xml") }).valid, true);
  assert.equal(validateAttachment({ filename: "old.doc", mimeType: "application/msword", data: ole }).valid, true);
});

test("a zip renamed to .docx, or a plain zip, is rejected", () => {
  assert.equal(validateAttachment({ filename: "evil.docx", data: zipWith("payload.exe") }).valid, false);
  assert.equal(validateAttachment({ filename: "archive.zip", data: zipWith("[Content_Types].xml", "word/x") }).valid, false);
  assert.equal(validateAttachment({ filename: "wrong.xlsx", data: zipWith("[Content_Types].xml", "word/document.xml") }).valid, false);
});

test("short videos in MP4, MOV and WebM are accepted as video", () => {
  const a = validateAttachment({ filename: "clip.mp4", mimeType: "video/mp4", data: mp4 });
  const b = validateAttachment({ filename: "clip.mov", mimeType: "video/quicktime", data: mov });
  const c = validateAttachment({ filename: "clip.webm", mimeType: "video/webm", data: webm });
  for (const item of [a, b, c]) { assert.equal(item.valid, true); assert.equal(item.kind, "video"); }
});

test("a video larger than the 10MB limit is rejected", () => {
  const big = Buffer.concat([mp4, Buffer.alloc(10 * 1024 * 1024)]);
  const result = validateAttachment({ filename: "long.mp4", mimeType: "video/mp4", data: big });
  assert.equal(result.valid, false);
  assert.equal(result.code, "attachment_too_large");
});

test("text and CSV files are accepted only when they are genuinely text", () => {
  assert.equal(validateAttachment({ filename: "notes.txt", mimeType: "text/plain", data: Buffer.from("hello world, plain notes") }).valid, true);
  assert.equal(validateAttachment({ filename: "data.csv", mimeType: "application/vnd.ms-excel", data: Buffer.from("a,b,c\n1,2,3\n") }).valid, true);
  assert.equal(validateAttachment({ filename: "fake.txt", data: Buffer.concat([Buffer.from("MZ....binary"), Buffer.from([0, 1, 2, 3])]) }).valid, false);
});

test("scripts, executables and mislabelled files are rejected", () => {
  assert.equal(validateAttachment({ filename: "run.exe", data: pad(Buffer.from("MZ")) }).valid, false);
  assert.equal(validateAttachment({ filename: "x.sh", data: Buffer.from("#!/bin/sh\nrm -rf /\n") }).valid, false);
  assert.equal(validateAttachment({ filename: "photo.pdf", mimeType: "image/png", data: pdf }).code, "attachment_mime_mismatch");
});

test("filenames cannot break out of the MIME header", () => {
  const result = validateAttachment({ filename: 'a"b\r\nBcc: x@y.com.pdf', mimeType: "application/pdf", data: pdf });
  assert.equal(result.valid, true);
  assert.equal(/["\r\n]/.test(result.filename), false);
});
