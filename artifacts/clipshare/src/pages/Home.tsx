import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2, Link as LinkIcon, FileText, Send, Paperclip, Download, Lock, LogOut, Pin } from "lucide-react";
import {
  useListClips,
  getListClipsQueryKey,
  useCreateClip,
  useDeleteClip,
  useUpdateClip,
  useGetClipSummary,
  getGetClipSummaryQueryKey
} from "@workspace/api-client-react";
import type { Clip } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { isUrl, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { usePassphrase } from "@/contexts/passphrase-context";
import { encryptText, decryptText } from "@/lib/crypto";

type DecryptedClip = Clip & { displayContent: string; decryptFailed?: boolean };

export default function Home() {
  const [input, setInput] = useState("");
  const [decryptedClips, setDecryptedClips] = useState<DecryptedClip[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { cryptoKey, lock } = usePassphrase();

  const formatFileSize = (bytes?: number | null) => {
    if (bytes === undefined || bytes === null) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (response) => {
      const file = fileInputRef.current?.files?.[0];
      if (!file) return;

      createClip.mutate({
        data: {
          content: file.name,
          type: "file",
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          objectPath: response.objectPath,
        }
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClipsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetClipSummaryQueryKey() });
          if (fileInputRef.current) fileInputRef.current.value = "";
          toast({ description: "File uploaded successfully", duration: 2000 });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to save clip.", variant: "destructive" });
        }
      });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Failed to upload file.", variant: "destructive" });
    }
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
  };

  const { data: clipsData, isLoading: isLoadingClips } = useListClips(
    { limit: 50 },
    { query: { refetchInterval: 2000, queryKey: getListClipsQueryKey({ limit: 50 }) } }
  );

  const { data: summaryData } = useGetClipSummary({
    query: { refetchInterval: 2000, queryKey: getGetClipSummaryQueryKey() }
  });

  const createClip = useCreateClip();
  const deleteClip = useDeleteClip();
  const updateClip = useUpdateClip();

  const decryptClips = useCallback(async (clips: Clip[]) => {
    if (!cryptoKey) return;

    const results: DecryptedClip[] = await Promise.all(
      clips.map(async (clip) => {
        if (!clip.encrypted || !clip.iv) {
          return { ...clip, displayContent: clip.content };
        }
        try {
          const displayContent = await decryptText(clip.content, clip.iv, cryptoKey);
          return { ...clip, displayContent };
        } catch {
          return { ...clip, displayContent: clip.content, decryptFailed: true };
        }
      })
    );

    setDecryptedClips(results);
  }, [cryptoKey]);

  useEffect(() => {
    if (clipsData?.items) {
      decryptClips(clipsData.items);
    }
  }, [clipsData, decryptClips]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !cryptoKey) return;

    const type = isUrl(input.trim()) ? "link" : "text";

    let content = input.trim();
    let iv: string | undefined;
    let encrypted = false;

    try {
      const result = await encryptText(content, cryptoKey);
      content = result.ciphertext;
      iv = result.iv;
      encrypted = true;
    } catch {
      toast({ title: "Error", description: "Encryption failed.", variant: "destructive" });
      return;
    }

    createClip.mutate({ data: { content, type, iv, encrypted } }, {
      onSuccess: () => {
        setInput("");
        queryClient.invalidateQueries({ queryKey: getListClipsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetClipSummaryQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to save clip.", variant: "destructive" });
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast({ description: "Copied to clipboard", duration: 2000 });
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  };

  const handleTogglePin = (id: number, currentlyPinned: boolean) => {
    setDecryptedClips((prev) => {
      const updated = prev.map((c) =>
        c.id === id ? { ...c, pinned: !currentlyPinned } : c
      );
      return [
        ...updated.filter((c) => c.pinned),
        ...updated.filter((c) => !c.pinned),
      ];
    });

    updateClip.mutate(
      { id, data: { pinned: !currentlyPinned } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClipsQueryKey() });
        },
        onError: () => {
          setDecryptedClips((prev) => {
            const reverted = prev.map((c) =>
              c.id === id ? { ...c, pinned: currentlyPinned } : c
            );
            return [
              ...reverted.filter((c) => c.pinned),
              ...reverted.filter((c) => !c.pinned),
            ];
          });
          toast({ title: "Error", description: "Failed to update pin.", variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    deleteClip.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClipsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetClipSummaryQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to delete clip.", variant: "destructive" });
      }
    });
  };

  const clips = decryptedClips;
  const totalClips = summaryData?.totalClips || 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12 flex flex-col gap-8">

        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">ClipShare</h1>
              <span
                className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full font-medium"
                title="End-to-end encrypted"
              >
                <Lock className="w-3 h-3" />
                Encrypted
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Your frictionless cross-device clipboard
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={lock}
              title="Lock ClipShare"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Input Area */}
        <section>
          <form onSubmit={handleSubmit} className="relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste a link or text here..."
              className="min-h-[120px] resize-none pb-12 bg-card border-card-border focus-visible:ring-primary shadow-sm text-base p-4"
              data-testid="input-clip-content"
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:inline-block">
                Press Enter to save
              </span>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
                accept="image/*,application/pdf,.docx,.xlsx"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || createClip.isPending}
                className="rounded-full shadow-sm hover-elevate"
              >
                {isUploading ? "Uploading..." : <Paperclip className="h-4 w-4" />}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!input.trim() || createClip.isPending || isUploading}
                className="rounded-full shadow-sm hover-elevate"
                data-testid="button-submit-clip"
              >
                {createClip.isPending ? "Saving..." : <><Send className="h-4 w-4 mr-2" /> Save</>}
              </Button>
            </div>
          </form>
        </section>

        {/* List Header */}
        <div className="flex items-center justify-between border-b border-border pb-4 mt-4">
          <h2 className="font-semibold text-lg">Your Clips</h2>
          <Badge variant="secondary" className="font-normal" data-testid="badge-clip-count">
            {totalClips} {totalClips === 1 ? 'clip' : 'clips'} stored
          </Badge>
        </div>

        {/* Clips List */}
        <section className="flex flex-col gap-4 pb-12">
          {isLoadingClips ? (
            <div className="text-center py-12 text-muted-foreground animate-pulse">
              Loading your clips...
            </div>
          ) : clips.length === 0 ? (
            <div className="text-center py-16 px-4 bg-secondary/30 rounded-xl border border-dashed border-border" data-testid="empty-state">
              <p className="text-muted-foreground">Your clipboard is empty.</p>
              <p className="text-sm text-muted-foreground/70 mt-2">
                Paste something above to get started. It will instantly appear here on all your devices.
              </p>
            </div>
          ) : (
            clips.map((clip) => (
              <Card key={clip.id} className={cn("group overflow-hidden transition-all duration-300 hover:shadow-md border-card-border", clip.pinned && "border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/20")} data-testid={`card-clip-${clip.id}`}>
                <CardContent className="p-0">
                  <div className="p-4 sm:p-5 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {clip.decryptFailed ? (
                          <div className="flex items-center gap-2">
                            <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
                            <p className="text-muted-foreground text-sm">
                              Locked — cannot decrypt with current passphrase
                            </p>
                          </div>
                        ) : clip.type === 'file' ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <p className="text-foreground font-medium break-words">
                                {clip.fileName || clip.displayContent}
                              </p>
                              {clip.fileSize && (
                                <span className="text-xs text-muted-foreground">
                                  ({formatFileSize(clip.fileSize)})
                                </span>
                              )}
                            </div>
                            {clip.mimeType?.startsWith('image/') && clip.objectPath && (
                              <img
                                src={`/api/storage${clip.objectPath}`}
                                className="max-h-24 w-auto rounded object-cover"
                                alt={clip.fileName || 'Image preview'}
                              />
                            )}
                          </div>
                        ) : clip.type === 'link' ? (
                          <a
                            href={clip.displayContent.startsWith('http') ? clip.displayContent : `https://${clip.displayContent}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline underline-offset-4 break-words line-clamp-3 leading-relaxed"
                          >
                            {clip.displayContent}
                          </a>
                        ) : (
                          <p className="text-foreground whitespace-pre-wrap break-words leading-relaxed text-sm sm:text-base">
                            {clip.displayContent}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn(
                          "text-xs font-normal border-transparent",
                          clip.type === 'file' ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" :
                          clip.type === 'link' ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" :
                          "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                        )}>
                          {clip.type === 'file' ? <Paperclip className="w-3 h-3 mr-1" /> :
                           clip.type === 'link' ? <LinkIcon className="w-3 h-3 mr-1" /> :
                           <FileText className="w-3 h-3 mr-1" />}
                          {clip.type === 'file' ? 'File' : clip.type === 'link' ? 'Link' : 'Text'}
                        </Badge>
                        {clip.encrypted && !clip.decryptFailed && (
                          <Lock className="w-3 h-3 text-emerald-500" title="End-to-end encrypted" />
                        )}
                      </div>

                      {clip.decryptFailed ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={lock}
                          className="h-7 text-xs gap-1.5 text-muted-foreground"
                        >
                          <Lock className="w-3 h-3" />
                          Re-enter passphrase
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleTogglePin(clip.id, clip.pinned)}
                            className={cn(
                              "h-8 w-8 transition-colors",
                              clip.pinned
                                ? "text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
                                : "text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950 sm:opacity-0 sm:group-hover:opacity-100"
                            )}
                            title={clip.pinned ? "Unpin" : "Pin to top"}
                            data-testid={`button-pin-${clip.id}`}
                          >
                            <Pin className={cn("h-4 w-4", clip.pinned && "fill-amber-500")} />
                          </Button>
                          {clip.type === 'file' && clip.objectPath && (
                            <a
                              href={`/api/storage${clip.objectPath}`}
                              download={clip.fileName || clip.displayContent}
                              className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8 text-muted-foreground"
                              title="Download file"
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          )}
                          {clip.type !== 'file' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleCopy(clip.displayContent)}
                              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary"
                              title="Copy to clipboard"
                              data-testid={`button-copy-${clip.id}`}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(clip.id)}
                            disabled={deleteClip.isPending && deleteClip.variables?.id === clip.id}
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title="Delete clip"
                            data-testid={`button-delete-${clip.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
