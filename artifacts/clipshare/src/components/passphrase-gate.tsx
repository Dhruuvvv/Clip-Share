import { useState, type ReactNode } from "react";
import { usePassphrase } from "@/contexts/passphrase-context";
import { useGetSalt, getSalt } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Lock } from "lucide-react";

interface PassphraseGateProps {
  children: ReactNode;
}

export function PassphraseGate({ children }: PassphraseGateProps) {
  const { isUnlocked, unlock } = usePassphrase();
  const [passphrase, setPassphrase] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const { toast } = useToast();

  const { data: saltData, isLoading: isLoadingSalt } = useGetSalt();

  if (isUnlocked) return <>{children}</>;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("[Unlock] handleUnlock triggered");
    
    if (!window.isSecureContext || !crypto.subtle) {
      console.error("[Unlock] Not in a secure context or crypto.subtle is unavailable");
      toast({
        title: "Security Error",
        description: "ClipShare requires a secure context (HTTPS) to decrypt your clips.",
        variant: "destructive",
      });
      return;
    }

    if (!passphrase.trim()) {
      console.warn("[Unlock] Empty passphrase");
      return;
    }

    setIsUnlocking(true);
    console.log("[Unlock] Starting decryption process...");
    
    try {
      let currentSalt = saltData?.salt;
      
      if (!currentSalt) {
        console.log("[Unlock] Salt not available yet, fetching manually...");
        const res = await getSalt();
        currentSalt = res.salt;
      }
      
      if (!currentSalt) {
        throw new Error("Could not retrieve salt.");
      }

      await unlock(passphrase.trim(), currentSalt);
      console.log("[Unlock] Decryption successful");
    } catch (err) {
      console.error("[Unlock] Decryption failed:", err);
      toast({
        title: "Failed to unlock",
        description: "Something went wrong. Check your connection or passphrase and try again.",
        variant: "destructive",
      });
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="text-center flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">ClipShare</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Enter your passphrase to unlock your clips
            </p>
          </div>
        </div>

        <form onSubmit={handleUnlock} className="flex flex-col gap-3">
          <Input
            type="password"
            placeholder="Your passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus
            disabled={isUnlocking}
            data-testid="input-passphrase"
          />
          <Button
            type="submit"
            disabled={!passphrase.trim() || isUnlocking}
            data-testid="button-unlock"
          >
            {isUnlocking ? "Unlocking..." : "Unlock"}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          Your clips are end-to-end encrypted. The same passphrase unlocks them on all your devices.
          This passphrase cannot be recovered if lost.
        </p>
      </div>
    </div>
  );
}
