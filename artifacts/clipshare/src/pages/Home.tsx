import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Copy, Trash2, Link as LinkIcon, FileText, Send,
  Paperclip, Download, Lock, LogOut, Pin, GripVertical,
  Search, X,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useListClips,
  getListClipsQueryKey,
  useCreateClip,
  useDeleteClip,
  useUpdateClip,
  useGetClipSummary,
  getGetClipSummaryQueryKey,
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
import { Input } from "@/components/ui/input";
import { usePassphrase } from "@/contexts/passphrase-context";
import { encryptText, decryptText } from "@/lib/crypto";

type DecryptedClip = Clip & { displayContent: string; decryptFailed?: boolean };

const PINNED_ORDER_KEY = "clipshare_pinned_order";

function loadPinnedOrder(): number[] {
  try {
    const raw = localStorage.getItem(PINNED_ORDER_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

function savePinnedOrder(order: number[]) {
  localStorage.setItem(PINNED_ORDER_KEY, JSON.stringify(order));
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/60 text-foreground rounded-[2px] px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function matchesSearch(clip: DecryptedClip, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  if (clip.decryptFailed) return false;
  if (clip.displayContent?.toLowerCase().includes(q)) return true;
  if (clip.fileName?.toLowerCase().includes(q)) return true;
  return false;
}

function formatFileSize(bytes?: number | null) {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

interface ClipCardProps {
  clip: DecryptedClip;
  searchQuery: string;
  onCopy: (content: string) => void;
  onDelete: (id: number) => void;
  onTogglePin: (id: number, pinned: boolean) => void;
  onLock: () => void;
  deleteIsPending: boolean;
  dragHandle?: React.ReactNode;
}

function ClipCard({ clip, searchQuery, onCopy, onDelete, onTogglePin, onLock, deleteIsPending, dragHandle }: ClipCardProps) {
  return (
    <Card
      className={cn(
        "group overflow-hidden transition-all duration-200 hover:shadow-md border-card-border",
        clip.pinned && "border-amber-300 dark:border-amber-700"
      )}
      data-testid={`card-clip-${clip.id}`}
    >
      <CardContent className="p-0">
        <div className="p-4 sm:p-5 flex flex-col gap-3">
          <div className="flex items-start gap-2">
            {dragHandle}
            <div className="flex-1 min-w-0">
              {clip.decryptFailed ? (
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
                  <p className="text-muted-foreground text-sm">
                    Locked — cannot decrypt with current passphrase
                  </p>
                </div>
              ) : clip.type === "file" ? (
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
                  {clip.mimeType?.startsWith("image/") && clip.objectPath && (
                    <img
                      src={`/api/storage${clip.objectPath}`}
                      className="max-h-24 w-auto rounded object-cover"
                      alt={clip.fileName || "Image preview"}
                    />
                  )}
                </div>
              ) : clip.type === "link" ? (
                <a
                  href={clip.displayContent.startsWith("http") ? clip.displayContent : `https://${clip.displayContent}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline underline-offset-4 break-words line-clamp-3 leading-relaxed"
                >
                  {highlightText(clip.displayContent, searchQuery)}
                </a>
              ) : (
                <p className="text-foreground whitespace-pre-wrap break-words leading-relaxed text-sm sm:text-base">
                  {highlightText(clip.displayContent, searchQuery)}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-normal border-transparent",
                  clip.type === "file"
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    : clip.type === "link"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    : "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                )}
              >
                {clip.type === "file" ? (
                  <Paperclip className="w-3 h-3 mr-1" />
                ) : clip.type === "link" ? (
                  <LinkIcon className="w-3 h-3 mr-1" />
                ) : (
                  <FileText className="w-3 h-3 mr-1" />
                )}
                {clip.type === "file" ? "File" : clip.type === "link" ? "Link" : "Text"}
              </Badge>
              {clip.encrypted && !clip.decryptFailed && (
                <Lock className="w-3 h-3 text-emerald-500" />
              )}
            </div>

            {clip.decryptFailed ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onLock}
                className="h-7 text-xs gap-1.5 text-muted-foreground"
              >
                <Lock className="w-3 h-3" />
                Re-enter passphrase
              </Button>
            ) : (
              <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onTogglePin(clip.id, clip.pinned)}
                  className={cn(
                    "h-8 w-8 transition-colors",
                    clip.pinned
                      ? "text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950 !opacity-100"
                      : "text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950"
                  )}
                  title={clip.pinned ? "Unpin" : "Pin to top"}
                  data-testid={`button-pin-${clip.id}`}
                >
                  <Pin className={cn("h-4 w-4", clip.pinned && "fill-amber-500")} />
                </Button>
                {clip.type === "file" && clip.objectPath && (
                  <a
                    href={`/api/storage${clip.objectPath}`}
                    download={clip.fileName || clip.displayContent}
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8 text-muted-foreground"
                    title="Download file"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                )}
                {clip.type !== "file" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onCopy(clip.displayContent)}
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
                  onClick={() => onDelete(clip.id)}
                  disabled={deleteIsPending}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title={clip.pinned ? "Unpin before deleting" : "Delete clip"}
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
  );
}

function SortableClipCard(props: ClipCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.clip.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const dragHandle = (
    <button
      {...attributes}
      {...listeners}
      className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
      title="Drag to reorder"
      tabIndex={-1}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style}>
      <ClipCard {...props} dragHandle={dragHandle} />
    </div>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [decryptedClips, setDecryptedClips] = useState<DecryptedClip[]>([]);
  const [pinnedOrder, setPinnedOrder] = useState<number[]>(loadPinnedOrder);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { cryptoKey, lock } = usePassphrase();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (response: any) => {
      const file = fileInputRef.current?.files?.[0];
      if (!file) return;
      createClip.mutate(
        {
          data: {
            content: file.name,
            type: "file",
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            objectPath: response.objectPath,
          },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListClipsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetClipSummaryQueryKey() });
            if (fileInputRef.current) fileInputRef.current.value = "";
            toast({ description: "File uploaded successfully", duration: 2000 });
          },
          onError: () => toast({ title: "Error", description: "Failed to save clip.", variant: "destructive" }),
        }
      );
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: error.message || "Failed to upload file.", variant: "destructive" }),
  });

  const { data: clipsData, isLoading: isLoadingClips } = useListClips(
    { limit: 50 },
    { query: { refetchInterval: 2000, queryKey: getListClipsQueryKey({ limit: 50 }) } }
  );

  const { data: summaryData } = useGetClipSummary({
    query: { refetchInterval: 2000, queryKey: getGetClipSummaryQueryKey() },
  });

  const createClip = useCreateClip();
  const deleteClip = useDeleteClip();
  const updateClip = useUpdateClip();

  const decryptClips = useCallback(
    async (clips: Clip[]) => {
      if (!cryptoKey) return;
      const results: DecryptedClip[] = await Promise.all(
        clips.map(async (clip) => {
          if (!clip.encrypted || !clip.iv) return { ...clip, displayContent: clip.content };
          try {
            const displayContent = await decryptText(clip.content, clip.iv, cryptoKey);
            return { ...clip, displayContent };
          } catch {
            return { ...clip, displayContent: clip.content, decryptFailed: true };
          }
        })
      );
      setDecryptedClips(results);

      const incomingPinnedIds = results.filter((c) => c.pinned).map((c) => c.id);
      setPinnedOrder((prev) => {
        const existingValid = prev.filter((id) => incomingPinnedIds.includes(id));
        const newOnes = incomingPinnedIds.filter((id) => !existingValid.includes(id));
        const merged = [...existingValid, ...newOnes];
        savePinnedOrder(merged);
        return merged;
      });
    },
    [cryptoKey]
  );

  useEffect(() => {
    if (clipsData?.items) decryptClips(clipsData.items);
  }, [clipsData, decryptClips]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !cryptoKey) return;
    const type = isUrl(input.trim()) ? "link" : "text";
    let content = input.trim();
    let iv: string | undefined;
    try {
      const result = await encryptText(content, cryptoKey);
      content = result.ciphertext;
      iv = result.iv;
    } catch {
      toast({ title: "Error", description: "Encryption failed.", variant: "destructive" });
      return;
    }
    createClip.mutate(
      { data: { content, type, iv, encrypted: true } },
      {
        onSuccess: () => {
          setInput("");
          queryClient.invalidateQueries({ queryKey: getListClipsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetClipSummaryQueryKey() });
        },
        onError: () => toast({ title: "Error", description: "Failed to save clip.", variant: "destructive" }),
      }
    );
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
    setDecryptedClips((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !currentlyPinned } : c)));
    setPinnedOrder((prev) => {
      const next = currentlyPinned ? prev.filter((x) => x !== id) : [...prev, id];
      savePinnedOrder(next);
      return next;
    });
    updateClip.mutate(
      { id, data: { pinned: !currentlyPinned } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListClipsQueryKey() }),
        onError: () => {
          setDecryptedClips((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: currentlyPinned } : c)));
          setPinnedOrder((prev) => {
            const reverted = currentlyPinned ? [...prev, id] : prev.filter((x) => x !== id);
            savePinnedOrder(reverted);
            return reverted;
          });
          toast({ title: "Error", description: "Failed to update pin.", variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    const clip = decryptedClips.find((c) => c.id === id);
    if (clip?.pinned) {
      toast({
        title: "Cannot delete a pinned clip",
        description: "Unpin it first, then delete.",
        variant: "destructive",
      });
      return;
    }
    deleteClip.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClipsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetClipSummaryQueryKey() });
        },
        onError: () => toast({ title: "Error", description: "Failed to delete clip.", variant: "destructive" }),
      }
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPinnedOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as number);
      const newIndex = prev.indexOf(over.id as number);
      const next = arrayMove(prev, oldIndex, newIndex);
      savePinnedOrder(next);
      return next;
    });
  };

  const clipsById = Object.fromEntries(decryptedClips.map((c) => [c.id, c]));
  const allPinnedClips = pinnedOrder
    .map((id) => clipsById[id])
    .filter((c): c is DecryptedClip => !!c && c.pinned);
  const allRecentClips = decryptedClips.filter((c) => !c.pinned);

  const pinnedClips = allPinnedClips.filter((c) => matchesSearch(c, searchQuery));
  const recentClips = allRecentClips.filter((c) => matchesSearch(c, searchQuery));
  const hasNoResults = searchQuery.trim() !== "" && pinnedClips.length === 0 && recentClips.length === 0;

  const totalClips = summaryData?.totalClips || 0;

  const cardProps = (clip: DecryptedClip) => ({
    clip,
    searchQuery,
    onCopy: handleCopy,
    onDelete: handleDelete,
    onTogglePin: handleTogglePin,
    onLock: lock,
    deleteIsPending: deleteClip.isPending && deleteClip.variables?.id === clip.id,
  });

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
            <p className="text-sm text-muted-foreground mt-1">Your frictionless cross-device clipboard</p>
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

        {/* Search */}
        {decryptedClips.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search clips..."
              className="pl-9 pr-9 bg-card"
              data-testid="input-search"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* Input */}
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
              <span className="text-xs text-muted-foreground hidden sm:inline-block">Press Enter to save</span>
              <input
                type="file"
                ref={fileInputRef}
                onChange={async (e) => { const f = e.target.files?.[0]; if (f) await uploadFile(f); }}
                className="hidden"
                accept="image/*,application/pdf,.docx,.xlsx"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || createClip.isPending}
                className="rounded-full shadow-sm"
              >
                {isUploading ? "Uploading..." : <Paperclip className="h-4 w-4" />}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!input.trim() || createClip.isPending || isUploading}
                className="rounded-full shadow-sm"
                data-testid="button-submit-clip"
              >
                {createClip.isPending ? "Saving..." : <><Send className="h-4 w-4 mr-2" />Save</>}
              </Button>
            </div>
          </form>
        </section>

        {isLoadingClips ? (
          <div className="text-center py-12 text-muted-foreground animate-pulse">Loading your clips...</div>
        ) : decryptedClips.length === 0 ? (
          <div
            className="text-center py-16 px-4 bg-secondary/30 rounded-xl border border-dashed border-border"
            data-testid="empty-state"
          >
            <p className="text-muted-foreground">Your clipboard is empty.</p>
            <p className="text-sm text-muted-foreground/70 mt-2">
              Paste something above to get started. It will instantly appear here on all your devices.
            </p>
          </div>
        ) : hasNoResults ? (
          <div className="text-center py-16 px-4 bg-secondary/30 rounded-xl border border-dashed border-border">
            <Search className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No results found</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Nothing matches <span className="font-mono">"{searchQuery}"</span>
            </p>
            <button
              onClick={() => setSearchQuery("")}
              className="mt-3 text-sm text-primary hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-8 pb-12">

            {/* Pinned Section */}
            {pinnedClips.length > 0 && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Pin className="w-4 h-4 fill-amber-500 text-amber-500" />
                    <h2 className="font-semibold text-base">Pinned</h2>
                    <span className="text-xs text-muted-foreground bg-secondary rounded-full px-2 py-0.5">
                      {pinnedClips.length}
                    </span>
                  </div>
                  {!searchQuery && (
                    <span className="text-xs text-muted-foreground">Drag to reorder</span>
                  )}
                </div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext
                    items={pinnedClips.map((c) => c.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="flex flex-col gap-3">
                      {pinnedClips.map((clip) => (
                        <SortableClipCard key={clip.id} {...cardProps(clip)} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </section>
            )}

            {/* Recent Section */}
            {recentClips.length > 0 && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-base">
                      {allPinnedClips.length > 0 ? "Recent" : "Your Clips"}
                    </h2>
                    {!searchQuery && (
                      <Badge variant="secondary" className="font-normal text-xs" data-testid="badge-clip-count">
                        {totalClips} {totalClips === 1 ? "clip" : "clips"}
                      </Badge>
                    )}
                    {searchQuery && (
                      <span className="text-xs text-muted-foreground bg-secondary rounded-full px-2 py-0.5">
                        {recentClips.length} match{recentClips.length !== 1 ? "es" : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  {recentClips.map((clip) => (
                    <ClipCard key={clip.id} {...cardProps(clip)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
