# Text workspace documents

The Vue text workspace reuses the QXChat document intent helpers, plan schema and
isolated GenOffice engine. Enable **文档** per conversation to create or edit DOCX
and XLSX through the selected community text model and account group. Normal
questions remain normal chat; image and video workspaces do not show this plugin.

The web service needs `DOCUMENT_SERVICE_URL` (the private document-service URL)
and `DOCUMENT_SERVICE_SECRET` matching the existing document service. Never expose
the service port or secret to the browser. Files are scoped to the authenticated
New API account. Run only one document-service instance against a storage volume.

AI planning uses the existing generation and points pipeline. Saving a plan or
retrying file compilation does not submit another model request. Uploads, manual
edits, previews, versions and downloads use the private document API. A failed
model response may be recovered by querying the original request; incomplete or
invalid plans are never compiled. Delete keeps cancelled request keys to prevent
an old client from recreating the deleted file.

Limits inherited from the engine: 20 MiB per Office file, 20 sheets and 10,000
cells per plan. Unsupported active content, external data and formulas are
rejected. Preview shows document content and calculated cells; download to see
full Office layout. Successful files and versions remain until explicitly deleted.

Validation: `node --test server/documents.test.mjs`, the document intent/schema
unit tests, `tests/studio-documents.spec.ts`, and real engine/server integration
tests in this directory. Both community and document images build on the same
`main` commit in `.github/workflows/container.yml`.
