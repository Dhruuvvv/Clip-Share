import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2, Link as LinkIcon, FileText, Send } from "lucide-react";
import { 
  useListClips, 
  getListClipsQueryKey, 
  useCreateClip, 
  useDeleteClip,
  useGetClipSummary,
  getGetClipSummaryQueryKey
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { isUrl, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

export default function Home() {
  const [input, setInput] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: clipsData, isLoading: isLoadingClips } = useListClips(
    { limit: 50 }, 
    { 
      query: { 
        refetchInterval: 2000, 
        queryKey: getListClipsQueryKey({ limit: 50 }) 
      } 
    }
  );

  const { data: summaryData } = useGetClipSummary({
    query: {
      refetchInterval: 2000,
      queryKey: getGetClipSummaryQueryKey()
    }
  });

  const createClip = useCreateClip();
  const deleteClip = useDeleteClip();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const type = isUrl(input.trim()) ? "link" : "text";

    createClip.mutate({ data: { content: input.trim(), type } }, {
      onSuccess: () => {
        setInput("");
        queryClient.invalidateQueries({ queryKey: getListClipsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetClipSummaryQueryKey() });
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to save clip.",
          variant: "destructive"
        });
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
      toast({
        description: "Copied to clipboard",
        duration: 2000,
      });
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to copy.",
        variant: "destructive"
      });
    }
  };

  const handleDelete = (id: number) => {
    deleteClip.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClipsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetClipSummaryQueryKey() });
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to delete clip.",
          variant: "destructive"
        });
      }
    });
  };

  const clips = clipsData?.items || [];
  const totalClips = summaryData?.totalClips || 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12 flex flex-col gap-8">
        
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">ClipShare</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your frictionless cross-device clipboard
            </p>
          </div>
          <ThemeToggle />
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
              <Button 
                type="submit" 
                size="sm" 
                disabled={!input.trim() || createClip.isPending}
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
              <Card key={clip.id} className="group overflow-hidden transition-all duration-300 hover:shadow-md border-card-border" data-testid={`card-clip-${clip.id}`}>
                <CardContent className="p-0">
                  <div className="p-4 sm:p-5 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {clip.type === 'link' ? (
                          <a 
                            href={clip.content.startsWith('http') ? clip.content : `https://${clip.content}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-primary hover:underline underline-offset-4 break-words line-clamp-3 leading-relaxed"
                          >
                            {clip.content}
                          </a>
                        ) : (
                          <p className="text-foreground whitespace-pre-wrap break-words leading-relaxed text-sm sm:text-base">
                            {clip.content}
                          </p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-2">
                      <Badge variant="outline" className={cn(
                        "text-xs font-normal border-transparent",
                        clip.type === 'link' ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      )}>
                        {clip.type === 'link' ? <LinkIcon className="w-3 h-3 mr-1" /> : <FileText className="w-3 h-3 mr-1" />}
                        {clip.type === 'link' ? 'Link' : 'Text'}
                      </Badge>
                      
                      <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopy(clip.content)}
                          className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary"
                          title="Copy to clipboard"
                          data-testid={`button-copy-${clip.id}`}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
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
