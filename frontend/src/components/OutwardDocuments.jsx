import { useRef, useState } from "react";
import { Download, Trash2, Upload, FileText, Loader2, Plus, RefreshCw } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { toast, promptName } from "./CenterMessage";
import {
  uploadOutwardDocument,
  downloadOutwardDocument,
  deleteOutwardDocument,
  selectOutwardDocActionStatus,
  selectOutwardUploadingDocs,
} from "../features/outward/outwardSlice";
import { REQUIRED_DOCUMENTS, docLabel } from "../features/outward/outwardHelpers";
import { compressImage } from "../features/shared/compressImage";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const sameCategory = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/**
 * Documents section used on the outward detail page AND the dispatch page,
 * so it looks and works the same everywhere.
 *
 *   canManage = true  -> Add document, Upload, Replace, Delete, Download
 *   canManage = false -> Download only (uploaded documents only)
 *
 *   deferred = true   -> before dispatch: picked files are only kept in the page
 *                        (stagedFiles / onStagedChange) and are sent together with the dispatch details.
 */
export default function OutwardDocuments({
  outwardId,
  documents = [],
  canManage = false,
  deferred = false,
  stagedFiles = [],
  onStagedChange,
  // Which rows always show (uploaded or not), and what the "Add document" menu offers.
  requiredDocuments = REQUIRED_DOCUMENTS,
  // Rows that show (uploaded or not) but never have to be uploaded - "Not uploaded" is shown in grey.
  optionalDocuments = [],
  addMenuTypes = [...REQUIRED_DOCUMENTS, "Other"],
  // "Other" documents get this prefix in their stored name (Account uses it to tell its documents apart).
  otherPrefix = "",
  // Rows for which this user may not replace / delete (e.g. the manager looking at Account's invoice).
  isLocked = () => false,
  title = "Documents",
  subtitle,
  showSummary = true,
}) {
  const dispatch = useDispatch();
  const docActionStatus = useSelector(selectOutwardDocActionStatus);
  const uploadingDocs = useSelector(selectOutwardUploadingDocs);

  const [showDocumentMenu, setShowDocumentMenu] = useState(false);
  const pendingCategoryRef = useRef(null);
  const stagedRef = useRef(stagedFiles);
  stagedRef.current = stagedFiles;
  const addDocInputRef = useRef(null);

  const validFile = (file, event) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Only PDF, JPG, PNG and WEBP files are allowed.");
      event.target.value = "";
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Maximum file size is 10 MB.");
      event.target.value = "";
      return false;
    }
    return true;
  };

  // Deferred mode: remember the file (replacing any earlier pick for the same row) instead of uploading it.
  // Photos are shrunk first, so the final save uploads a fraction of the data.
  const stageFile = async (docCategory, file) => {
    const small = await compressImage(file);
    const next = [
      ...stagedRef.current.filter((f) => !sameCategory(f.docCategory, docCategory)),
      { id: crypto.randomUUID(), docCategory, file: small },
    ];
    onStagedChange?.(next);
  };
  const unstageFile = (docCategory) => onStagedChange?.(stagedFiles.filter((f) => !sameCategory(f.docCategory, docCategory)));

  const handleUpload = (event, docCategory) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!validFile(file, event)) return;

    if (deferred) {
      stageFile(docCategory, file);
      event.target.value = "";
      return;
    }

    dispatch(uploadOutwardDocument({ outwardId, file, docCategory })).then((result) => {
      if (uploadOutwardDocument.fulfilled.match(result)) {
        toast.success(`${docCategory} uploaded successfully.`);
      } else {
        toast.error(result.payload?.message || "Upload failed.");
      }
    });
    event.target.value = "";
  };

  // Replace = upload the new file first, then remove the old one, so a failed
  // upload never leaves the row empty.
  const handleReplace = (event, docCategory, oldDocument) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!validFile(file, event)) return;

    if (deferred) {
      stageFile(docCategory, file);
      event.target.value = "";
      return;
    }

    dispatch(uploadOutwardDocument({ outwardId, file, docCategory })).then(async (result) => {
      if (!uploadOutwardDocument.fulfilled.match(result)) {
        toast.error(result.payload?.message || "Upload failed.");
        return;
      }
      const removed = await dispatch(deleteOutwardDocument({ documentId: oldDocument.id }));
      if (deleteOutwardDocument.fulfilled.match(removed)) {
        toast.success(`${docCategory} replaced successfully.`);
      } else {
        toast.error("New file uploaded, but the old one could not be removed. Please delete it manually.");
      }
    });
    event.target.value = "";
  };

  // Add document menu: pick one of the three known types (to attach another
  // copy) or "Other" for a custom-named document.
  const handleAddDocumentClick = async (type) => {
    setShowDocumentMenu(false);

    let label = type;
    if (type === "Other") {
      const name = await promptName("Name this document", { label: "Document name", placeholder: "e.g. GST certificate" });
      if (!name?.trim()) return;
      label = `${otherPrefix}${name.trim()}`;
    }

    const existingCount = [...documents, ...stagedFiles].filter((doc) =>
      String(doc.docCategory || "").trim().toLowerCase().startsWith(label.toLowerCase())
    ).length;

    pendingCategoryRef.current = existingCount > 0 ? `${label} #${existingCount + 1}` : label;
    addDocInputRef.current?.click();
  };

  const handlePendingUpload = (event) => {
    const category = pendingCategoryRef.current;
    if (!category) return;
    handleUpload(event, category);
  };

  const handleDownload = (documentId) => {
    if (!documentId) return toast.error("Document ID is missing.");
    dispatch(downloadOutwardDocument({ documentId })).then((result) => {
      if (downloadOutwardDocument.rejected.match(result)) {
        toast.error(result.payload?.message || "Unable to download file.");
      }
    });
  };

  const handleDelete = (documentId) => {
    if (!documentId) return toast.error("Document ID is missing.");
    if (!window.confirm("Are you sure you want to delete this document?")) return;

    dispatch(deleteOutwardDocument({ documentId })).then((result) => {
      if (deleteOutwardDocument.fulfilled.match(result)) {
        toast.success("Document deleted successfully.");
      } else {
        toast.error(result.payload?.message || "Delete failed.");
      }
    });
  };

  // Required types always show first (uploaded or not), then extra copies / custom ones.
  const slotLabels = [
    ...requiredDocuments,
    ...optionalDocuments.filter((label) => !requiredDocuments.some((r) => sameCategory(r, label))),
  ];
  const requiredLower = slotLabels.map((label) => label.toLowerCase());
  const extraDocuments = documents.filter(
    (doc) => !requiredLower.includes(String(doc.docCategory || "").trim().toLowerCase())
  );
  const stagedFor = (label) => stagedFiles.find((f) => sameCategory(f.docCategory, label));
  const extraStaged = stagedFiles.filter((f) => !requiredLower.includes(String(f.docCategory || "").trim().toLowerCase()));
  const documentRows = [
    ...slotLabels.map((label) => ({
      key: label,
      label,
      document: documents.find((doc) => sameCategory(doc.docCategory, label)),
      staged: stagedFor(label),
      required: requiredDocuments.some((r) => sameCategory(r, label)),
      slot: true,
    })),
    ...extraDocuments.map((doc) => ({
      key: doc.id,
      label: doc.docCategory || "Document",
      document: doc,
      staged: stagedFor(doc.docCategory),
      required: false,
    })),
    ...extraStaged
      .filter((f) => !extraDocuments.some((doc) => sameCategory(doc.docCategory, f.docCategory)))
      .map((f) => ({ key: `staged-${f.id}`, label: f.docCategory, document: undefined, staged: f, required: false })),
  ];

  const uploadedCategories = [...documents, ...stagedFiles].map((doc) => String(doc.docCategory || "").trim().toLowerCase());
  const allUploaded = requiredDocuments.every((label) => {
    const required = label.toLowerCase();
    return uploadedCategories.some((v) => v === required || v.startsWith(`${required} #`) || v.startsWith(`${required} `));
  });

  const rows = canManage ? documentRows : documentRows.filter((row) => row.document);

  return (
    <div className="bg-white rounded-xl border p-4 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3 sm:mb-5 sm:gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900 sm:text-lg">{title}</h2>
          <p className="text-[11px] text-gray-500 mt-0.5 sm:text-sm sm:mt-1">
            {subtitle || (canManage ? "Upload, download, replace or delete required documents" : "Dispatch documents")}
          </p>
        </div>

        {canManage && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowDocumentMenu((v) => !v)}
              className="flex items-center gap-1 rounded-lg bg-black px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-gray-800 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs"
            >
              <Plus size={14} /> Add document
            </button>

            {showDocumentMenu && (
              <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                {addMenuTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleAddDocumentClick(type)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <FileText size={16} className="text-gray-400" />
                    {docLabel(type)}
                  </button>
                ))}
              </div>
            )}

            {/* Hidden input driven by the menu above; the chosen category is
                kept in a ref so it is never a stale closure value. */}
            <input
              ref={addDocInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={handlePendingUpload}
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed py-6 text-center text-sm text-gray-500">No documents uploaded yet.</p>
        )}
        {rows.map(({ label, document, required, slot, key, staged }) => {
          const isUploadingThis = uploadingDocs[label] === true;
          const isDownloading = document && docActionStatus[document.id] === "downloading";
          const isDeleting = document && docActionStatus[document.id] === "deleting";
          const busy = isUploadingThis || isDownloading || isDeleting;

          return (
            <div key={key} className="border rounded-xl p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                <div className="flex items-center gap-2.5 min-w-0 sm:gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 sm:w-10 sm:h-10 ${
                      document || staged ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    <FileText size={18} className="sm:hidden" />
                    <FileText size={20} className="hidden sm:block" />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 sm:text-base">{docLabel(label)}</p>
                    {document && staged && (
                      <p className="text-[11px] text-amber-600 truncate mt-1 sm:text-xs">
                        New file: {staged.file.name} {" • "} replaces this one
                      </p>
                    )}
                    {document ? (
                      <p className="text-[11px] text-gray-500 truncate mt-1 sm:text-xs">
                        {document.fileName || (document.fileKey ? String(document.fileKey).split("/").pop() : "Document")} {" • "} {document.fileType || "File"} {" • "}
                        {(Number(document.fileSize || 0) / 1024).toFixed(1)} {" KB"}
                      </p>
                    ) : staged ? (
                      <p className="text-[11px] text-amber-600 truncate mt-1 sm:text-xs">
                        {staged.file.name} {" • "} {(staged.file.size / 1024).toFixed(1)} {" KB"}
                      </p>
                    ) : (
                      <p className={`text-[11px] mt-1 sm:text-xs ${required ? "text-red-500" : "text-gray-400"}`}>Not uploaded</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {document ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDownload(document.id)}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border hover:bg-gray-50 disabled:opacity-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
                        title="Download"
                      >
                        {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        <span className="hidden sm:inline">Download</span>
                      </button>

                      {canManage && !isLocked(document.docCategory) && (
                        <>
                          <label
                            className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border hover:bg-gray-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${
                              busy ? "opacity-50 pointer-events-none" : ""
                            }`}
                            title="Replace"
                          >
                            {isUploadingThis ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                            <span className="hidden sm:inline">Replace</span>
                            <input
                              type="file"
                              className="hidden"
                              accept=".pdf,.jpg,.jpeg,.png,.webp"
                              onChange={(event) => handleReplace(event, label, document)}
                              disabled={busy}
                            />
                          </label>

                          <button
                            type="button"
                            onClick={() => handleDelete(document.id)}
                            disabled={busy}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
                            title="Delete"
                          >
                            {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            <span className="hidden sm:inline">Delete</span>
                          </button>
                        </>
                      )}
                    </>
                  ) : staged && canManage ? (
                    <>
                      <label className="cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border hover:bg-gray-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm" title="Replace">
                        <RefreshCw size={16} />
                        <span className="hidden sm:inline">Replace</span>
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => handleUpload(event, label)} />
                      </label>
                      <button
                        type="button"
                        onClick={() => unstageFile(label)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
                        title="Remove"
                      >
                        <Trash2 size={16} />
                        <span className="hidden sm:inline">Remove</span>
                      </button>
                    </>
                  ) : slot && canManage ? (
                    <label
                      className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-black text-white hover:bg-gray-800 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${
                        isUploadingThis ? "opacity-50 pointer-events-none" : ""
                      }`}
                    >
                      {isUploadingThis ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                      <span>Upload</span>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onChange={(event) => handleUpload(event, label)}
                        disabled={isUploadingThis}
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {canManage && showSummary && (
        <div className="mt-5 pt-4 border-t">
          {allUploaded ? (
            <div className="flex items-center gap-2 text-green-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              All required documents uploaded
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Some required documents are still pending
            </div>
          )}
        </div>
      )}
    </div>
  );
}
