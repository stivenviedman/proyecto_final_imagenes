"use client";

import { useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";

export function DetectPdacLesion() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [images, setImages] = useState<{
    axial: string[];
    coronal: string[];
    sagittal: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [hasChanged, setHasChanged] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    const isDifferent =
      !lastUploadedFile ||
      selected.name !== lastUploadedFile.name ||
      selected.size !== lastUploadedFile.size;

    if (isDifferent) {
      setFile(selected);
      setHasChanged(true);
    } else {
      setHasChanged(false);
    }
  };

  const handleUpload = async () => {
    if (!file || uploading || !hasChanged) return;

    setUploading(true);
    setImages(null);
    setError(null);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: "application/gzip" }),
      });

      const { url, publicUrl } = await res.json();

      const uploadRes = await fetch(url, {
        method: "PUT",
        body: new File([file], file.name, { type: "application/gzip" }),
        headers: { "Content-Type": "application/gzip" },
      });

      if (!uploadRes.ok) throw new Error("Upload failed.");

      const segmentRes = await fetch("/api/segment-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: publicUrl }),
      });

      if (!segmentRes.ok) throw new Error("Segmentation failed.");

      const result = await segmentRes.json();

      if (result.detail === "Busy") {
        setIsBusy(true);
      } else {
        setImages(result);
        setLastUploadedFile(file);
        setHasChanged(false);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 mt-10 bg-white rounded-2xl shadow-lg border space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 text-center">
        PDAC Lesion Detector
      </h1>

      {!isBusy && (
        <>
          <div className="flex flex-col items-center space-y-4">
            <input
              type="file"
              accept=".gz"
              onChange={handleFileChange}
              disabled={uploading}
              className="text-sm text-gray-600"
            />

            <button
              onClick={handleUpload}
              disabled={!file || uploading || !hasChanged}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <UploadCloud className="w-5 h-5" />
                  Upload & Segment
                </>
              )}
            </button>

            {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
          </div>

          {uploading && (
            <div className="grid grid-cols-3 gap-4 animate-pulse mt-6">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="h-32 bg-gray-200 rounded-lg" />
              ))}
            </div>
          )}

          {images && (
            <div className="space-y-8">
              {["axial", "coronal", "sagittal"].map((view) => (
                <div key={view}>
                  <h2 className="text-xl font-semibold capitalize text-gray-700 mb-2">
                    {view} view
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {images[view as keyof typeof images].map((src, index) => (
                      <img
                        key={index}
                        src={src}
                        alt={`${view} slice`}
                        loading="lazy"
                        className="rounded-lg border shadow-sm hover:scale-105 transition-transform"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {isBusy && (
        <p>App is currently processing other image, please wait and reload</p>
      )}
    </div>
  );
}
