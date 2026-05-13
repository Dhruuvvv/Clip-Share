import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { 
  useCreateClip, 
  getListClipsQueryKey, 
  getGetClipSummaryQueryKey,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePassphrase } from "@/contexts/passphrase-context";
import { encryptText } from "@/lib/crypto";
import { isUrl } from "@/lib/utils";
import { Loader2, Share2, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Types for the incoming shared data from IDB
interface SharedData {
  title?: string | null;
  text?: string | null;
  url?: string | null;
  files?: File[];
  receivedAt: number;
}

export default function ShareHandler() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { cryptoKey } = usePassphrase();
  const createClip = useCreateClip();
  const [status, setStatus] = useState<"loading" | "processing" | "success" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  
  // Ref to prevent double processing in React strict mode or race conditions
  const processingRef = useRef(false);

  const finishShare = useCallback((message: string) => {
    setStatus("success");
    toast({ description: message, duration: 3000 });
    queryClient.invalidateQueries({ queryKey: getListClipsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetClipSummaryQueryKey() });
    setTimeout(() => setLocation("/"), 1500);
  }, [setLocation, toast, queryClient]);

  const handleError = useCallback((msg: string) => {
    setStatus("error");
    setError(msg);
    toast({ title: "Share Error", description: msg, variant: "destructive" });
    setTimeout(() => setLocation("/"), 3000);
  }, [setLocation, toast]);

  const { uploadFile } = useUpload({
    onSuccess: (response: any) => {
      // Handled via the promise return in uploadFile
    },
    onError: (err: Error) => handleError(err.message || "Failed to upload file."),
  });

  useEffect(() => {
    async function processShare() {
      // 1. Safety Checks
      if (!cryptoKey) {
        console.log("[ShareHandler] Waiting for cryptoKey...");
        return;
      }
      
      if (processingRef.current) {
        console.log("[ShareHandler] Already processing, skipping duplicate call.");
        return;
      }

      console.log("[ShareHandler] Starting share processing...");
      processingRef.current = true;
      setStatus("processing");

      try {
        const params = new URLSearchParams(window.location.search);
        const title = params.get("title");
        const text = params.get("text");
        const url = params.get("url");
        const isFromServiceWorker = params.get("received") === "true";

        // 2. Handle URL parameters (Legacy/Direct mode)
        // Only use URL params if NOT coming from the service worker interceptor
        const sharedText = text || url || title;
        if (sharedText && !isFromServiceWorker) {
          console.log("[ShareHandler] Processing direct URL share:", { type: isUrl(sharedText) ? "link" : "text" });
          const type = isUrl(sharedText) ? "link" : "text";
          const { ciphertext, iv } = await encryptText(sharedText, cryptoKey);
          
          createClip.mutate(
            { data: { content: ciphertext, type, iv, encrypted: true } },
            {
              onSuccess: () => finishShare("Content saved to clipboard!"),
              onError: () => handleError("Failed to save shared content."),
            }
          );
          return;
        }

        // 3. Handle Service Worker Data (IndexedDB mode)
        console.log("[ShareHandler] Checking IndexedDB for shared data...");
        const dbRequest = indexedDB.open('clipshare-share-db', 1);
        
        dbRequest.onsuccess = async () => {
          const db = dbRequest.result;
          if (!db.objectStoreNames.contains('incoming')) {
            console.warn("[ShareHandler] No 'incoming' object store found.");
            handleError("No shared content found.");
            return;
          }

          const tx = db.transaction('incoming', 'readwrite');
          const store = tx.objectStore('incoming');
          const getRequest = store.get('latest');

          getRequest.onsuccess = async () => {
            const data = getRequest.result as SharedData | undefined;
            if (!data) {
              console.log("[ShareHandler] No shared data found in IDB (likely already processed).");
              // If we are on /share?received=true but no data is found, 
              // it means either it was already processed or something went wrong.
              // We'll redirect home if we've been here long enough without data.
              handleError("No shared content found in storage.");
              return;
            }

            // CRITICAL: Clear the data IMMEDIATELY to prevent double processing 
            // if another instance of the effect runs before we finish.
            store.delete('latest');
            console.log("[ShareHandler] Shared data retrieved and cleared from IDB.");

            // Handle files first if present
            if (data.files && data.files.length > 0) {
              console.log(`[ShareHandler] Processing ${data.files.length} shared file(s)...`);
              const file = data.files[0]; // For now, process the first file
              
              const response = await uploadFile(file);
              if (response) {
                createClip.mutate(
                  {
                    data: {
                      content: file.name,
                      type: "file",
                      fileName: file.name,
                      fileSize: file.size,
                      mimeType: file.type,
                      objectPath: response.objectPath,
                      resourceType: response.resourceType,
                    },
                  },
                  {
                    onSuccess: () => finishShare("File saved successfully!"),
                    onError: () => handleError("Failed to save file clip."),
                  }
                );
              }
              return;
            }

            // Handle text from IDB
            const idbText = data.text || data.url || data.title;
            if (idbText) {
              console.log("[ShareHandler] Processing shared text from IDB.");
              const type = isUrl(idbText) ? "link" : "text";
              const { ciphertext, iv } = await encryptText(idbText, cryptoKey);
              createClip.mutate(
                { data: { content: ciphertext, type, iv, encrypted: true } },
                {
                  onSuccess: () => finishShare("Content saved to clipboard!"),
                  onError: () => handleError("Failed to save shared content."),
                }
              );
              return;
            }

            handleError("Shared content format not recognized.");
          };
          getRequest.onerror = () => handleError("Failed to read shared data.");
        };
        dbRequest.onerror = () => handleError("Failed to access share storage.");

      } catch (err) {
        console.error("[ShareHandler] Unexpected error:", err);
        handleError("An unexpected error occurred while processing share.");
      }
    }

    processShare();
  }, [cryptoKey, createClip, uploadFile, finishShare, handleError]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-card-border shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Share2 className="w-6 h-6 text-primary animate-pulse" />
          </div>
          <CardTitle className="text-xl">Receiving Shared Content</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6 py-6">
          {(status === "loading" || status === "processing") && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground animate-pulse">Processing and encrypting...</p>
            </div>
          )}
          
          {status === "success" && (
            <div className="flex flex-col items-center gap-3 text-emerald-500">
              <CheckCircle2 className="h-12 w-12" />
              <p className="font-medium">Saved to your ClipShare!</p>
              <p className="text-xs text-muted-foreground">Redirecting home...</p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 text-destructive">
              <AlertCircle className="h-12 w-12" />
              <p className="font-medium">Share failed</p>
              <p className="text-sm text-center opacity-80">{error}</p>
              <p className="text-xs text-muted-foreground mt-2">Redirecting home...</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
